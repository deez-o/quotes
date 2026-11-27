import Link from "next/link";
import { Logo } from "../logo";
import { requireTenant } from "@/lib/tenant";
import { signOut } from "@/app/actions";
import { NavLinks } from "./nav";

const ROLE_LABEL = { admin: "Client admin", estimator: "Estimator", viewer: "Viewer" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><Logo size={26} dark /></div>
        <NavLinks />
        <div className="who">
          {ctx.tenant.name}
          <br />
          {ROLE_LABEL[ctx.role]}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Link href="/account" style={{ border: "1px solid #4a4f56", borderRadius: 6, padding: "6px 10px", color: "var(--nav-ink)" }}>Password</Link>
            <form action={signOut}>
              <button type="submit" style={{ marginTop: 0 }}>Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
