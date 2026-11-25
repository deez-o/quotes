import { redirect } from "next/navigation";
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
 * (Picking between several tenants comes later; for now the first is used.)
 */
export async function requireTenant(): Promise<TenantContext> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims?.sub) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role, tenants ( id, name, status, file_storage )")
    .eq("user_id", claims.sub)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const tenant = membership?.tenants as unknown as TenantContext["tenant"] | null;
  if (!membership || !tenant) redirect("/no-access");

  return {
    userId: claims.sub,
    email: (claims.email as string | undefined) ?? null,
    tenant,
    role: membership.role as Role,
  };
}
