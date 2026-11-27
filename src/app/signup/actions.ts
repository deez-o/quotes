"use server";

import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTenant } from "@/lib/companies";
import { isPaidPlan } from "@/lib/stripe-keys";

type Result = { ok: true; next: string } | { ok: false; message: string };

/**
 * Self sign-up: makes the login, the company (on the chosen plan) and makes them its admin.
 * Trial: straight into Setup. Paid plan: on to Stripe to pay (the billing page opens checkout).
 */
export async function signUp(input: { company: string; email: string; password: string; plan: string; website?: string }): Promise<Result> {
  try {
    // Bots fill in the hidden field; people don't see it.
    if (input.website) return { ok: false, message: "Couldn't sign you up." };
    const company = input.company.trim().slice(0, 120);
    const email = input.email.trim().toLowerCase();
    const plan = isPaidPlan(input.plan) ? input.plan : "trial";
    if (company.length < 2) return { ok: false, message: "Enter your company name." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter your email address." };
    if (input.password.length < 8) return { ok: false, message: "Use a password of at least 8 characters." };

    const db = createAdminClient();
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

    // A few sign-ups a day from one place is plenty; stops someone farming free trials.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await db.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "signup").eq("target", ip).gte("created_at", since);
    if ((count ?? 0) >= 5) return { ok: false, message: "Too many sign-ups from here today. Contact quoteout and we'll set you up." };

    const { data: made, error } = await db.auth.admin.createUser({ email, password: input.password, email_confirm: true });
    if (error || !made.user) {
      const taken = /already|registered|exists/i.test(error?.message ?? "");
      return { ok: false, message: taken ? "That email already has a quoteout login. Sign in instead." : `Couldn't sign you up: ${error?.message ?? "unknown error"}` };
    }

    const tenant = await createTenant(db, company, plan);
    if (!tenant.ok) {
      await db.auth.admin.deleteUser(made.user.id);
      return tenant;
    }
    if (plan !== "trial") await db.from("tenants").update({ billing_status: "pending" }).eq("id", tenant.id);
    await db.from("memberships").insert({ tenant_id: tenant.id, user_id: made.user.id, role: "admin" });
    await db.from("audit_log").insert({ tenant_id: tenant.id, actor: made.user.id, action: "signup", target: ip });

    return { ok: true, next: plan === "trial" ? "/setup" : `/billing?start=${plan}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't sign you up." };
  }
}
