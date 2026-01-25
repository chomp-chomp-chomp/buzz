import { NextRequest, NextResponse } from 'next/server';
import type { Env, Pair, Member, PairRequest, PairResponse } from '@/lib/types';
import { sha256, generateId, generatePairCode } from '@/lib/crypto';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const body: PairRequest = await request.json();
    const { code, deviceId } = body;

    if (!deviceId) {
      return NextResponse.json<PairResponse>(
        { success: false, paired: false, error: 'Device ID required' },
        { status: 400 }
      );
    }

    // Normalize code: uppercase, remove dashes
    const normalizedCode = code.toUpperCase().replace(/-/g, '');
    if (normalizedCode.length !== 8) {
      return NextResponse.json<PairResponse>(
        { success: false, paired: false, error: 'Invalid code format' },
        { status: 400 }
      );
    }

    // Hash the code
    const codeHash = await sha256(normalizedCode);

    // Get Cloudflare bindings
    // @ts-expect-error - Cloudflare bindings
    const env: Env = (request as any).cf?.env || process.env;
    const db = env.DB;

    if (!db) {
      // Development mode - return mock response
      const response = NextResponse.json<PairResponse>({
        success: true,
        paired: true,
      });
      response.cookies.set('deviceId', deviceId, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: '/',
      });
      return response;
    }

    // Check if device is already paired
    const existingMember = await db
      .prepare('SELECT * FROM members WHERE device_id = ?')
      .bind(deviceId)
      .first<Member>();

    if (existingMember) {
      // Already paired - check if partner exists
      const partner = await db
        .prepare('SELECT * FROM members WHERE pair_id = ? AND device_id != ?')
        .bind(existingMember.pair_id, deviceId)
        .first<Member>();

      const response = NextResponse.json<PairResponse>({
        success: true,
        paired: !!partner,
        waiting: !partner,
      });
      response.cookies.set('deviceId', deviceId, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
      });
      return response;
    }

    // Check if pair already exists with this code
    const existingPair = await db
      .prepare('SELECT * FROM pairs WHERE pair_code_hash = ?')
      .bind(codeHash)
      .first<Pair>();

    if (existingPair) {
      // Check how many members this pair has
      const members = await db
        .prepare('SELECT COUNT(*) as count FROM members WHERE pair_id = ?')
        .bind(existingPair.id)
        .first<{ count: number }>();

      const memberCount = members?.count || 0;

      if (memberCount >= 2) {
        return NextResponse.json<PairResponse>(
          { success: false, paired: false, error: 'Pair is full' },
          { status: 409 }
        );
      }

      // Add as second member
      const memberId = generateId();
      await db
        .prepare(
          'INSERT INTO members (id, pair_id, device_id) VALUES (?, ?, ?)'
        )
        .bind(memberId, existingPair.id, deviceId)
        .run();

      const response = NextResponse.json<PairResponse>({
        success: true,
        paired: true,
      });
      response.cookies.set('deviceId', deviceId, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 365,
        path: '/',
      });
      return response;
    }

    // Create new pair
    const pairId = generateId();
    const memberId = generateId();

    await db.batch([
      db
        .prepare('INSERT INTO pairs (id, pair_code_hash) VALUES (?, ?)')
        .bind(pairId, codeHash),
      db
        .prepare(
          'INSERT INTO members (id, pair_id, device_id) VALUES (?, ?, ?)'
        )
        .bind(memberId, pairId, deviceId),
    ]);

    const response = NextResponse.json<PairResponse>({
      success: true,
      paired: false,
      waiting: true,
    });
    response.cookies.set('deviceId', deviceId, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 365,
      path: '/',
    });
    return response;
  } catch (error) {
    console.error('Pair error:', error);
    return NextResponse.json<PairResponse>(
      { success: false, paired: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}

// GET endpoint to generate a new pairing code
export async function GET() {
  const code = generatePairCode();
  return NextResponse.json({ code });
}
