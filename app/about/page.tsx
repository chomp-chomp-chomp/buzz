import Link from "next/link";

export default function AboutPage() {
  return (
    <main style={styles.page}>
      <nav style={styles.nav}>
        <Link href="/" style={styles.backLink}>
          ← Back
        </Link>
      </nav>
      <div style={styles.container}>
        <div style={styles.line1}>
          This app is complete. The rest is documentation.
        </div>

    {/* <div style={styles.label}>Documentation</div>
    */}
        <Link href="/notes" style={styles.link}>
          Documentation
        </Link>
        <Link href="/notifications" style={styles.link}>
          Notifications
        </Link>
      </div>
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
  nav: {
    padding: "16px 18px",
  },
  backLink: {
    fontSize: 13,
    textDecoration: "none",
    color: "inherit",
    opacity: 0.6,
  },
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    width: "100%",
    maxWidth: 520,
    margin: "0 auto",
    padding: "24px 18px",
    gap: 14,
  },
  line1: {
    fontSize: 16,
    lineHeight: 1.4,
  },
  label: {
    fontSize: 13,
    opacity: 0.65,
    letterSpacing: 0.2,
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
