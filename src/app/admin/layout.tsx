import Link from "next/link";
import { Logo } from "../logo";
import { requireOwner } from "@/lib/owner";

export const metadata = { title: "quoteout admin", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await requireOwner();
  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ background: "var(--bitumen)", color: "#f3f4f6", padding: "14px 32px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <Link href="/admin" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={24} dark />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--brand)" }}>Admin</span>
        </Link>
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <Link href="/admin">Overview</Link>
          <Link href="/admin/new">Add a company</Link>
          <Link href="/admin/ai">AI model</Link>
          <Link href="/admin/errors">Errors</Link>
          <Link href="/admin/support">Help requests</Link>
          <Link href="/admin/bitumen">Bitumen index</Link>
        </nav>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#b6bcc4" }}>{me.email}</span>
        <Link href="/quotes" style={{ fontSize: 13, border: "1px solid #4a4f56", borderRadius: 6, padding: "6px 10px" }}>Back to the app</Link>
      </header>
      <main style={{ padding: "32px clamp(16px, 4vw, 48px)" }}>
        <div className="page" style={{ maxWidth: 1240 }}>{children}</div>
      </main>
    </div>
  );
}
