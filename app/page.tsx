"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ensurePushSubscription } from "@/lib/push-client";

type AppState = "loading" | "install" | "pair" | "waiting" | "ready";

const OVEN_SECONDS = 108;

export default function HomePage() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [sentRemaining, setSentRemaining] = useState<number>(0);
  const [receivedRemaining, setReceivedRemaining] = useState<number>(0);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [lastChompRelative, setLastChompRelative] = useState<string>("never");
  const [isSending, setIsSending] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [inputCode, setInputCode] = useState("");
  const [deviceId, setDeviceId] = useState<string>("");
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [devMode, setDevMode] = useState(false);

  const logDebug = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 80));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setDevMode(params.get("dev") === "1");
  }, []);

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
      if (!res.ok) {
        const body = await res.text();
        logDebug(`status failed (${res.status}) ${body}`);
        return;
      }
      const data: {
        ovenRemainingSeconds?: number;
        lastChompRelative?: string;
        serverNow?: number;
        lastSentAt?: number | null;
        lastReceivedAt?: number | null;
      } = await res.json();
      const serverNow = data.serverNow ?? Math.floor(Date.now() / 1000);
      const offsetMs = serverNow * 1000 - Date.now();
      const alignedNow = Math.floor((Date.now() + offsetMs) / 1000);
      setServerOffsetMs(offsetMs);
      setLastSentAt(data.lastSentAt ?? null);
      setLastReceivedAt(data.lastReceivedAt ?? null);
      const sentRemainingSeconds = data.lastSentAt
        ? Math.max(0, OVEN_SECONDS - (alignedNow - data.lastSentAt))
        : 0;
      const receivedRemainingSeconds = data.lastReceivedAt
        ? Math.max(0, OVEN_SECONDS - (alignedNow - data.lastReceivedAt))
        : 0;
      if (sentRemainingSeconds > 0) {
        setSentRemaining(sentRemainingSeconds);
      } else {
        setSentRemaining(0);
      }
      if (receivedRemainingSeconds > 0) {
        setReceivedRemaining(receivedRemainingSeconds);
      } else {
        setReceivedRemaining(0);
      }
      setLastChompRelative(data.lastChompRelative || "never");
      logDebug(
        `status ok (sentRemaining=${sentRemainingSeconds}, receivedRemaining=${receivedRemainingSeconds}, last=${data.lastChompRelative ?? "never"})`
      );
    } catch (e) {
      logDebug("status failed (network)");
      // Ignore
    }
  }, [logDebug]);

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
        if (!res.ok) {
          const body = await res.text();
          logDebug(`me failed (${res.status}) ${body}`);
          setAppState("pair");
          return;
        }
        const data: { paired?: boolean; hasPartner?: boolean } = await res.json();
        logDebug(`me ok (paired=${data.paired ?? false}, hasPartner=${data.hasPartner ?? false})`);

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
          await subscribeToPush();
        } else {
          setAppState("pair");
        }
      } catch (e) {
        logDebug("init failed; defaulting to pair (network)");
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
    if (!lastSentAt && !lastReceivedAt) return;

    const timer = setInterval(() => {
      const alignedNow = Math.floor((Date.now() + serverOffsetMs) / 1000);
      const nextSent = lastSentAt
        ? Math.max(0, OVEN_SECONDS - (alignedNow - lastSentAt))
        : 0;
      const nextReceived = lastReceivedAt
        ? Math.max(0, OVEN_SECONDS - (alignedNow - lastReceivedAt))
        : 0;
      setSentRemaining(nextSent);
      setReceivedRemaining(nextReceived);
    }, 1000);

    return () => clearInterval(timer);
  }, [lastSentAt, lastReceivedAt, serverOffsetMs]);

  useEffect(() => {
    if (!deviceId) return;
    logDebug(`device ready (${deviceId.slice(0, 8)}...)`);
  }, [deviceId, logDebug]);

  useEffect(() => {
    if (!deviceId) return;
    logDebug(`device ready (${deviceId.slice(0, 8)}...)`);
  }, [deviceId, logDebug]);

  // Subscribe to push notifications
  async function subscribeToPush() {
    logDebug("push: starting subscription flow");

    if (!("Notification" in window)) {
      logDebug("push: Notification API not available");
      return;
    }
    if (Notification.permission !== "granted") {
      logDebug("push: permission not granted");
      return;
    }

    try {
      await ensurePushSubscription({ forceResubscribe: false });
      logDebug("push: subscription ensured");
    } catch (e) {
      console.error("Push subscription failed:", e);
      logDebug(`push: error - ${e}`);
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
      if (!res.ok) {
        const body = await res.text();
        logDebug(`pair failed (${res.status}) ${body}`);
        return;
      }
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
          await subscribeToPush();
        }
        logDebug(`pair ok (paired=${data.paired ?? false}, waiting=${data.waiting ?? false})`);
      }
    } catch (e) {
      console.error("Pairing failed:", e);
      logDebug("pair failed (network)");
    }
  }

  // Generate new code
  async function handleGenerateCode() {
    try {
      const res = await fetch("/api/pair");
      if (!res.ok) {
        const body = await res.text();
        logDebug(`pair code generation failed (${res.status}) ${body}`);
        return;
      }
      const data: { code?: string } = await res.json();
      if (data.code) {
        logDebug(`pair code generated (${data.code})`);
        handlePair(data.code);
      }
    } catch (e) {
      console.error("Code generation failed:", e);
      logDebug("pair code generation failed (network)");
    }
  }

  // Handle chomp
  async function handleChomp() {
    if (isSending || sentRemaining > 0) return;
    setIsSending(true);

    try {
      const res = await fetch("/api/buzz", {
        method: "POST",
        headers: devMode ? { "x-debug": "1" } : undefined,
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => null) as { remainingSeconds?: number } | null;
        const remaining = Number(data?.remainingSeconds ?? 0);
        setSentRemaining(Math.max(0, remaining));
        logDebug(`chomp rate-limited (${remaining}s)`);
        return;
      }

      if (res.ok) {
        const data = await res.json().catch(() => null) as { ovenSeconds?: number } | null;
        const oven = Number(data?.ovenSeconds ?? OVEN_SECONDS);
        setSentRemaining(oven);
        const alignedNow = Math.floor((Date.now() + serverOffsetMs) / 1000);
        setLastSentAt(alignedNow);
        logDebug(`chomp ok (oven=${oven}s)`);
      } else {
        const body = await res.text();
        logDebug(`chomp failed (${res.status}) ${body}`);
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
          logDebug("partner joined");
        }
      } catch (e) {
        logDebug("poll partner failed");
        // Ignore
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [appState, deviceId, fetchStatus]);

  const inOven = sentRemaining > 0;
  const debugPanel = devMode ? (
    <section style={styles.debugPanel}>
      <div style={styles.debugTitle}>Debug log</div>
      <button
        type="button"
        onClick={subscribeToPush}
        style={{ fontSize: 12, padding: "6px 12px", marginBottom: 8, border: "1px solid #ccc", borderRadius: 4, background: "#fff" }}
      >
        Enable Notifications
      </button>
      <div style={styles.debugBody}>
        {debugLogs.length === 0 ? "No logs yet." : debugLogs.join("\n")}
      </div>
    </section>
  ) : null;

  // Render based on state
  if (appState === "loading") {
    return (
      <main style={styles.page}>
        <div style={styles.centerWrap}>
          <div style={styles.status}>loading</div>
        </div>
        {debugPanel}
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
        {debugPanel}
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
        {debugPanel}
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
        {debugPanel}
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
            src={inOven ? "/heart-cookie.png" : "/round-cookie.png"}
            alt="Cookie"
            width={240}
            height={240}
            priority
            style={styles.heartImage as React.CSSProperties}
          />
          {receivedRemaining > 0 ? (
            <Image
              src="/heart-cookie.png"
              alt="Received chomp"
              width={48}
              height={48}
              priority
              style={styles.receivedBadge as React.CSSProperties}
            />
          ) : null}
        </button>

        <div style={styles.statusWrap}>
          <div style={styles.status}>
            {inOven ? `in the oven • ${sentRemaining} seconds` : "Cooling"}
          </div>
          <div style={styles.lastChomp}>last chomp received: {lastChompRelative}</div>
        </div>
      </div>

      <footer style={styles.footer}>
        <Link href="/about" style={styles.footerLink}>
          About
        </Link>
        <span style={styles.footerSep}>·</span>
        <Link href="/api/debug" style={styles.footerLink}>
          Debug
        </Link>
        <span style={styles.footerSep}>·</span>
        <Link href="/api/test-push" style={styles.footerLink}>
          Test Push
        </Link>
      </footer>
      {debugPanel}
    </main>
  );
}

function formatCode(code: string): string {
  const clean = code.replace(/-/g, "").toUpperCase();
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}`;
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
  receivedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 48,
    height: 48,
    pointerEvents: "none",
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
  footerSep: {
    fontSize: 13,
    opacity: 0.4,
    margin: "0 8px",
  },
  debugPanel: {
    borderTop: "1px solid rgba(0, 0, 0, 0.1)",
    padding: "12px 18px 20px",
    fontSize: 12,
    background: "#fafafa",
    color: "#222",
  },
  debugTitle: {
    fontWeight: 600,
    marginBottom: 6,
  },
  debugBody: {
    whiteSpace: "pre-wrap",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    opacity: 0.8,
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
