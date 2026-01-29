# CLAUDE.md

This file provides guidance for Claude (AI assistant) when working on this codebase.

## Project Overview

**Cooling** (internally "Chomp Buzz") is a minimal two-person iOS PWA. One button sends a "chomp" notification to your partner. No chat, no feed, no obligation to respond.

## Tech Stack

- **Framework**: Next.js 15 (App Router) with TypeScript
- **Hosting**: Cloudflare Pages with `@cloudflare/next-on-pages`
- **Database**: Cloudflare D1 (SQLite)
- **Push**: Web Push with VAPID (RFC 8292), no encrypted payload

## Key Files

```
app/
  page.tsx           # Main app UI (pairing, chomp button, status)
  about/page.tsx     # About page
  notes/page.tsx     # Documentation accordion
  notifications/     # Enable notifications page
  debug/utilities/   # Debug tools page
  api/
    buzz/route.ts    # Send chomp endpoint
    me/route.ts      # Get current user status
    pair/route.ts    # Pairing (create/join)
    status/route.ts  # Get oven timer status
    subscribe/route.ts # Save push subscription
    vapid-key/route.ts # Return VAPID public key
    debug/route.ts   # Debug push subscription status
    test-push/route.ts # Test push delivery

lib/
  push.ts            # Web Push implementation (VAPID JWT, no-payload ping)
  types.ts           # TypeScript types (Env, Member, Pair, etc.)

public/
  sw.js              # Service worker (push handler, client messaging)
  manifest.json      # PWA manifest
  buzz.mp3           # Audio for in-app chomp received
  *.png              # Cookie images
```

## Cloudflare Bindings

Access D1 and environment variables via `getRequestContext()`:

```typescript
import { getRequestContext } from '@cloudflare/next-on-pages';
const { env } = getRequestContext() as unknown as { env: Env };
const db = env.DB;
```

**Do NOT use**: `(request as any).cf?.env` — this doesn't work with `@cloudflare/next-on-pages`.

## Environment Variables (Cloudflare Pages Dashboard)

- `VAPID_PUBLIC_KEY` — Base64url-encoded 65-byte uncompressed EC public key
- `VAPID_PRIVATE_KEY` — Base64url-encoded 32-byte EC private key
- `VAPID_SUBJECT` — `mailto:` URI for VAPID identification

## Push Notifications

Push uses **no-payload ping style** — the encrypted payload was causing silent failures on iOS. The service worker shows a default "Chomp" notification when `event.data` is null.

See `docs/push-notifications.md` for full technical breakdown.

## Database Schema

```sql
CREATE TABLE pairs (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE,
  created_at INTEGER,
  last_chomp_at INTEGER
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  device_id TEXT UNIQUE,
  pair_id TEXT REFERENCES pairs(id),
  push_endpoint TEXT,
  push_p256dh TEXT,
  push_auth TEXT,
  last_chomp_at INTEGER,
  last_received_at INTEGER,
  created_at INTEGER
);
```

## Common Tasks

### Adding a new API route

1. Create `app/api/[name]/route.ts`
2. Export `runtime = 'edge'`
3. Use `getRequestContext()` for Cloudflare bindings
4. Type response with generics: `NextResponse.json<MyType>(...)`

### Modifying push behavior

Edit `lib/push.ts`. Currently sends no-payload pings. The encryption code is preserved but unused.

### Service worker changes

Edit `public/sw.js`. Bump `CACHE_NAME` version to force update on devices.

## Design Philosophy

- **Minimal**: One button, one action, no threads
- **No surveillance**: No read receipts, no "last seen", no presence indicators
- **Built-in restraint**: 108-second cooldown between chomps
- **Ambiguity preserved**: If partner deletes app, your chomps just go to void — no notification

## Testing

- Add `?dev=1` to bypass standalone PWA check for desktop testing
- `/debug/utilities` has links to debug endpoints
- `/api/test-push` tests push delivery and shows Apple's response

## Gotchas

1. **ECDSA signatures**: Cloudflare Workers returns raw format (64 bytes), not DER. The `derToRaw()` function handles both.

2. **Push subscription timing**: `subscribeToPush()` only runs if `Notification.permission === 'granted'`. The `/notifications` page handles the permission request flow.

3. **Service worker stale**: Users may have old SW cached. Bump `CACHE_NAME` and call `reg.update()` on registration.

4. **iOS PWA requirements**: Must be installed to home screen and opened from there. Push won't work in Safari browser.
