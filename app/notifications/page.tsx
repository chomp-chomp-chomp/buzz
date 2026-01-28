"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ensurePushSubscription,
  getNotificationStatus,
  type NotificationStatus,
} from "@/lib/push-client";

type ActionState = "idle" | "working" | "success" | "error";

export default function NotificationsPage() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [actionMessage, setActionMessage] = useState<string>("");
  const [testMessage, setTestMessage] = useState<string>("");
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("deviceId", id);
    }
    document.cookie = `deviceId=${id}; path=/; max-age=31536000; SameSite=Strict`;
  }, []);

  const refreshStatus = useCallback(async () => {
    const nextStatus = await getNotificationStatus();
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const isIos = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }, []);

  const statusText = useMemo(() => {
    if (!status) return "loading";
    if (status.statusLabel === "Enabled") return "on";
    if (status.statusLabel === "Denied") return "denied";
    if (status.statusLabel === "Not installed") return "not installed";
    return "off";
  }, [status]);

  const primaryLabel = useMemo(() => {
    if (!status) return "Checking…";
    if (status.permission === "default") return "Enable notifications";
    if (status.permission === "granted") return "Fix notifications";
    if (status.permission === "denied") return "How to enable on iPhone";
    return "Notifications unavailable";
  }, [status]);

  const handlePrimary = useCallback(async () => {
    if (!status) return;

    setActionMessage("");
    setTestMessage("");
    setActionState("working");

    if (status.permission === "denied") {
      setHelpOpen(true);
      setActionState("idle");
      return;
    }

    if (status.permission === "default") {
      if (isIos && !status.isInstalled) {
        setActionMessage("Install to Home Screen to enable notifications on iPhone.");
        setActionState("idle");
        return;
      }

      if (!("Notification" in window)) {
        setActionMessage("Notifications are not supported in this browser.");
        setActionState("error");
        return;
      }

      const result = await Notification.requestPermission();
      if (result === "granted") {
        try {
          await ensurePushSubscription({ forceResubscribe: false });
          setActionMessage("Notifications ready.");
          setActionState("success");
        } catch (error) {
          setActionMessage("Notifications are on, but subscription failed. Try Fix.");
          setActionState("error");
          console.error(error);
        }
      } else if (result === "denied") {
        setHelpOpen(true);
        setActionState("idle");
      } else {
        setActionState("idle");
      }

      await refreshStatus();
      return;
    }

    if (status.permission === "granted") {
      try {
        await ensurePushSubscription({ forceResubscribe: false });
        setActionMessage("Notifications ready.");
        setActionState("success");
      } catch (error) {
        try {
          await ensurePushSubscription({ forceResubscribe: true });
          setActionMessage("Notifications ready.");
          setActionState("success");
        } catch (retryError) {
          setActionMessage("Notifications are on, but subscription failed. Try Fix.");
          setActionState("error");
          console.error(error);
          console.error(retryError);
        }
      }
      await refreshStatus();
      return;
    }

    setActionState("idle");
  }, [status, isIos, refreshStatus]);

  const handleTest = useCallback(async () => {
    setTestMessage("");
    setActionState("working");

    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (res.ok) {
        setTestMessage("Test sent.");
        setActionState("success");
      } else {
        const data = (await res.json().catch(() => null)) as
          | { needsResubscribe?: boolean }
          | null;
        setTestMessage(
          data?.needsResubscribe ? "Failed. Tap Fix notifications." : "Failed."
        );
        setActionState("error");
      }
    } catch (error) {
      setTestMessage("Failed.");
      setActionState("error");
      console.error(error);
    }
  }, []);

  const showTestButton =
    status?.permission === "granted" && status.subscriptionExists;

  return (
    <main style={styles.page}>
      <nav style={styles.nav}>
        <Link href="/about" style={styles.backLink}>
          ← Back
        </Link>
      </nav>
      <div style={styles.container}>
        <h1 style={styles.h1}>Notifications</h1>

        <section style={styles.card}>
          <div style={styles.statusLine}>
            <span style={styles.statusLabel}>Notifications:</span>
            <span style={styles.statusValue}>{statusText}</span>
          </div>
          <div style={styles.secondaryText}>{status?.secondaryText ?? ""}</div>

          <div style={styles.buttonRow}>
            <button
              type="button"
              onClick={handlePrimary}
              disabled={actionState === "working" || status?.permission === "unsupported"}
              style={{
                ...styles.primaryButton,
                opacity: actionState === "working" ? 0.6 : 1,
              }}
            >
              {primaryLabel}
            </button>
            {showTestButton ? (
              <button
                type="button"
                onClick={handleTest}
                disabled={actionState === "working"}
                style={{
                  ...styles.secondaryButton,
                  opacity: actionState === "working" ? 0.6 : 1,
                }}
              >
                Send test buzz
              </button>
            ) : null}
          </div>

          {actionMessage ? (
            <div style={styles.notice}>{actionMessage}</div>
          ) : null}

          {testMessage ? <div style={styles.notice}>{testMessage}</div> : null}

          {helpOpen ? (
            <div style={styles.helpPanel}>
              <div style={styles.helpTitle}>Enable notifications on iPhone</div>
              <ol style={styles.helpList}>
                <li>Settings → Notifications → find “Cooling” → Allow Notifications.</li>
                <li>If missing, remove the Home Screen icon and Add to Home Screen again.</li>
                <li>Reopen Cooling and tap “Fix notifications.”</li>
              </ol>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#ffffff",
    minHeight: "100vh",
    color: "#111",
  },
  nav: {
    padding: "16px 18px 0",
  },
  backLink: {
    fontSize: 13,
    textDecoration: "none",
    color: "inherit",
    opacity: 0.6,
  },
  container: {
    maxWidth: 560,
    margin: "0 auto",
    padding: "16px 18px 48px",
  },
  h1: {
    fontSize: 20,
    fontWeight: 600,
    margin: "8px 0 16px",
    letterSpacing: 0.2,
  },
  card: {
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.08)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  statusLine: {
    display: "flex",
    gap: 6,
    alignItems: "baseline",
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: 600,
  },
  statusValue: {
    fontSize: 14,
    opacity: 0.8,
  },
  secondaryText: {
    fontSize: 12.5,
    opacity: 0.6,
    minHeight: 18,
  },
  buttonRow: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  primaryButton: {
    fontSize: 14,
    padding: "10px 16px",
    border: "1px solid rgba(0,0,0,0.2)",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
  },
  secondaryButton: {
    fontSize: 13,
    padding: "9px 16px",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 8,
    background: "rgba(0,0,0,0.04)",
    cursor: "pointer",
  },
  notice: {
    fontSize: 12.5,
    opacity: 0.7,
  },
  helpPanel: {
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(0,0,0,0.02)",
    padding: "12px 12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: 600,
  },
  helpList: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 12.5,
    lineHeight: 1.45,
    opacity: 0.8,
  },
};
