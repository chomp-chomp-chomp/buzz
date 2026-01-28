import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import type { Env, Member } from "@/lib/types";

export const runtime = "edge";

type SubscribePayload = PushSubscriptionJSON;

export async function POST(request: NextRequest) {
  try {
    const deviceId = request.cookies.get("deviceId")?.value;
    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const subscription: SubscribePayload = await request.json();
    if (!subscription?.endpoint || !subscription?.keys) {
      return NextResponse.json(
        { success: false, error: "Missing subscription" },
        { status: 400 }
      );
    }

    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      return NextResponse.json({ success: true });
    }

    const member = await db
      .prepare("SELECT * FROM members WHERE device_id = ?")
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json(
        { success: false, error: "Not paired" },
        { status: 403 }
      );
    }

    const userAgent = request.headers.get("user-agent");
    const updatedAt = Math.floor(Date.now() / 1000);

    try {
      await db
        .prepare(
          `UPDATE members
           SET push_endpoint = ?, push_p256dh = ?, push_auth = ?, push_user_agent = ?, push_updated_at = ?
           WHERE id = ?`
        )
        .bind(
          subscription.endpoint,
          subscription.keys?.p256dh ?? null,
          subscription.keys?.auth ?? null,
          userAgent,
          updatedAt,
          member.id
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("no such column: push_user_agent") ||
        message.includes("no such column: push_updated_at")
      ) {
        await db
          .prepare(
            `UPDATE members
             SET push_endpoint = ?, push_p256dh = ?, push_auth = ?
             WHERE id = ?`
          )
          .bind(
            subscription.endpoint,
            subscription.keys?.p256dh ?? null,
            subscription.keys?.auth ?? null,
            member.id
          )
          .run();
      } else {
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Push subscribe error:", error);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
