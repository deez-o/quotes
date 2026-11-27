import { requireTenant } from "@/lib/tenant";
import { PasswordForm } from "../settings/password-form";

/** Your own login: set a password so you can sign in without an email link. */
export default async function AccountPage() {
  const ctx = await requireTenant();
  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div>
        <h1>Your login</h1>
        <p className="sub">Signed in as {ctx.email ?? "you"}. Set a password to sign in with your email and password instead of waiting for a link.</p>
      </div>
      <PasswordForm />
    </div>
  );
}
