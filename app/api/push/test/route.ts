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
        {
          ok: false,
          status: 401,
          reason: "Not authenticated",
          endpointHost: null,
          action: "auth",
        },
        { status: 401 }
      );
    }

    const { env } = getRequestContext() as unknown as { env: Env };
    const db = env.DB;

    if (!db) {
      return NextResponse.json({ ok: true });
    }

    const member = await db
      .prepare("SELECT * FROM members WHERE device_id = ?")
      .bind(deviceId)
      .first<Member>();

    if (!member) {
      return NextResponse.json(
        {
          ok: false,
          status: 403,
          reason: "Not paired",
          endpointHost: null,
          action: "auth",
        },
        { status: 403 }
      );
    }

    if (!member.push_endpoint || !member.push_p256dh || !member.push_auth) {
      return NextResponse.json(
        {
          ok: false,
          status: 400,
          reason: "No subscription",
          endpointHost: member.push_endpoint ? new URL(member.push_endpoint).host : null,
          action: "resubscribe",
        },
        { status: 400 }
      );
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      return NextResponse.json(
        {
          ok: false,
          status: 500,
          reason: "Missing push keys",
          endpointHost: new URL(member.push_endpoint).host,
          action: "check_vapid_keys",
        },
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

    const endpointHost = result.endpointHost ?? new URL(member.push_endpoint).host;

    if (result.ok) {
      return NextResponse.json({ ok: true });
    }

    const status = result.status ?? 500;
    let action = "unknown";

    if (status === 401 || status === 403) {
      action = "check_vapid_keys";
    }

    if (status === 404 || status === 410) {
      action = "resubscribe";
      await db
        .prepare(
          `UPDATE members
           SET push_endpoint = NULL, push_p256dh = NULL, push_auth = NULL
           WHERE id = ?`
        )
        .bind(member.id)
        .run();
    }

    return NextResponse.json(
      {
        ok: false,
        status,
        reason: result.reason ?? "Push failed",
        endpointHost,
        action,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("Push test error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        status: 500,
        reason: message,
        endpointHost: null,
        action: "unknown",
      },
      { status: 500 }
    );
  }
}
