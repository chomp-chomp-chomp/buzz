"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function NotificationsPage() {
  const [status, setStatus] = useState<string>("Checking...");
  const [canEnable, setCanEnable] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");

  useEffect(() => {
    const id = localStorage.getItem("deviceId") || "";
    setDeviceId(id);
  }, []);

  useEffect(() => {
    checkStatus();
  }, []);

  async function checkStatus() {
    if (!("PushManager" in window)) {
      setStatus("Push notifications are not supported on this device.");
      return;
    }
    if (!("serviceWorker" in navigator)) {
      setStatus("Service workers are not available.");
      return;
    }

    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus(
        "Notifications are blocked. To fix this, go to Settings → Notifications → find this app → enable Allow Notifications."
      );
      return;
    }

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setStatus("Notifications are enabled.");
      } else {
        setStatus("Notifications are not enabled yet.");
        setCanEnable(true);
      }
    } catch (e) {
      setStatus("Could not check notification status.");
      setCanEnable(true);
    }
  }

  const enableNotifications = useCallback(async () => {
    setCanEnable(false);
    setStatus("Requesting permission...");

    try {
      if (!("serviceWorker" in navigator)) {
        setStatus("Service workers not available.");
        return;
      }

      // Ensure SW is registered
      const reg = await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(
          "Permission was not granted. Check your device notification settings for this app."
        );
        setCanEnable(true);
        return;
      }

      // Get VAPID key
      const vapidRes = await fetch("/api/vapid-key");
      const vapidData = (await vapidRes.json()) as { publicKey?: string };
      if (!vapidData.publicKey) {
        setStatus("Server configuration error: no VAPID key.");
        return;
      }

      // Create subscription
      const padding = "=".repeat(
        (4 - (vapidData.publicKey.length % 4)) % 4
      );
      const base64 = (vapidData.publicKey + padding)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const rawData = window.atob(base64);
      const applicationServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        applicationServerKey[i] = rawData.charCodeAt(i);
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      if (!subscription) {
        setStatus("Failed to create push subscription.");
        setCanEnable(true);
        return;
      }

      // Save to server
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          subscription: subscription.toJSON(),
        }),
      });

      if (!res.ok) {
        setStatus("Failed to save subscription to server.");
        setCanEnable(true);
        return;
      }

      setStatus("Notifications are now enabled.");
    } catch (e) {
      setStatus(`Error: ${e}`);
      setCanEnable(true);
    }
  }, [deviceId]);

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.backLink}>
            ← Back
          </Link>
        </nav>
        <h1 style={styles.h1}>Notifications</h1>

        <p style={styles.statusText}>{status}</p>

        {canEnable && (
          <button
            type="button"
            onClick={enableNotifications}
            style={styles.button}
          >
            Enable notifications
          </button>
        )}
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
  container: {
    maxWidth: 680,
    margin: "0 auto",
    padding: "24px 18px 48px",
  },
  nav: {
    marginBottom: 8,
  },
  backLink: {
    fontSize: 13,
    textDecoration: "none",
    color: "inherit",
    opacity: 0.6,
  },
  h1: {
    fontSize: 20,
    fontWeight: 600,
    margin: "4px 0 24px",
    letterSpacing: 0.2,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 1.5,
    opacity: 0.85,
    marginBottom: 20,
  },
  button: {
    fontSize: 14,
    padding: "12px 20px",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    color: "#111",
  },
};
