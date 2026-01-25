import Link from "next/link";

export default function AboutPage() {
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <div style={styles.line1}>
          This app is complete. The rest is documentation.
        </div>

        <div style={styles.label}>Documentation</div>

        <Link href="/notes" style={styles.link}>
          Notes
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
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    width: "100%",
    maxWidth: 520,
    padding: "24px 18px",
    display: "flex",
    flexDirection: "column",
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