import { requireTenant } from "@/lib/tenant";
import { signOut } from "@/app/actions";
import { NavLinks } from "./nav";

const ROLE_LABEL = { admin: "Client admin", estimator: "Estimator", viewer: "Viewer" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenant();

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">quoteout</div>
        <NavLinks />
        <div className="who">
          {ctx.tenant.name}
          <br />
          {ROLE_LABEL[ctx.role]}
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
