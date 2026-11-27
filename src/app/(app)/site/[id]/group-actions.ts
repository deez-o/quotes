"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type R = { ok: true; id: string } | { ok: false; message: string };

/** Everything that's copied when a quote becomes an option or a revision. */
const COPY = "id, tenant_id, quote_no, title, customer_name, customer_email, customer_id, site_address, site_lat, site_lng, haul_routes, transcript, photos, scope, costing, margin_percent, total_ex_gst, overview, rfq_summary, inclusions, exclusions, show_map, option_group, option_label, revision, superseded_at, job_id, status";
type Row = Record<string, unknown> & { id: string; option_group: string | null; option_label: string | null; revision: number; superseded_at: string | null; job_id: string | null; status: string };

async function writer() {
  const ctx = await requireTenant();
  if (ctx.role === "viewer") throw new Error("Viewers can't change quotes.");
  return { ctx, db: await createClient() };
}

function copyOf(r: Row, userId: string): Record<string, unknown> {
  const { id: _id, job_id: _job, status: _status, superseded_at: _s, ...rest } = r;
  void _id; void _job; void _status; void _s;
  return { ...rest, status: "draft", created_by: userId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

/** Price the same job another way: a copy of this quote as Option B (C...). */
export async function addOption(input: { id: string }): Promise<R> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const { data } = await db.from("site_quotes").select(COPY).eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!data) return { ok: false, message: "Quote not found." };
    const q = data as unknown as Row;
    if (q.superseded_at) return { ok: false, message: "This is an older revision. Open the latest one to add options." };
    const group = q.option_group ?? q.id;
    if (!q.option_group) {
      const { error } = await db.from("site_quotes").update({ option_group: group, option_label: "A" }).eq("tenant_id", ctx.tenant.id).eq("id", q.id);
      if (error) return { ok: false, message: error.message };
    }
    const { data: all } = await db.from("site_quotes").select("option_label").eq("tenant_id", ctx.tenant.id).eq("option_group", group).eq("revision", q.revision);
    const used = new Set((all ?? []).map((a) => a.option_label as string));
    used.add("A");
    const next = "ABCDEFGH".split("").find((l) => !used.has(l));
    if (!next) return { ok: false, message: "That's as many options as one quote can have." };
    const { data: made, error } = await db.from("site_quotes").insert({ ...copyOf(q, ctx.userId), option_group: group, option_label: next }).select("id").single();
    if (error) return { ok: false, message: error.message };
    revalidatePath(`/site/${q.id}`);
    revalidatePath("/quotes");
    return { ok: true, id: made.id as string };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't add the option." };
  }
}

/** Take an option off the quote (not Option A, and not once it's been sent). */
export async function removeOption(input: { id: string }): Promise<R> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const { data } = await db.from("site_quotes").select("id, option_group, option_label, revision, status, sent_at").eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!data?.option_group) return { ok: false, message: "This quote has no options." };
    if (data.id === data.option_group) return { ok: false, message: "Option A can't be removed. Remove the other options instead." };
    if (data.sent_at) return { ok: false, message: "This option has been sent to the customer. Make a revision to change the options." };
    const { error } = await db.from("site_quotes").delete().eq("tenant_id", ctx.tenant.id).eq("id", input.id);
    if (error) return { ok: false, message: error.message };
    const { data: left } = await db.from("site_quotes").select("id").eq("tenant_id", ctx.tenant.id).eq("option_group", data.option_group).eq("revision", data.revision);
    if ((left ?? []).length === 1) await db.from("site_quotes").update({ option_group: null, option_label: null }).eq("tenant_id", ctx.tenant.id).eq("id", left![0].id);
    revalidatePath("/quotes");
    return { ok: true, id: data.option_group as string };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't remove the option." };
  }
}

/** The customer wants changes: copy the quote (and its options) as the next revision, keeping the old one as it was sent. */
export async function makeRevision(input: { id: string }): Promise<R> {
  try {
    const { ctx, db } = await writer();
    if (!UUID.test(input.id)) return { ok: false, message: "Quote not found." };
    const { data } = await db.from("site_quotes").select(COPY).eq("tenant_id", ctx.tenant.id).eq("id", input.id).maybeSingle();
    if (!data) return { ok: false, message: "Quote not found." };
    const q = data as unknown as Row;
    if (q.superseded_at) return { ok: false, message: "There's already a newer revision of this quote." };
    if (q.revision >= 25) return { ok: false, message: "That's as many revisions as one quote can have." };
    let group: Row[] = [q];
    if (q.option_group) {
      const { data: all } = await db.from("site_quotes").select(COPY).eq("tenant_id", ctx.tenant.id).eq("option_group", q.option_group).eq("revision", q.revision).order("option_label");
      group = (all ?? []) as unknown as Row[];
    }
    const now = new Date().toISOString();
    // The RFQ link moves to the new revision (one quote per RFQ).
    const jobId = group.find((g) => g.job_id)?.job_id ?? null;
    if (jobId) await db.from("site_quotes").update({ job_id: null }).eq("tenant_id", ctx.tenant.id).in("id", group.map((g) => g.id));
    let newGroup: string | null = null;
    let target = "";
    for (const g of group) {
      const row = { ...copyOf(g, ctx.userId), revision: q.revision + 1, option_group: null as string | null, job_id: g.option_label === "A" || !g.option_label ? jobId : null };
      if (g.option_group) row.option_group = newGroup;
      const { data: made, error } = await db.from("site_quotes").insert(row).select("id").single();
      if (error) {
        if (jobId) await db.from("site_quotes").update({ job_id: jobId }).eq("tenant_id", ctx.tenant.id).eq("id", group[0].id);
        return { ok: false, message: error.message };
      }
      if (g.option_group && !newGroup) {
        newGroup = made.id as string;
        await db.from("site_quotes").update({ option_group: newGroup }).eq("tenant_id", ctx.tenant.id).eq("id", newGroup);
      }
      if (g.id === q.id) target = made.id as string;
    }
    await db.from("site_quotes").update({ superseded_at: now }).eq("tenant_id", ctx.tenant.id).in("id", group.map((g) => g.id));
    revalidatePath("/quotes");
    return { ok: true, id: target };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't make the revision." };
  }
}
