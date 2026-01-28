"use client";

import Link from "next/link";

export default function DebugUtilities() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <nav style={styles.nav}>
          <Link href="/" style={styles.backLink}>
            ← Back
          </Link>
        </nav>
        <h1 style={styles.h1}>Debug Utilities</h1>

        <div style={styles.list}>
          <Link href="/api/debug" style={styles.link}>
            Push subscription status
          </Link>
          <Link href="/api/test-push" style={styles.link}>
            Test push delivery
          </Link>
          <Link href="/notifications" style={styles.link}>
            Enable notifications
          </Link>
        </div>
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
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  link: {
    fontSize: 15,
    textDecoration: "none",
    color: "inherit",
    opacity: 0.85,
    width: "fit-content",
    borderBottom: "1px solid rgba(0,0,0,0.18)",
    paddingBottom: 2,
  },
};
