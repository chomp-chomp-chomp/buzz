import { NextRequest, NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { Env, Member, Pair, StatusResponse } from '@/lib/types';

const OVEN_SECONDS = 108;

export const runtime = 'edge';

/**
 * Convert a timestamp to a relative time string
 */
function getRelativeTime(timestamp: number | null): string {
  if (timestamp === null) {
    return 'never';
  }

  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) {
    return 'just now';
  }
  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes}m ago`;
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours}h ago`;
  }
  if (diff < 172800) {
    return 'yesterday';
  }
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

export async function GET(request: NextRequest) {
  try {
    const deviceId = request.cookies.get('deviceId')?.value;

    if (!deviceId) {
      return NextResponse.json<StatusResponse>({
        state: 'cooling',
        ovenRemainingSeconds: 0,
        lastChompRelative: 'never',
      });
    }

    // Get Cloudflare bindings
    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      // Development mode
      return NextResponse.json<StatusResponse>({
        state: 'cooling',
        ovenRemainingSeconds: 0,
        lastChompRelative: 'just now',
      });
    }

    // Get the member
    const member = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json<StatusResponse>({
        state: 'cooling',
        ovenRemainingSeconds: 0,
        lastChompRelative: 'never',
      });
    }

    // Get the pair for last_chomp_at
    let pair: Pair | null = null;
    try {
      pair = await db
        .prepare('SELECT * FROM pairs WHERE id = ?')
        .bind(member.pair_id)
        .first<Pair>();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no such column: last_chomp_at')) {
        console.warn('Pairs.last_chomp_at missing; falling back to member data.');
      } else {
        throw error;
      }
    }

    // Calculate oven state for local user
    let state: 'cooling' | 'oven' = 'cooling';
    let ovenRemainingSeconds = 0;

    if (member.last_chomp_at) {
      const now = Math.floor(Date.now() / 1000);
      const elapsed = now - member.last_chomp_at;
      if (elapsed < OVEN_SECONDS) {
        state = 'oven';
        ovenRemainingSeconds = OVEN_SECONDS - elapsed;
      }
    }

    // Get relative time for last chomp (from pair, not individual member)
    const lastChompRelative = getRelativeTime(pair?.last_chomp_at ?? member.last_chomp_at ?? null);

    return NextResponse.json<StatusResponse>({
      state,
      ovenRemainingSeconds,
      lastChompRelative,
    });
  } catch (error) {
    console.error('Status error:', error);
    return NextResponse.json<StatusResponse>({
      state: 'cooling',
      ovenRemainingSeconds: 0,
      lastChompRelative: 'never',
    });
  }
}
