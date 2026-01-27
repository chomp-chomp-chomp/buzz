import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { Env, Member, ChompResponse } from '@/lib/types';
import { sendPushNotification } from '@/lib/push';

// Oven duration in seconds
const OVEN_SECONDS = 108;

export const runtime = 'edge';

function isDebugRequest(request: NextRequest): boolean {
  const header = request.headers.get('x-debug');
  if (header === '1' || header === 'true') {
    return true;
  }
  const devParam = request.nextUrl.searchParams.get('dev');
  return devParam === '1';
}

export async function POST(request: NextRequest) {
  const debug = isDebugRequest(request);

  try {
    // Get device ID from cookie
    const deviceId = request.cookies.get('deviceId')?.value;
    if (!deviceId) {
      return NextResponse.json<ChompResponse>(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get Cloudflare bindings
    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      // Development mode - return mock response
      return NextResponse.json<ChompResponse>({
        success: true,
        ovenSeconds: OVEN_SECONDS,
      });
    }

    // Get the sender member
    const sender = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!sender) {
      return NextResponse.json<ChompResponse>(
        { success: false, error: 'Not paired' },
        { status: 403 }
      );
    }

    // Check if sender is still in oven
    const now = Math.floor(Date.now() / 1000);
    if (sender.last_chomp_at) {
      const elapsed = now - sender.last_chomp_at;
      if (elapsed < OVEN_SECONDS) {
        const remaining = OVEN_SECONDS - elapsed;
        return NextResponse.json<ChompResponse>(
          { success: false, remainingSeconds: remaining },
          { status: 429 }
        );
      }
    }

    // Get the partner member
    const partner = await db
      .prepare('SELECT * FROM members WHERE pair_id = ? AND device_id != ?')
      .bind(sender.pair_id, deviceId)
      .first<Member>();

    if (!partner) {
      return NextResponse.json<ChompResponse>(
        { success: false, error: 'Partner not found' },
        { status: 404 }
      );
    }

    // Update sender's last chomp time and pair's last chomp time
    try {
      await db.batch([
        db.prepare('UPDATE members SET last_chomp_at = ? WHERE id = ?').bind(now, sender.id),
        db.prepare('UPDATE pairs SET last_chomp_at = ? WHERE id = ?').bind(now, sender.pair_id),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no such column: last_chomp_at')) {
        console.warn('Pairs.last_chomp_at missing; update skipped until migration runs.');
        await db
          .prepare('UPDATE members SET last_chomp_at = ? WHERE id = ?')
          .bind(now, sender.id)
          .run();
      } else {
        throw error;
      }
    }

    // Send push notification to partner (title: "Chomp", empty body)
    if (partner.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      try {
        await sendPushNotification(
          partner,
          { title: 'Chomp', body: '' },
          env.VAPID_PUBLIC_KEY,
          env.VAPID_PRIVATE_KEY,
          env.VAPID_SUBJECT || 'mailto:hello@cooling.app'
        );
      } catch (error) {
        console.error('Push send error:', error);
      }
    }

    return NextResponse.json<ChompResponse>({
      success: true,
      ovenSeconds: OVEN_SECONDS,
    });
  } catch (error) {
    console.error('Chomp error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json<ChompResponse>(
      { success: false, error: debug ? `Internal error: ${message}` : 'Internal error' },
      { status: 500 }
    );
  }
}
