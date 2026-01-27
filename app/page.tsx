"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type AppState = "loading" | "install" | "pair" | "waiting" | "ready";

const OVEN_SECONDS = 108;

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [ovenRemaining, setOvenRemaining] = useState<number>(0);
  const [lastChompRelative, setLastChompRelative] = useState<string>("never");
  const [isSending, setIsSending] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [deviceId, setDeviceId] = useState<string>("");

  // Check if running in standalone mode (installed PWA)
  // Add ?dev=1 to URL to bypass for testing
  const isStandalone = useCallback(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "1") return true;
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true
    );
  }, []);

  // Generate or retrieve device ID and set cookie
  useEffect(() => {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("deviceId", id);
    }
    // Set cookie for API routes (expires in 1 year)
    document.cookie = `deviceId=${id}; path=/; max-age=31536000; SameSite=Strict`;
    setDeviceId(id);
  }, []);

  // Fetch status from server
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data: { ovenRemainingSeconds?: number; lastChompRelative?: string } = await res.json();
      if (data.ovenRemainingSeconds && data.ovenRemainingSeconds > 0) {
        setOvenRemaining(data.ovenRemainingSeconds);
      }
      setLastChompRelative(data.lastChompRelative || "never");
    } catch (e) {
      // Ignore
    }
  }, []);

  // Initialize app state
  useEffect(() => {
    async function init() {
      // Check standalone mode
      if (!isStandalone()) {
        setAppState("install");
        return;
      }

      // Register service worker
      if ("serviceWorker" in navigator) {
        try {
          await navigator.serviceWorker.register("/sw.js");
        } catch (e) {
          console.error("SW registration failed:", e);
        }
      }

      // Check pairing status
      try {
        const res = await fetch("/api/me");
        const data: { paired?: boolean; hasPartner?: boolean } = await res.json();

        if (data.paired && data.hasPartner) {
          setAppState("ready");
          // Fetch status for oven state and last chomp
          await fetchStatus();
          // Subscribe to push notifications
          await subscribeToPush();
        } else if (data.paired && !data.hasPartner) {
          setAppState("waiting");
          const stored = localStorage.getItem("pairCode");
          if (stored) setPairCode(stored);
        } else {
          setAppState("pair");
        }
      } catch (e) {
        setAppState("pair");
      }
    }

    if (deviceId) {
      init();
    }
  }, [deviceId, isStandalone, fetchStatus]);

  // Listen for visibility changes to refetch status
  useEffect(() => {
    if (appState !== "ready") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchStatus();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [appState, fetchStatus]);

  // Oven timer countdown
  useEffect(() => {
    if (ovenRemaining <= 0) return;

    const timer = setInterval(() => {
      setOvenRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [ovenRemaining]);

  // Subscribe to push notifications
  async function subscribeToPush() {
    if (!("PushManager" in window)) return;
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        // Get VAPID public key from server
        const vapidRes = await fetch("/api/vapid-key");
        const vapidData = await vapidRes.json() as { publicKey?: string };
        if (!vapidData.publicKey) return;

        // Convert base64 to Uint8Array
        const urlBase64ToUint8Array = (base64String: string) => {
          const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          const base64 = (base64String + padding)
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const rawData = window.atob(base64);
          const outputArray = new Uint8Array(rawData.length);
          for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
          }
          return outputArray;
        };

        // Create subscription
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
        });
      }

      if (subscription) {
        await fetch("/api/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            subscription: subscription.toJSON(),
          }),
        });
      }
    } catch (e) {
      console.error("Push subscription failed:", e);
    }
  }

  // Handle pairing
  async function handlePair(code: string) {
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, deviceId }),
      });
      const data: { success?: boolean; paired?: boolean; waiting?: boolean } = await res.json();

      if (data.success) {
        if (data.paired) {
          setAppState("ready");
          await fetchStatus();
          await subscribeToPush();
        } else if (data.waiting) {
          setAppState("waiting");
          localStorage.setItem("pairCode", code);
          setPairCode(code);
        }
      }
    } catch (e) {
      console.error("Pairing failed:", e);
    }
  }

  // Generate new code
  async function handleGenerateCode() {
    try {
      const res = await fetch("/api/pair");
      const data: { code?: string } = await res.json();
      if (data.code) {
        handlePair(data.code);
      }
    } catch (e) {
      console.error("Code generation failed:", e);
    }
  }

  // Handle chomp
  async function handleChomp() {
    if (isSending || ovenRemaining > 0) return;
    setIsSending(true);

    try {
      const res = await fetch("/api/buzz", { method: "POST" });

      if (res.status === 429) {
        const data = await res.json().catch(() => null) as { remainingSeconds?: number } | null;
        const remaining = Number(data?.remainingSeconds ?? 0);
        setOvenRemaining(Math.max(0, remaining));
        return;
      }

      if (res.ok) {
        const data = await res.json().catch(() => null) as { ovenSeconds?: number } | null;
        const oven = Number(data?.ovenSeconds ?? OVEN_SECONDS);
        setOvenRemaining(oven);
        setLastChompRelative("just now");
      }
    } finally {
      setTimeout(() => setIsSending(false), 120);
    }
  }

  // Poll for partner when waiting
  useEffect(() => {
    if (appState !== "waiting") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/me");
        const data: { paired?: boolean; hasPartner?: boolean } = await res.json();
        if (data.paired && data.hasPartner) {
          setAppState("ready");
          await fetchStatus();
          await subscribeToPush();
        }
      } catch (e) {
        // Ignore
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [appState, deviceId, fetchStatus]);

  const inOven = ovenRemaining > 0;

  // Render based on state
  if (appState === "loading") {
    return (
      <main style={styles.page}>
        <div style={styles.centerWrap}>
          <div style={styles.status}>loading</div>
        </div>
      </main>
    );
  }

  if (appState === "install") {
    return (
      <main style={styles.page}>
        <div style={styles.centerWrap}>
          <Image
            src="/heart-cookie.png"
            alt="Heart cookie"
            width={160}
            height={160}
            priority
            style={{ opacity: 0.6 }}
          />
          <div style={{ ...styles.status, marginTop: 24 }}>
            Add to Home Screen to continue
          </div>
          <div style={styles.installHint}>
            Tap the share button, then &quot;Add to Home Screen&quot;
          </div>
        </div>
        <footer style={styles.footer}>
          <Link href="/about" style={styles.footerLink}>
            About
          </Link>
        </footer>
      </main>
    );
  }

  if (appState === "pair") {
    return (
      <main style={styles.page}>
        <div style={styles.centerWrap}>
          <Image
            src="/heart-cookie.png"
            alt="Heart cookie"
            width={120}
            height={120}
            priority
            style={{ opacity: 0.5 }}
          />

          <div style={styles.pairSection}>
            <div style={styles.pairLabel}>Enter a code to pair</div>
            <input
              type="text"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              maxLength={9}
              style={styles.pairInput}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => handlePair(inputCode)}
              disabled={inputCode.replace(/-/g, "").length !== 8}
              style={{
                ...styles.pairButton,
                opacity: inputCode.replace(/-/g, "").length === 8 ? 1 : 0.5,
              }}
            >
              Pair
            </button>
          </div>

          <div style={styles.dividerText}>or</div>

          <button
            type="button"
            onClick={handleGenerateCode}
            style={styles.generateButton}
          >
            Create new pair
          </button>
        </div>
        <footer style={styles.footer}>
          <Link href="/about" style={styles.footerLink}>
            About
          </Link>
        </footer>
      </main>
    );
  }

  if (appState === "waiting") {
    return (
      <main style={styles.page}>
        <div style={styles.centerWrap}>
          <Image
            src="/heart-cookie.png"
            alt="Heart cookie"
            width={160}
            height={160}
            priority
            style={{ opacity: 0.5 }}
          />

          <div style={styles.waitingSection}>
            <div style={styles.waitingLabel}>Share this code with your person</div>
            <div style={styles.codeDisplay}>{formatCode(pairCode)}</div>
            <div style={styles.waitingHint}>Waiting for them to join...</div>
          </div>
        </div>
        <footer style={styles.footer}>
          <Link href="/about" style={styles.footerLink}>
            About
          </Link>
        </footer>
      </main>
    );
  }

  // Ready state - main chomp interface
  return (
    <main style={styles.page}>
      <div style={styles.centerWrap}>
        <button
          type="button"
          onClick={handleChomp}
          disabled={inOven || isSending}
          aria-disabled={inOven || isSending}
          style={{
            ...styles.heartButton,
            transform: isSending ? "scale(0.98)" : "scale(1)",
            opacity: inOven ? 0.7 : 1,
          }}
        >
          <Image
            src="/heart-cookie.png"
            alt="Heart cookie"
            width={240}
            height={240}
            priority
            style={styles.heartImage as React.CSSProperties}
          />
        </button>

        <div style={styles.statusWrap}>
          <div style={styles.status}>
            {inOven ? `in the oven • ${ovenRemaining} seconds` : "Cooling"}
          </div>
          <div style={styles.lastChomp}>last chomp: {lastChompRelative}</div>
        </div>
      </div>

      <footer style={styles.footer}>
        <Link href="/about" style={styles.footerLink}>
          About
        </Link>
      </footer>
    </main>
  );
}

function formatCode(code: string): string {
  const clean = code.replace(/-/g, "").toUpperCase();
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    background: "#ffffff",
    minHeight: "100vh",
    color: "#111",
    display: "flex",
    flexDirection: "column",
  },
  centerWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 18px",
    gap: 14,
  },
  heartButton: {
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    transition:
      "transform 120ms cubic-bezier(0.2, 0.0, 0.0, 1.0), opacity 120ms linear",
    position: "relative",
    WebkitTapHighlightColor: "transparent",
  },
  heartImage: {
    display: "block",
    userSelect: "none",
  },
  statusWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  },
  status: {
    fontSize: 14,
    opacity: 0.85,
  },
  lastChomp: {
    fontSize: 12,
    opacity: 0.55,
  },
  footer: {
    padding: "16px 18px",
    display: "flex",
    justifyContent: "center",
  },
  footerLink: {
    fontSize: 13,
    opacity: 0.7,
    textDecoration: "none",
    color: "inherit",
  },
  installHint: {
    fontSize: 12,
    opacity: 0.6,
    textAlign: "center",
    maxWidth: 240,
    marginTop: 8,
  },
  pairSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  },
  pairLabel: {
    fontSize: 14,
    opacity: 0.75,
  },
  pairInput: {
    fontSize: 20,
    fontFamily: "monospace",
    textAlign: "center",
    padding: "12px 16px",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: 8,
    outline: "none",
    width: 180,
    letterSpacing: 2,
  },
  pairButton: {
    fontSize: 14,
    padding: "10px 24px",
    border: "1px solid rgba(0,0,0,0.2)",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
  },
  dividerText: {
    fontSize: 12,
    opacity: 0.5,
    margin: "16px 0",
  },
  generateButton: {
    fontSize: 14,
    padding: "10px 20px",
    border: "none",
    borderRadius: 6,
    background: "rgba(0,0,0,0.06)",
    cursor: "pointer",
  },
  waitingSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    marginTop: 24,
  },
  waitingLabel: {
    fontSize: 14,
    opacity: 0.75,
  },
  codeDisplay: {
    fontSize: 28,
    fontFamily: "monospace",
    letterSpacing: 3,
    padding: "16px 24px",
    background: "rgba(0,0,0,0.03)",
    borderRadius: 8,
  },
  waitingHint: {
    fontSize: 12,
    opacity: 0.5,
    marginTop: 8,
  },
};
