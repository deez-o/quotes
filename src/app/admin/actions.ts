"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/owner";
import { endAllDevices, endDevice } from "@/lib/device-check";
import { PLANS, type PlanId } from "@/lib/plans";
import { TENANT_COOKIE } from "@/lib/tenant";
import { createTenant } from "@/lib/companies";

type Result = { ok: true; message?: string } | { ok: false; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["setup", "live", "paused"] as const;
const ROLES = ["admin", "estimator", "viewer"] as const;

async function audit(db: Awaited<ReturnType<typeof requireOwner>>["db"], actor: string, tenantId: string | null, action: string, target: string) {
  await db.from("audit_log").insert({ tenant_id: tenantId, actor, action, target });
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "quoteout.app";
  return `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
}

function intOrNull(v: FormDataEntryValue | null, min: number, max: number) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Use a whole number from ${min} to ${max}, or leave it blank.`);
  return n;
}

/** Plan, status, limits and notes for one company. */
export async function saveCompany(_: unknown, form: FormData): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    const id = String(form.get("id"));
    if (!UUID.test(id)) return { ok: false, message: "Unknown company." };
    const plan = String(form.get("plan")) as PlanId;
    if (!PLANS[plan]) return { ok: false, message: "Pick a plan." };
    const status = String(form.get("status"));
    if (!STATUSES.includes(status as (typeof STATUSES)[number])) return { ok: false, message: "Pick a status." };
    const name = String(form.get("name") ?? "").trim().slice(0, 120);
    if (!name) return { ok: false, message: "The company needs a name." };
    const trial = String(form.get("trial_ends_at") ?? "").trim();
    const billing = String(form.get("billing_status") ?? "none");
    if (!["none", "pending", "active", "past_due", "canceled"].includes(billing)) return { ok: false, message: "Pick a payment status." };
    const update = {
      name, plan, status,
      ai_quota_month: intOrNull(form.get("ai_quota_month"), 0, 100000),
      max_devices: intOrNull(form.get("max_devices"), 1, 20),
      trial_ends_at: trial ? new Date(`${trial}T23:59:59+10:00`).toISOString() : null,
      admin_note: String(form.get("admin_note") ?? "").slice(0, 2000) || null,
      billing_status: billing,
      past_due_since: billing === "past_due" ? new Date().toISOString() : null,
    };
    const { error } = await db.from("tenants").update(update).eq("id", id);
    if (error) return { ok: false, message: error.message };
    await audit(db, userId, id, "admin.company.update", JSON.stringify({ plan, status, ai: update.ai_quota_month, devices: update.max_devices }));
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${id}`);
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save." };
  }
}

/** A new customer company, with its first admin invited by email. */
export async function createCompany(_: unknown, form: FormData): Promise<Result> {
  let newId: string | null = null;
  try {
    const { db, userId } = await requireOwner();
    const name = String(form.get("name") ?? "").trim().slice(0, 120);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const plan = String(form.get("plan") ?? "trial") as PlanId;
    if (!name) return { ok: false, message: "Give the company a name." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter the email of the person who'll run it." };
    if (!PLANS[plan]) return { ok: false, message: "Pick a plan." };

    const made = await createTenant(db, name, plan);
    if (!made.ok) return made;
    newId = made.id;

    const invited = await inviteMember(db, newId, email, "admin", String(form.get("password") ?? "") || undefined);
    if (!invited.ok) return invited;

    await audit(db, userId, newId, "admin.company.create", `${name} (${plan}) admin ${email}`);
    revalidatePath("/admin");
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't create the company." };
  }
  redirect(`/admin/companies/${newId}?made=1`);
}

/**
 * Add someone to a company. With a starting password their login is made straight away (you tell them it);
 * without one they get an email invite to choose their own. Existing quoteout users are just added.
 */
async function inviteMember(db: Awaited<ReturnType<typeof requireOwner>>["db"], tenantId: string, email: string, role: (typeof ROLES)[number], password?: string): Promise<Result> {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  let user = list?.users.find((u) => u.email?.toLowerCase() === email);
  let message = `Added ${email}.`;
  if (!user && password) {
    if (password.length < 8) return { ok: false, message: "Starting passwords need at least 8 characters." };
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return { ok: false, message: `Couldn't make the login: ${error?.message ?? "unknown error"}` };
    user = data.user;
    message = `Login made for ${email}. Give them the starting password; they can change it under Password.`;
  } else if (!user) {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${await origin()}/auth/session` });
    if (error || !data.user) return { ok: false, message: `Couldn't send the invite: ${error?.message ?? "unknown error"}` };
    user = data.user;
    message = `Invite sent to ${email}.`;
  }
  const { error } = await db.from("memberships").upsert({ tenant_id: tenantId, user_id: user.id, role, disabled_at: null }, { onConflict: "tenant_id,user_id" });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message };
}

export async function addPerson(_: unknown, form: FormData): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    const tenantId = String(form.get("tenant_id"));
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "estimator") as (typeof ROLES)[number];
    if (!UUID.test(tenantId)) return { ok: false, message: "Unknown company." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: "Enter an email address." };
    if (!ROLES.includes(role)) return { ok: false, message: "Pick a role." };
    const r = await inviteMember(db, tenantId, email, role, String(form.get("password") ?? "") || undefined);
    if (r.ok) await audit(db, userId, tenantId, "admin.person.add", `${email} as ${role}`);
    revalidatePath(`/admin/companies/${tenantId}`);
    return r;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't add them." };
  }
}

/** Switch one person's login off or back on. Switching off also signs them out everywhere. */
export async function setPersonEnabled(input: { tenantId: string; userId: string; enabled: boolean }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.tenantId) || !UUID.test(input.userId)) return { ok: false, message: "Unknown person." };
    if (input.userId === userId && !input.enabled) return { ok: false, message: "You can't switch off your own login." };
    await db.from("memberships").update({ disabled_at: input.enabled ? null : new Date().toISOString() }).eq("tenant_id", input.tenantId).eq("user_id", input.userId);
    if (!input.enabled) await endAllDevices(db, input.userId, "Login switched off by quoteout");
    await audit(db, userId, input.tenantId, input.enabled ? "admin.person.enable" : "admin.person.disable", input.userId);
    revalidatePath(`/admin/companies/${input.tenantId}`);
    revalidatePath("/admin");
    return { ok: true, message: input.enabled ? "Login switched back on." : "Login switched off and signed out everywhere." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't change that." };
  }
}

export async function setPersonRole(input: { tenantId: string; userId: string; role: string }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.tenantId) || !UUID.test(input.userId)) return { ok: false, message: "Unknown person." };
    if (!ROLES.includes(input.role as (typeof ROLES)[number])) return { ok: false, message: "Pick a role." };
    await db.from("memberships").update({ role: input.role }).eq("tenant_id", input.tenantId).eq("user_id", input.userId);
    await audit(db, userId, input.tenantId, "admin.person.role", `${input.userId} → ${input.role}`);
    revalidatePath(`/admin/companies/${input.tenantId}`);
    return { ok: true, message: "Role changed." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't change that." };
  }
}

export async function signOutEverywhere(input: { tenantId: string; userId: string }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.userId)) return { ok: false, message: "Unknown person." };
    await endAllDevices(db, input.userId, "Signed out by quoteout");
    await audit(db, userId, UUID.test(input.tenantId) ? input.tenantId : null, "admin.person.signout_all", input.userId);
    revalidatePath(`/admin/companies/${input.tenantId}`);
    return { ok: true, message: "Signed out on every device (within 5 minutes)." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't sign them out." };
  }
}

export async function signOutDevice(input: { tenantId: string; deviceRowId: string }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.deviceRowId)) return { ok: false, message: "Unknown device." };
    const { data: d } = await db.from("user_devices").select("id, user_id, session_id").eq("id", input.deviceRowId).maybeSingle();
    if (!d) return { ok: false, message: "Unknown device." };
    await endDevice(db, d.id, d.user_id, d.session_id, "Signed out by quoteout");
    await audit(db, userId, UUID.test(input.tenantId) ? input.tenantId : null, "admin.device.signout", d.id);
    revalidatePath(`/admin/companies/${input.tenantId}`);
    return { ok: true, message: "That device will be signed out within 5 minutes." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't sign it out." };
  }
}

/** Open the app as a member of this company, to set up their rates and rules. */
export async function workInCompany(form: FormData) {
  const { db, userId } = await requireOwner();
  const tenantId = String(form.get("tenant_id"));
  if (!UUID.test(tenantId)) return;
  const { data: m } = await db.from("memberships").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!m) await db.from("memberships").insert({ tenant_id: tenantId, user_id: userId, role: "admin" });
  (await cookies()).set(TENANT_COOKIE, tenantId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 24 * 3600 });
  await audit(db, userId, tenantId, "admin.work_in", tenantId);
  redirect("/setup");
}

/** Back to your own company. */
export async function workInOwnCompany() {
  (await cookies()).delete(TENANT_COOKIE);
  redirect("/admin");
}

/** Email someone a link to choose a new password. */
export async function sendPasswordReset(input: { tenantId: string; userId: string }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.userId)) return { ok: false, message: "Unknown person." };
    const { data } = await db.auth.admin.getUserById(input.userId);
    const email = data.user?.email;
    if (!email) return { ok: false, message: "They have no email address." };
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/session` });
    if (error) return { ok: false, message: error.message };
    await audit(db, userId, UUID.test(input.tenantId) ? input.tenantId : null, "admin.person.reset_email", input.userId);
    return { ok: true, message: `Reset link emailed to ${email}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't send it." };
  }
}

/** Set someone's password yourself (e.g. they're locked out on site). Signs them out everywhere else. */
export async function setPassword(input: { tenantId: string; userId: string; password: string }): Promise<Result> {
  try {
    const { db, userId } = await requireOwner();
    if (!UUID.test(input.userId)) return { ok: false, message: "Unknown person." };
    if (input.password.length < 8) return { ok: false, message: "Use at least 8 characters." };
    const { error } = await db.auth.admin.updateUserById(input.userId, { password: input.password });
    if (error) return { ok: false, message: error.message };
    if (input.userId !== userId) await endAllDevices(db, input.userId, "Password changed by quoteout");
    await audit(db, userId, UUID.test(input.tenantId) ? input.tenantId : null, "admin.person.set_password", input.userId);
    revalidatePath(`/admin/companies/${input.tenantId}`);
    return { ok: true, message: "Password set. Tell them the new one." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't set it." };
  }
}
