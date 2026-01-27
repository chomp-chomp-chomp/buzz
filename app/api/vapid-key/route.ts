import { NextResponse } from 'next/server';
import { getRequestContext } from '@cloudflare/next-on-pages';
import type { Env } from '@/lib/types';

export const runtime = 'edge';

export async function GET() {
  try {
    const { env } = getRequestContext() as unknown as { env: Env };

    if (!env.VAPID_PUBLIC_KEY) {
      return NextResponse.json({ publicKey: null });
    }

    return NextResponse.json({ publicKey: env.VAPID_PUBLIC_KEY });
  } catch (error) {
    console.error('VAPID key error:', error);
    return NextResponse.json({ publicKey: null });
  }
}
