import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";
import type { Env, Member } from "@/lib/types";
import { sendPushNotificationWithResult } from "@/lib/push";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  try {
    const deviceId = request.cookies.get("deviceId")?.value;
    if (!deviceId) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
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

    if (!member.push_endpoint || !member.push_p256dh || !member.push_auth) {
      return NextResponse.json(
        { success: false, error: "No subscription", needsResubscribe: true },
        { status: 400 }
      );
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing push keys" },
        { status: 500 }
      );
    }

    const result = await sendPushNotificationWithResult(
      member,
      { title: "Test buzz", body: "" },
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
      env.VAPID_SUBJECT || "mailto:hello@cooling.app"
    );

    if (result.ok) {
      return NextResponse.json({ success: true });
    }

    if (result.status === 404 || result.status === 410) {
      await db
        .prepare(
          `UPDATE members
           SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL
           WHERE id = ?`
        )
        .bind(member.id)
        .run();
      return NextResponse.json(
        { success: false, error: "Subscription expired", needsResubscribe: true },
        { status: 410 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Push failed" },
      { status: 502 }
    );
  } catch (error) {
    console.error("Push test error:", error);
    return NextResponse.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
