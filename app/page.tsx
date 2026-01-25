"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function HomePage() {
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Optional: you can fetch /api/me here to get cooldownRemainingSeconds
  // Keeping it minimal; wire it up once your API exists.
  useEffect(() => {
    let timer: number | null = null;
    if (cooldownRemaining !== null && cooldownRemaining > 0) {
      timer = window.setInterval(() => {
        setCooldownRemaining((prev) => {
          if (prev === null) return prev;
          return prev <= 1 ? 0 : prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [cooldownRemaining]);

  const isCoolingDown = (cooldownRemaining ?? 0) > 0;

  // Calm timing
  const pressDurationMs = 120;

  async function handleBuzz() {
    if (isSending || isCoolingDown) return;
    setIsSending(true);

    try {
      // Call your Worker endpoint. Expect:
      // - 200 { cooldownSeconds: 69 }
      // - 429 { remainingSeconds: n }
      const res = await fetch("/api/buzz", { method: "POST" });

      if (res.status === 429) {
        const data = await res.json().catch(() => null);
        const remaining = Number(data?.remainingSeconds ?? 0);
        setCooldownRemaining(Math.max(0, remaining));
        return;
      }

      if (!res.ok) {
        // Fail quietly; this app avoids theatrics.
        return;
      }

      const data = await res.json().catch(() => null);
      const cd = Number(data?.cooldownSeconds ?? 69);
      setCooldownRemaining(cd);
    } finally {
      // Slight delay so “press” feels real
      window.setTimeout(() => setIsSending(false), pressDurationMs);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.centerWrap}>
        <button
          type="button"
          onClick={handleBuzz}
          disabled={isCoolingDown || isSending}
          aria-disabled={isCoolingDown || isSending}
          style={{
            ...styles.heartButton,
            transform: isSending ? "scale(0.98)" : "scale(1)",
            opacity: isCoolingDown ? 0.7 : 1,
          }}
        >
          <Image
            src="/heart-cookie.png"
            alt="Heart cookie"
            width={240}
            height={240}
            priority
            style={styles.heartImage as any}
          />
          {isCoolingDown && (
            <div style={styles.cooldownBadge}>
              {cooldownRemaining}s
            </div>
          )}
        </button>

        <div style={styles.status}>
          {isCoolingDown ? `cooling down: ${cooldownRemaining}s` : "ready to buzz"}
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
    transition: "transform 120ms cubic-bezier(0.2, 0.0, 0.0, 1.0), opacity 120ms linear",
    position: "relative",
    WebkitTapHighlightColor: "transparent",
  },
  heartImage: {
    display: "block",
    userSelect: "none",
  },
  cooldownBadge: {
    position: "absolute",
    right: -8,
    bottom: -8,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.95)",
    opacity: 0.9,
  },
  status: {
    fontSize: 14,
    opacity: 0.85,
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
};