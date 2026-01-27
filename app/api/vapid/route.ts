import { NextRequest, NextResponse } from 'next/server';
import type { Env } from '@/lib/types';

export const runtime = 'edge';

export async function GET(_request: NextRequest) {
  const env: Env = (_request as any).cf?.env || process.env;
  const publicKey = env.VAPID_PUBLIC_KEY;

  if (!publicKey) {
    return NextResponse.json(
      { error: 'VAPID public key not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({ publicKey });
}
