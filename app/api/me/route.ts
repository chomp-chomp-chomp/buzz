import { NextRequest, NextResponse } from 'next/server';
import type { Env, Member, MeResponse } from '@/lib/types';

const OVEN_SECONDS = 108;

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.cookies.get('deviceId')?.value;

    if (!deviceId) {
      return NextResponse.json<MeResponse>({
        paired: false,
        ovenRemainingSeconds: 0,
        hasPartner: false,
      });
    }

    // Get Cloudflare bindings
    const env: Env = (request as any).cf?.env || process.env;
    const db = env.DB;

    if (!db) {
      // Development mode
      return NextResponse.json<MeResponse>({
        paired: true,
        ovenRemainingSeconds: 0,
        hasPartner: true,
      });
    }

    // Get the member
    const member = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json<MeResponse>({
        paired: false,
        ovenRemainingSeconds: 0,
        hasPartner: false,
      });
    }

    // Check for partner
    const partner = await db
      .prepare('SELECT * FROM members WHERE pair_id = ? AND device_id != ?')
      .bind(member.pair_id, deviceId)
      .first<Member>();

    // Calculate oven remaining
    let ovenRemaining = 0;
    if (member.last_chomp_at) {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - member.last_chomp_at;
      if (elapsed < OVEN_SECONDS) {
        ovenRemaining = OVEN_SECONDS - elapsed;
      }
    }

    return NextResponse.json<MeResponse>({
      paired: true,
      ovenRemainingSeconds: ovenRemaining,
      hasPartner: !!partner,
    });
  } catch (error) {
    console.error('Me error:', error);
    return NextResponse.json<MeResponse>({
      paired: false,
      ovenRemainingSeconds: 0,
      hasPartner: false,
    });
  }
}
