import Link from "next/link";
import { Logo } from "../logo";
import { requireTenant } from "@/lib/tenant";
import { signOut } from "@/app/actions";
import { NavLinks } from "./nav";
import { SessionGuard } from "../session-guard";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadAccess } from "@/lib/access-load";
import { TENANT_COOKIE } from "@/lib/tenant";
import { isOwner } from "@/lib/owner";
import { workInOwnCompany } from "@/app/admin/actions";

const ROLE_LABEL = { admin: "Client admin", estimator: "Estimator", viewer: "Viewer" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();
  const owner = await isOwner(ctx.userId);
  const { access } = await loadAccess(ctx.tenant.id);
  // Trial over or not paid: the only place to go is the billing page (quoteout staff can still look around).
  if (access.state === "locked" && !owner) redirect("/billing");
  const visiting = owner && (await cookies()).get(TENANT_COOKIE)?.value === ctx.tenant.id;

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><Logo size={26} dark /></div>
        <NavLinks />
        <div className="who">
          <span className="who-name">
            {ctx.tenant.name}
            <br />
            {ROLE_LABEL[ctx.role]}
          </span>
          <div className="who-links" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {owner && <Link href="/admin" style={{ border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 6, padding: "6px 10px" }}>Admin</Link>}
            {ctx.role === "admin" && <Link href="/billing" style={{ border: "1px solid #4a4f56", borderRadius: 6, padding: "6px 10px", color: "var(--nav-ink)" }}>Plan</Link>}
            <Link href="/account" style={{ border: "1px solid #4a4f56", borderRadius: 6, padding: "6px 10px", color: "var(--nav-ink)" }}>Password</Link>
            <form action={signOut}>
              <button type="submit" style={{ marginTop: 0 }}>Sign out</button>
            </form>
          </div>
        </div>
      </nav>
      <SessionGuard />
      <main className="main">
        {access.state === "ok" && access.banner && (
          <div className="card row" style={{ background: "var(--warn-bg)", borderColor: "#f0dba5", padding: "10px 16px", gap: 12, marginBottom: 20 }}>
            <span className="grow">{access.banner}</span>
            {ctx.role === "admin" && <Link href="/billing" className="btn primary" style={{ padding: "6px 12px" }}>Choose a plan</Link>}
          </div>
        )}
        {access.state === "locked" && owner && (
          <div className="card" style={{ background: "var(--bad-bg)", borderColor: "var(--accent)", padding: "10px 16px", marginBottom: 20 }}>Locked for customers: {access.message}</div>
        )}
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
