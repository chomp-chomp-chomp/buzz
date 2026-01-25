import { NextRequest, NextResponse } from 'next/server';
import type { Env, Member, BuzzResponse } from '@/lib/types';
import { sendPushNotification } from '@/lib/push';

// Cooldown duration in seconds
const COOLDOWN_SECONDS = 69;

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Get device ID from cookie
    const deviceId = request.cookies.get('deviceId')?.value;
    if (!deviceId) {
      return NextResponse.json<BuzzResponse>(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get Cloudflare bindings
    // @ts-expect-error - Cloudflare bindings
    const env: Env = (request as any).cf?.env || process.env;
    const db = env.DB;

    if (!db) {
      // Development mode - return mock response
      return NextResponse.json<BuzzResponse>({
        success: true,
        cooldownSeconds: COOLDOWN_SECONDS,
      });
    }

    // Get the sender member
    const sender = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!sender) {
      return NextResponse.json<BuzzResponse>(
        { success: false, error: 'Not paired' },
        { status: 403 }
      );
    }

    // Check cooldown
    const now = Math.floor(Date.now() / 1000);
    if (sender.last_buzz_at) {
      const elapsed = now - sender.last_buzz_at;
      if (elapsed < COOLDOWN_SECONDS) {
        const remaining = COOLDOWN_SECONDS - elapsed;
        return NextResponse.json<BuzzResponse>(
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
      return NextResponse.json<BuzzResponse>(
        { success: false, error: 'Partner not found' },
        { status: 404 }
      );
    }

    // Update sender's last buzz time
    await db
      .prepare('UPDATE members SET last_buzz_at = ? WHERE id = ?')
      .bind(now, sender.id)
      .run();

    // Send push notification to partner
    if (partner.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      await sendPushNotification(
        partner,
        { title: 'Chomp Buzz', body: 'buzz' },
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
        env.VAPID_SUBJECT || 'mailto:buzz@chomp.buzz'
      );
    }

    return NextResponse.json<BuzzResponse>({
      success: true,
      cooldownSeconds: COOLDOWN_SECONDS,
    });
  } catch (error) {
    console.error('Buzz error:', error);
    return NextResponse.json<BuzzResponse>(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
