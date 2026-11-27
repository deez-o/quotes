import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

/** Cookie naming the company someone is working in, when they belong to more than one. */
export const TENANT_COOKIE = "qo_tenant";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "estimator" | "viewer";

export type TenantContext = {
  userId: string;
  email: string | null;
  tenant: { id: string; name: string; status: string; file_storage: string };
  role: Role;
};

/**
 * The signed-in user and the tenant they are working in.
 * Sends them to /login if signed out, or /no-access if they belong to no tenant.
 * Someone in several companies works in the one named by the qo_tenant cookie, else their first.
 * Cached per request, so the layout and the page share one lookup.
 */
export const requireTenant = cache(async function requireTenant(): Promise<TenantContext> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  // Someone in more than one company (e.g. quoteout staff setting up a customer) works in the one they picked.
  const picked = (await cookies()).get(TENANT_COOKIE)?.value;
  const { data: memberships } = await supabase
    .from("memberships")
    .select("tenant_id, role, tenants ( id, name, status, file_storage )")
    .eq("user_id", claims.sub)
    .is("disabled_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  const membership = (memberships ?? []).find((m) => m.tenant_id === picked) ?? memberships?.[0] ?? null;

  const tenant = membership?.tenants as unknown as TenantContext["tenant"] | null;
  if (!membership || !tenant) redirect("/no-access");

  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    tenant,
    role: membership.role as Role,
  };
});
