// Web Push utilities for Cloudflare Workers
// Implements RFC 8291 (Message Encryption for Web Push)

import type { Member } from './types';

interface PushPayload {
  title: string;
  body: string;
}

// Helper to convert Uint8Array to ArrayBuffer (for strict TypeScript)
function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
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
    console.log('Push: Missing push credentials for member');
    return false;
  }

  try {
    // Import the VAPID private key (raw 32-byte EC key as JWK)
    const privateKeyBytes = new Uint8Array(base64UrlDecode(vapidPrivateKey));
    const publicKeyBytes = new Uint8Array(base64UrlDecode(vapidPublicKey));

    // Import as JWK - public key is 65 bytes (0x04 + x + y), private is 32 bytes
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: base64UrlEncode(publicKeyBytes.slice(1, 33)),
        y: base64UrlEncode(publicKeyBytes.slice(33, 65)),
        d: base64UrlEncode(privateKeyBytes),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // Create VAPID JWT
    const jwt = await createVapidJwt(
      member.push_endpoint,
      vapidSubject,
      privateKey
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
      body: toArrayBuffer(encryptedPayload),
    });

    if (!response.ok && response.status !== 201) {
      const text = await response.text().catch(() => '');
      console.error('Push failed:', response.status, text);
    }

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
  privateKey: CryptoKey
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

  // Convert from DER to raw format (r || s, 64 bytes total)
  const rawSignature = derToRaw(new Uint8Array(signature));
  const signatureB64 = base64UrlEncode(rawSignature);

  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Convert DER-encoded ECDSA signature to raw format (r || s)
 * DER: 0x30 [len] 0x02 [r-len] [r] 0x02 [s-len] [s]
 * Raw: [r padded to 32 bytes] [s padded to 32 bytes]
 */
function derToRaw(der: Uint8Array): Uint8Array {
  const raw = new Uint8Array(64);

  let offset = 2; // Skip 0x30 and total length byte

  // Read r
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for r');
  offset++;
  const rLen = der[offset];
  offset++;
  // r might have leading zero for sign, skip it if present
  const rStart = (rLen === 33 && der[offset] === 0) ? offset + 1 : offset;
  const rBytes = der.slice(rStart, offset + rLen);
  raw.set(rBytes, 32 - rBytes.length);
  offset += rLen;

  // Read s
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for s');
  offset++;
  const sLen = der[offset];
  offset++;
  const sStart = (sLen === 33 && der[offset] === 0) ? offset + 1 : offset;
  const sBytes = der.slice(sStart, offset + sLen);
  raw.set(sBytes, 64 - sBytes.length);

  return raw;
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

  // Generate salt FIRST - it's needed for key derivation
  const salt = crypto.getRandomValues(new Uint8Array(16));

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

  // Derive encryption key and nonce using HKDF (salt is required!)
  const { key, nonce } = await deriveKeyAndNonce(
    sharedSecret,
    authSecret,
    ephemeralPublicKey,
    subscriberPublicKey,
    salt
  );

  // Encrypt with AES-GCM
  const paddedPayload = addPadding(new TextEncoder().encode(payload));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonce), tagLength: 128 },
    key,
    toArrayBuffer(paddedPayload)
  );

  // Build the aes128gcm content
  const recordSize = new Uint8Array(4);
  new DataView(toArrayBuffer(recordSize)).setUint32(0, 4096, false);

  const ephemeralPubKeyBytes = new Uint8Array(ephemeralPublicKey);
  const header = new Uint8Array(86);
  header.set(salt, 0);
  header.set(recordSize, 16);
  header[20] = 65; // Public key length
  header.set(ephemeralPubKeyBytes, 21);

  const result = new Uint8Array(header.length + encrypted.byteLength);
  result.set(header);
  result.set(new Uint8Array(encrypted), header.length);

  return result;
}

/**
 * Derive encryption key and nonce using HKDF (RFC 8291)
 */
async function deriveKeyAndNonce(
  sharedSecret: ArrayBuffer,
  authSecret: ArrayBuffer,
  ephemeralPublicKey: ArrayBuffer,
  subscriberPublicKey: ArrayBuffer,
  salt: Uint8Array
): Promise<{ key: CryptoKey; nonce: Uint8Array }> {
  // Import shared secret for HKDF
  const sharedKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // PRK = HKDF-Extract(auth_secret, shared_secret) with WebPush info
  const info = createInfo('WebPush: info\0', new Uint8Array(subscriberPublicKey), new Uint8Array(ephemeralPublicKey));
  const prkBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', salt: authSecret, info: toArrayBuffer(info), hash: 'SHA-256' },
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

  // Content encryption key - use salt from header
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', salt: toArrayBuffer(salt), info: toArrayBuffer(cekInfo), hash: 'SHA-256' },
    prkKey,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt']
  );

  // Nonce - use salt from header
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', salt: toArrayBuffer(salt), info: toArrayBuffer(nonceInfo), hash: 'SHA-256' },
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
 * Base64 URL decode - returns ArrayBuffer for crypto API compatibility
 */
function base64UrlDecode(input: string): ArrayBuffer {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer.slice(0, bytes.length) as ArrayBuffer;
}
