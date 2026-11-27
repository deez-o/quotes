import Link from "next/link";
import { Logo } from "../logo";
import { requireTenant } from "@/lib/tenant";
import { signOut } from "@/app/actions";
import { NavLinks } from "./nav";
import { cookies } from "next/headers";
import { TENANT_COOKIE } from "@/lib/tenant";
import { isOwner } from "@/lib/owner";
import { workInOwnCompany } from "@/app/admin/actions";

const ROLE_LABEL = { admin: "Client admin", estimator: "Estimator", viewer: "Viewer" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const owner = await isOwner(ctx.userId);
  const visiting = owner && (await cookies()).get(TENANT_COOKIE)?.value === ctx.tenant.id;

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
            {owner && <Link href="/admin" style={{ border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 6, padding: "6px 10px" }}>Admin</Link>}
            <Link href="/account" style={{ border: "1px solid #4a4f56", borderRadius: 6, padding: "6px 10px", color: "var(--nav-ink)" }}>Password</Link>
            <form action={signOut}>
              <button type="submit" style={{ marginTop: 0 }}>Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <main className="main">
        {visiting && (
          <form action={workInOwnCompany} className="card row" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", padding: "10px 16px", gap: 12, marginBottom: 20 }}>
            <span className="grow">You&apos;re setting up <strong>{ctx.tenant.name}</strong> as quoteout staff. Anything you change here is theirs.</span>
            <button className="btn" style={{ padding: "6px 12px" }}>Back to admin</button>
          </form>
        )}
        {children}
      </main>
    </div>
  );
}
