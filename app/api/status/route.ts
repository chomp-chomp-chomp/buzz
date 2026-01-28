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
    const now = Math.floor(Date.now() / 1000);
    const deviceId = request.cookies.get('deviceId')?.value;

    if (!deviceId) {
      return NextResponse.json<StatusResponse>({
        state: 'cooling',
        ovenRemainingSeconds: 0,
        lastChompRelative: 'never',
        serverNow: now,
        lastSentAt: null,
        lastReceivedAt: null,
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
        serverNow: now,
        lastSentAt: null,
        lastReceivedAt: null,
      });
    }

    // Get the member
    let member: Member | null = null;
    try {
      member = await db
        .prepare('SELECT * FROM members WHERE device_id = ?')
        .bind(deviceId)
        .first<Member>();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('no such column: last_chomp_at') ||
        message.includes('no such column: last_received_at')
      ) {
        console.warn('Members chomp columns missing; retrying without those columns.');
        const fallback = await db
          .prepare(
            'SELECT id, pair_id, device_id, push_endpoint, push_p256dh, push_auth, created_at FROM members WHERE device_id = ?'
          )
          .bind(deviceId)
          .first<Member>();
        member = fallback
          ? { ...fallback, last_chomp_at: null, last_received_at: null }
          : null;
      } else {
        throw error;
      }
    }

    if (!member) {
      return NextResponse.json<StatusResponse>({
        state: 'cooling',
        ovenRemainingSeconds: 0,
        lastChompRelative: 'never',
        serverNow: now,
        lastSentAt: null,
        lastReceivedAt: null,
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
      const elapsed = now - member.last_chomp_at;
      if (elapsed < OVEN_SECONDS) {
        state = 'oven';
        ovenRemainingSeconds = OVEN_SECONDS - elapsed;
      }
    }

    // Get relative time for last chomp (from pair, not individual member)
    const lastSentAt = member.last_chomp_at ?? null;
    const lastReceivedAt = member.last_received_at ?? pair?.last_chomp_at ?? null;
    const lastChompRelative = getRelativeTime(lastReceivedAt ?? lastSentAt ?? null);

    return NextResponse.json<StatusResponse>({
      state,
      ovenRemainingSeconds,
      lastChompRelative,
      serverNow: now,
      lastSentAt,
      lastReceivedAt,
    });
  } catch (error) {
    console.error('Status error:', error);
    return NextResponse.json<StatusResponse>({
      state: 'cooling',
      ovenRemainingSeconds: 0,
      lastChompRelative: 'never',
      serverNow: Math.floor(Date.now() / 1000),
      lastSentAt: null,
      lastReceivedAt: null,
    });
  }
}
