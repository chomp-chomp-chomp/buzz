import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { Env, Member, SubscribeRequest } from '@/lib/types';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const body: SubscribeRequest = await request.json();
    const { deviceId, subscription } = body;

    if (!deviceId || !subscription) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get Cloudflare bindings
    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      // Development mode
      return NextResponse.json({ success: true });
    }

    // Find the member
    const member = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json(
        { success: false, error: 'Not paired' },
        { status: 403 }
      );
    }

    // Update push subscription
    await db
      .prepare(
        `UPDATE members
         SET push_endpoint = ?, push_p256dh = ?, push_auth = ?
         WHERE id = ?`
      )
      .bind(
        subscription.endpoint || null,
        subscription.keys?.p256dh || null,
        subscription.keys?.auth || null,
        member.id
      )
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}

// DELETE endpoint to unsubscribe
export async function DELETE(request: NextRequest) {
  try {
    const deviceId = request.cookies.get('deviceId')?.value;

    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get Cloudflare bindings
    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      return NextResponse.json({ success: true });
    }

    // Clear push subscription
    await db
      .prepare(
        `UPDATE members
         SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL
         WHERE device_id = ?`
      )
      .bind(deviceId)
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
