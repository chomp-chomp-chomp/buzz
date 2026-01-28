import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { Env, Member } from '@/lib/types';

export const runtime = 'edge';

// Debug endpoint to check push subscription status
// Access: /api/debug
export async function GET(request: NextRequest) {
  try {
    const deviceId = request.cookies.get('deviceId')?.value;

    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    const hasVapidPublic = !!env.VAPID_PUBLIC_KEY;
    const hasVapidPrivate = !!env.VAPID_PRIVATE_KEY;
    const hasVapidSubject = !!env.VAPID_SUBJECT;

    if (!db) {
      return NextResponse.json({
        error: 'No database',
        vapid: { hasPublic: hasVapidPublic, hasPrivate: hasVapidPrivate, hasSubject: hasVapidSubject },
      });
    }

    if (!deviceId) {
      return NextResponse.json({
        error: 'No deviceId cookie',
        vapid: { hasPublic: hasVapidPublic, hasPrivate: hasVapidPrivate, hasSubject: hasVapidSubject },
      });
    }

    // Get current member
    const member = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json({
        error: 'Not paired',
        deviceId,
        vapid: { hasPublic: hasVapidPublic, hasPrivate: hasVapidPrivate, hasSubject: hasVapidSubject },
      });
    }

    // Get partner
    const partner = await db
      .prepare('SELECT * FROM members WHERE pair_id = ? AND device_id != ?')
      .bind(member.pair_id, deviceId)
      .first<Member>();

    return NextResponse.json({
      deviceId,
      vapid: {
        hasPublic: hasVapidPublic,
        hasPrivate: hasVapidPrivate,
        hasSubject: hasVapidSubject,
      },
      you: {
        id: member.id,
        hasPushEndpoint: !!member.push_endpoint,
        hasPushKeys: !!member.push_p256dh && !!member.push_auth,
        pushEndpointPreview: member.push_endpoint?.slice(0, 50) + '...',
      },
      partner: partner ? {
        id: partner.id,
        hasPushEndpoint: !!partner.push_endpoint,
        hasPushKeys: !!partner.push_p256dh && !!partner.push_auth,
        pushEndpointPreview: partner.push_endpoint?.slice(0, 50) + '...',
      } : null,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
