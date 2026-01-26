import { NextRequest, NextResponse } from 'next/server';
import type { Env, Member, ChompResponse } from '@/lib/types';
import { sendPushNotification } from '@/lib/push';

// Oven duration in seconds
const OVEN_SECONDS = 108;

export const runtime = 'edge';

export async function POST(request: NextRequest) {
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
    const env: Env = (request as any).cf?.env || process.env;
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
    await db.batch([
      db.prepare('UPDATE members SET last_chomp_at = ? WHERE id = ?').bind(now, sender.id),
      db.prepare('UPDATE pairs SET last_chomp_at = ? WHERE id = ?').bind(now, sender.pair_id),
    ]);

    // Send push notification to partner (title: "Chomp", empty body)
    if (partner.push_endpoint && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      await sendPushNotification(
        partner,
        { title: 'Chomp', body: '' },
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
        env.VAPID_SUBJECT || 'mailto:hello@cooling.app'
      );
    }

    return NextResponse.json<ChompResponse>({
      success: true,
      ovenSeconds: OVEN_SECONDS,
    });
  } catch (error) {
    console.error('Chomp error:', error);
    return NextResponse.json<ChompResponse>(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
