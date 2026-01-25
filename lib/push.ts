// Web Push utilities for Cloudflare Workers
// Implements RFC 8291 (Message Encryption for Web Push)

import type { Member } from './types';

interface PushPayload {
  title: string;
  body: string;
}

/**
 * Send a push notification to a member
 * Uses the Web Push protocol with VAPID authentication
 */
export async function sendPushNotification(
  member: Member,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string
): Promise<boolean> {
  if (!member.push_endpoint || !member.push_p256dh || !member.push_auth) {
    return false;
  }

  try {
    // Import the VAPID private key
    const privateKeyData = base64UrlDecode(vapidPrivateKey);
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      privateKeyData,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // Create VAPID JWT
    const jwt = await createVapidJwt(
      member.push_endpoint,
      vapidSubject,
      privateKey,
      vapidPublicKey
    );

    // Encrypt the payload
    const encryptedPayload = await encryptPayload(
      JSON.stringify(payload),
      member.push_p256dh,
      member.push_auth
    );

    // Send the push message
    const response = await fetch(member.push_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      },
      body: encryptedPayload,
    });

    return response.ok || response.status === 201;
  } catch (error) {
    console.error('Push notification failed:', error);
    return false;
  }
}

/**
 * Create a VAPID JWT for authentication
 */
async function createVapidJwt(
  endpoint: string,
  subject: string,
  privateKey: CryptoKey,
  publicKey: string
): Promise<string> {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = {
    aud: audience,
    exp: expiration,
    sub: subject,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert from DER to raw format (r || s)
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));

  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Encrypt payload using Web Push encryption (aes128gcm)
 */
async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
): Promise<Uint8Array> {
  // Decode subscriber keys
  const subscriberPublicKey = base64UrlDecode(p256dh);
  const authSecret = base64UrlDecode(auth);

  // Generate ephemeral key pair
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // Import subscriber public key
  const subscriberKey = await crypto.subtle.importKey(
    'raw',
    subscriberPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: subscriberKey },
    ephemeralKeyPair.privateKey,
    256
  );

  // Export ephemeral public key
  const ephemeralPublicKey = await crypto.subtle.exportKey(
    'raw',
    ephemeralKeyPair.publicKey
  );

  // Derive encryption key and nonce using HKDF
  const { key, nonce } = await deriveKeyAndNonce(
    new Uint8Array(sharedSecret),
    authSecret,
    new Uint8Array(ephemeralPublicKey),
    subscriberPublicKey
  );

  // Encrypt with AES-GCM
  const paddedPayload = addPadding(new TextEncoder().encode(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    paddedPayload
  );

  // Build the aes128gcm content
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);

  const header = new Uint8Array(86);
  header.set(salt, 0);
  header.set(recordSize, 16);
  header[20] = 65; // Public key length
  header.set(new Uint8Array(ephemeralPublicKey), 21);

  const result = new Uint8Array(header.length + encrypted.byteLength);
  result.set(header);
  result.set(new Uint8Array(encrypted), header.length);

  return result;
}

/**
 * Derive encryption key and nonce using HKDF
 */
async function deriveKeyAndNonce(
  sharedSecret: Uint8Array,
  authSecret: Uint8Array,
  ephemeralPublicKey: Uint8Array,
  subscriberPublicKey: Uint8Array
): Promise<{ key: CryptoKey; nonce: Uint8Array }> {
  // Import shared secret for HKDF
  const sharedKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const info = createInfo('WebPush: info\0', subscriberPublicKey, ephemeralPublicKey);
  const prkBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', salt: authSecret, info, hash: 'SHA-256' },
    sharedKey,
    256
  );

  const prkKey = await crypto.subtle.importKey(
    'raw',
    prkBits,
    { name: 'HKDF' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Content encryption key
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: new Uint8Array(0), info: cekInfo, hash: 'SHA-256' },
    prkKey,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt']
  );

  // Nonce
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', salt: new Uint8Array(0), info: nonceInfo, hash: 'SHA-256' },
    prkKey,
    96
  );

  return { key, nonce: new Uint8Array(nonceBits) };
}

/**
 * Create info parameter for HKDF
 */
function createInfo(
  prefix: string,
  subscriberPublicKey: Uint8Array,
  ephemeralPublicKey: Uint8Array
): Uint8Array {
  const prefixBytes = new TextEncoder().encode(prefix);
  const info = new Uint8Array(
    prefixBytes.length + 2 + subscriberPublicKey.length + 2 + ephemeralPublicKey.length
  );
  let offset = 0;

  info.set(prefixBytes, offset);
  offset += prefixBytes.length;

  info[offset++] = 0;
  info[offset++] = subscriberPublicKey.length;
  info.set(subscriberPublicKey, offset);
  offset += subscriberPublicKey.length;

  info[offset++] = 0;
  info[offset++] = ephemeralPublicKey.length;
  info.set(ephemeralPublicKey, offset);

  return info;
}

/**
 * Add padding to payload (single byte delimiter + padding)
 */
function addPadding(payload: Uint8Array): Uint8Array {
  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload);
  padded[payload.length] = 2; // Delimiter byte
  return padded;
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64 URL decode
 */
function base64UrlDecode(input: string): Uint8Array {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
