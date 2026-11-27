import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { limitsFor } from "@/lib/plans";
import { devicesOverLimit, type DeviceRow, type Where } from "@/lib/devices";

export type CheckResult = { ok: true } | { ok: false; reason: "ended" | "suspended" | "paused" };

/**
 * Runs every few minutes for each signed-in browser (from the proxy):
 * records the device and where it is, signs it out if an admin ended it or the
 * person or company is suspended, and keeps each login within its device limit
 * (the device used longest ago is signed out).
 */
export async function checkDevice(input: {
  userId: string; sessionId: string | null; deviceId: string; label: string; where: Where;
}): Promise<CheckResult> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  const [{ data: membership }, { data: isAdmin }, { data: row }] = await Promise.all([
    db.from("memberships").select("tenant_id, disabled_at, tenants ( status, plan, ai_quota_month, max_devices )")
      .eq("user_id", input.userId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    db.from("platform_admins").select("user_id").eq("user_id", input.userId).maybeSingle(),
    db.from("user_devices").select("id, session_id, revoked_at, revoked_session")
      .eq("user_id", input.userId).eq("device_id", input.deviceId).maybeSingle(),
  ]);

  const owner = Boolean(isAdmin);
  const tenant = membership?.tenants as unknown as { status: string; plan: string | null; ai_quota_month: number | null; max_devices: number | null } | null;
  if (!owner && membership?.disabled_at) return { ok: false, reason: "suspended" };
  if (!owner && tenant?.status === "paused") return { ok: false, reason: "paused" };

  // Ended by an admin (or pushed off by the device limit) and still on that same sign-in.
  if (row?.revoked_at && input.sessionId && row.revoked_session === input.sessionId) return { ok: false, reason: "ended" };

  const freshSignIn = !row || row.session_id !== input.sessionId;
  const fields = {
    tenant_id: membership?.tenant_id ?? null,
    label: input.label,
    session_id: input.sessionId,
    ip: input.where.ip, city: input.where.city, region: input.where.region, country: input.where.country,
    last_seen: now,
    ...(freshSignIn ? { revoked_at: null, revoked_session: null, revoked_reason: null } : {}),
  };
  let keepId = row?.id as string | undefined;
  if (row) {
    await db.from("user_devices").update(fields).eq("id", row.id);
  } else {
    const { data: made } = await db.from("user_devices").insert({ user_id: input.userId, device_id: input.deviceId, ...fields }).select("id").single();
    keepId = made?.id;
  }

  // A new sign-in may push this login over its limit: sign out the device used longest ago.
  if (freshSignIn && !owner && tenant && keepId) {
    const { maxDevices } = limitsFor(tenant);
    if (maxDevices) {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data: active } = await db.from("user_devices")
        .select("id, user_id, device_id, label, session_id, city, region, country, last_seen, first_seen, revoked_at")
        .eq("user_id", input.userId).is("revoked_at", null).gte("last_seen", since);
      for (const d of devicesOverLimit((active ?? []) as DeviceRow[], maxDevices, keepId)) {
        await endDevice(db, d.id, input.userId, d.session_id, "Device limit: signed in somewhere else");
      }
    }
  }
  return { ok: true };
}

type Db = ReturnType<typeof createAdminClient>;

/** Sign one device out: it is stopped at its next check, and its sign-in can't be refreshed. */
export async function endDevice(db: Db, deviceRowId: string, userId: string, sessionId: string | null, reason: string) {
  await db.from("user_devices").update({ revoked_at: new Date().toISOString(), revoked_session: sessionId, revoked_reason: reason }).eq("id", deviceRowId);
  if (sessionId) await db.rpc("admin_end_sessions", { p_user: userId, p_session: sessionId });
}

/** Sign a person out on every device. */
export async function endAllDevices(db: Db, userId: string, reason: string) {
  const { data } = await db.from("user_devices").select("id, session_id").eq("user_id", userId).is("revoked_at", null);
  for (const d of data ?? []) {
    await db.from("user_devices").update({ revoked_at: new Date().toISOString(), revoked_session: d.session_id, revoked_reason: reason }).eq("id", d.id);
  }
  await db.rpc("admin_end_sessions", { p_user: userId, p_session: null });
}
