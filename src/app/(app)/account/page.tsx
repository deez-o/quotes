import { requireTenant } from "@/lib/tenant";
import { PasswordForm } from "../settings/password-form";

/** Your own login: set or change your password. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const ctx = await requireTenant();
  const { set } = await searchParams;
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div>
        <h1>{set ? "Choose your password" : "Your password"}</h1>
        <p className="sub">Signed in as {ctx.email ?? "you"}. {set ? "Pick a password you'll use to sign in from now on." : "Change the password you sign in with."}</p>
      </div>
      <PasswordForm />
    </div>
  );
}
