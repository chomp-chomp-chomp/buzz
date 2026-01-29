# Push Notifications Technical Breakdown

This document explains how push notifications work in Cooling, from subscription to delivery.

## Overview

Cooling uses the **Web Push** protocol (RFC 8030) with **VAPID** authentication (RFC 8292). Push messages are sent as **no-payload pings** — the notification content is hardcoded in the service worker rather than encrypted in the push payload.

## Architecture

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   iPhone    │     │  Cloudflare     │     │  Apple Push     │
│   (PWA)     │     │  Pages/Workers  │     │  Service (APNs) │
└─────────────┘     └─────────────────┘     └─────────────────┘
       │                     │                       │
       │ 1. Subscribe        │                       │
       │ ─────────────────►  │                       │
       │    (VAPID key)      │                       │
       │                     │                       │
       │ 2. Save subscription│                       │
       │ ─────────────────►  │                       │
       │    (endpoint, keys) │                       │
       │                     │                       │
       │                     │ 3. Send push          │
       │                     │ ─────────────────────►│
       │                     │    (VAPID JWT)        │
       │                     │                       │
       │ 4. Push event       │                       │
       │ ◄───────────────────────────────────────────│
       │    (via APNs)       │                       │
       │                     │                       │
       │ 5. Show notification│                       │
       │    (service worker) │                       │
```

## Components

### 1. VAPID Keys

VAPID (Voluntary Application Server Identification) authenticates the server to the push service.

**Key format:**
- **Public key**: 65 bytes, uncompressed EC point (0x04 || x || y)
- **Private key**: 32 bytes, raw EC scalar

**Storage:** Environment variables in Cloudflare Pages dashboard:
```
VAPID_PUBLIC_KEY=BLxH3...(base64url, 65 bytes decoded)
VAPID_PRIVATE_KEY=abc123...(base64url, 32 bytes decoded)
VAPID_SUBJECT=mailto:hello@example.com
```

**Generation** (Node.js):
```javascript
const { generateVAPIDKeys } = require('web-push');
const keys = generateVAPIDKeys();
console.log(keys.publicKey);  // base64url
console.log(keys.privateKey); // base64url
```

### 2. Push Subscription (Client Side)

Location: `app/page.tsx` → `ensurePushSubscription()`

**Flow:**
1. Wait for service worker to be ready
2. Check for existing subscription via `pushManager.getSubscription()`
3. If none, fetch VAPID public key from `/api/vapid-key`
4. Create subscription with `pushManager.subscribe()`
5. Send subscription to server via `/api/subscribe`

**Subscription object contains:**
```json
{
  "endpoint": "https://web.push.apple.com/QGynp9...",
  "keys": {
    "p256dh": "BNcRd...(base64url, 65 bytes - client public key)",
    "auth": "tBHI...(base64url, 16 bytes - auth secret)"
  }
}
```

The `p256dh` and `auth` keys are for payload encryption (which we don't use, but they're still required for subscription).

### 3. Saving Subscription (Server Side)

Location: `app/api/subscribe/route.ts`

Stores in D1 database:
```sql
UPDATE members SET
  push_endpoint = ?,
  push_p256dh = ?,
  push_auth = ?
WHERE device_id = ?
```

### 4. Sending Push (Server Side)

Location: `lib/push.ts` → `sendPushNotification()`

**VAPID JWT Creation:**

The server creates a JWT signed with the VAPID private key:

```javascript
// Header
{ "alg": "ES256", "typ": "JWT" }

// Payload
{
  "aud": "https://web.push.apple.com",  // Push service origin
  "exp": 1234567890,                     // Expiration (12 hours)
  "sub": "mailto:hello@example.com"      // Contact
}
```

**Signature:**
- Algorithm: ECDSA with P-256 and SHA-256
- Cloudflare Workers returns raw signature (64 bytes: r || s)
- Other runtimes return DER-encoded; `derToRaw()` handles both

**HTTP Request to Push Service:**

```http
POST https://web.push.apple.com/QGynp9... HTTP/1.1
Authorization: vapid t=eyJhbGc..., k=BLxH3...
TTL: 86400
Content-Length: 0
```

**Key insight:** We send **no body**. The `Content-Length: 0` header with no payload means the service worker receives `event.data === null`. This bypasses all encryption complexity.

**Why no payload?**
- Web Push payload encryption (RFC 8291) is complex
- Our implementation had encryption issues causing silent failures on iOS
- Apple returned 201 (accepted) but notifications never appeared
- Switching to no-payload pings fixed it immediately

### 5. Service Worker Push Handler

Location: `public/sw.js`

```javascript
self.addEventListener('push', (event) => {
  // Handle null data (no-payload push)
  let data = { title: 'Chomp', body: '' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // Use default
    }
  }

  const options = {
    body: data.body || '',
    icon: '/heart-cookie.png',
    badge: '/heart-cookie.png',
    tag: 'cooling-chomp',
    renotify: true,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, options),
      // Also notify open clients for in-app sound
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((c) => c.postMessage({ type: 'chomp-received' }));
      }),
    ])
  );
});
```

## Encryption (Preserved but Unused)

The codebase includes a complete RFC 8291 implementation in `lib/push.ts`:

1. **ECDH Key Exchange**: Generate ephemeral key pair, derive shared secret with subscriber's `p256dh` key
2. **HKDF Key Derivation**: Derive content encryption key (CEK) and nonce from shared secret, auth secret, and salt
3. **AES-GCM Encryption**: Encrypt padded payload
4. **aes128gcm Header**: 16-byte salt + 4-byte record size + 1-byte key length + 65-byte ephemeral public key

This code is preserved but not called. The `sendPushNotification()` function sends no-payload pings instead.

## iOS-Specific Requirements

1. **PWA Installation**: Must be added to home screen via Safari's "Add to Home Screen"
2. **Opened from Home Screen**: Push only works when app is launched from home screen icon, not Safari
3. **iOS 16.4+**: Web Push support was added in iOS 16.4
4. **Notification Permission**: Must be granted; managed via `/notifications` page

## Debugging

### Check subscription status
```
GET /api/debug
```
Returns:
```json
{
  "deviceId": "...",
  "vapid": { "hasPublic": true, "hasPrivate": true, "hasSubject": true },
  "you": { "hasPushEndpoint": true, "hasPushKeys": true },
  "partner": { "hasPushEndpoint": true, "hasPushKeys": true }
}
```

### Test push delivery
```
GET /api/test-push
```
Returns step-by-step log and Apple's response:
```json
{
  "success": true,
  "status": 201,
  "statusText": "Created",
  "steps": ["Decoding VAPID keys", "...", "Response: 201 Created"]
}
```

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| `hasPushEndpoint: false` | Subscription not created | Visit `/notifications`, tap enable |
| Push returns 410 Gone | Subscription expired | Re-subscribe via `/notifications` |
| Push returns 201 but no notification | Old service worker | Bump `CACHE_NAME`, revisit app |
| "PushManager not available" | Not in PWA context | Open from home screen, not Safari |

## Response Codes from Apple

| Code | Meaning |
|------|---------|
| 201 | Created — push accepted |
| 400 | Bad request — malformed |
| 401 | Unauthorized — VAPID auth failed |
| 404 | Not found — invalid endpoint |
| 410 | Gone — subscription no longer valid |
| 429 | Too many requests — rate limited |

## Further Reading

- [RFC 8030 - Generic Event Delivery Using HTTP Push](https://datatracker.ietf.org/doc/html/rfc8030)
- [RFC 8291 - Message Encryption for Web Push](https://datatracker.ietf.org/doc/html/rfc8291)
- [RFC 8292 - VAPID for Web Push](https://datatracker.ietf.org/doc/html/rfc8292)
- [Apple's Web Push Documentation](https://developer.apple.com/documentation/usernotifications/sending_web_push_notifications_in_web_apps_and_browsers)
