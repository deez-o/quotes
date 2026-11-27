"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/owner";
import { keyFor } from "@/lib/ai/call";
import { modelInfo } from "@/lib/ai/models";
import { runTrials } from "@/lib/rfq/trial";

type Result = { ok: true; message?: string } | { ok: false; message: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Switch the model every company's quotes use. */
export async function setLiveModel(_: unknown, form: FormData): Promise<Result> {
  const { db, userId } = await requireOwner();
  const model = String(form.get("model") ?? "");
  const info = modelInfo(model);
  if (!info) return { ok: false, message: "Pick a model." };
  if (!keyFor(model)) return { ok: false, message: `${info.label} needs ${info.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "XAI_API_KEY"} in Vercel first.` };
  const { error } = await db.from("platform_settings").upsert({ key: "ai_model", value: model, updated_at: new Date().toISOString(), updated_by: userId });
  if (error) return { ok: false, message: error.message };
  await db.from("audit_log").insert({ tenant_id: null, actor: userId, action: "admin.ai_model", target: model });
  revalidatePath("/admin/ai");
  return { ok: true, message: `Every new quote now uses ${info.label}.` };
}

/** Run one RFQ through the chosen models and keep the results to compare. */
export async function runTrial(_: unknown, form: FormData): Promise<Result> {
  const { db, userId } = await requireOwner();
  const pick = String(form.get("job") ?? "");
  const [tenantId, jobId] = pick.split(":");
  if (!UUID.test(tenantId ?? "") || !UUID.test(jobId ?? "")) return { ok: false, message: "Pick an RFQ." };
  const models = form.getAll("models").map(String).filter((m) => modelInfo(m));
  if (!models.length) return { ok: false, message: "Tick at least one model." };
  const missing = models.filter((m) => !keyFor(m));
  if (missing.length) return { ok: false, message: `No API key yet for: ${missing.map((m) => modelInfo(m)!.label).join(", ")}.` };

  const batch = randomUUID();
  const results = await runTrials(db, tenantId, jobId, models);
  await db.from("ai_trials").insert(results.map((r) => ({
    batch_id: batch, tenant_id: tenantId, job_id: jobId, model: r.model, scope: r.scope, total_ex_gst: r.total,
    questions: r.questions, cost_usd: r.costUsd, latency_ms: r.latencyMs, error: r.error, created_by: userId,
  })));
  redirect(`/admin/ai?batch=${batch}`);
}

/** Testing: other models that also draft every incoming RFQ, shown side by side on the quote page. */
export async function setCompareModels(_: unknown, form: FormData): Promise<Result> {
  const { db, userId } = await requireOwner();
  const models = form.getAll("compare").map(String).filter((m) => modelInfo(m)).slice(0, 3);
  const missing = models.filter((m) => !keyFor(m));
  if (missing.length) return { ok: false, message: `No API key yet for: ${missing.map((m) => modelInfo(m)!.label).join(", ")}.` };
  const { error } = await db.from("platform_settings").upsert({ key: "compare_models", value: models, updated_at: new Date().toISOString(), updated_by: userId });
  if (error) return { ok: false, message: error.message };
  await db.from("audit_log").insert({ tenant_id: null, actor: userId, action: "admin.compare_models", target: models.join(",") || "off" });
  revalidatePath("/admin/ai");
  return { ok: true, message: models.length ? `Every new RFQ will also be drafted with ${models.map((m) => modelInfo(m)!.label).join(" and ")}.` : "Comparing is off." };
}
