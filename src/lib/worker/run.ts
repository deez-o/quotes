/**
 * Worker loop: claim one queued job at a time, run it, mark it done, or
 * retry with back-off and finally park it as "dead" for the admin page.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type QueueJob = {
  id: number;
  tenant_id: string;
  kind: "mail_notification" | "process_message" | "renew_watch" | "catch_up" | "draft_quote";
  payload: Record<string, unknown>;
  attempts: number;
};

export type Handler = (job: QueueJob) => Promise<void>;
export type Handlers = Partial<Record<QueueJob["kind"], Handler>>;

export const MAX_ATTEMPTS = 5;

/** 1 min, 4 min, 9 min, 16 min... capped at an hour. */
export function backoffSeconds(attempts: number): number {
  return Math.min(3600, 60 * attempts * attempts);
}

export type QueuePort = {
  claim(): Promise<QueueJob | null>;
  done(id: number): Promise<void>;
  retry(id: number, error: string, runAfter: Date): Promise<void>;
  dead(id: number, error: string): Promise<void>;
};

export function supabaseQueue(db: SupabaseClient): QueuePort {
  return {
    async claim() {
      const { data, error } = await db.rpc("claim_next_job");
      if (error) throw new Error(`Claim job: ${error.message}`);
      const rows = (data ?? []) as QueueJob[];
      return rows[0] ?? null;
    },
    async done(id) {
      await db.from("queue_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", id);
    },
    async retry(id, error, runAfter) {
      await db.from("queue_jobs").update({
        status: "queued", last_error: error.slice(0, 1000), run_after: runAfter.toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", id);
    },
    async dead(id, error) {
      await db.from("queue_jobs").update({ status: "dead", last_error: error.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", id);
    },
  };
}

/** Run up to `max` jobs, then return (fits a cron tick or a long-running loop). */
export async function runWorkerOnce(queue: QueuePort, handlers: Handlers, max = 10, now = () => new Date()) {
  const summary = { ran: 0, failed: 0, dead: 0 };
  for (let i = 0; i < max; i++) {
    const job = await queue.claim();
    if (!job) break;
    const handler = handlers[job.kind];
    try {
      if (!handler) throw new Error(`No handler for ${job.kind} yet.`);
      await handler(job);
      await queue.done(job.id);
      summary.ran++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (job.attempts >= MAX_ATTEMPTS) {
        await queue.dead(job.id, msg);
        summary.dead++;
      } else {
        await queue.retry(job.id, msg, new Date(now().getTime() + backoffSeconds(job.attempts) * 1000));
        summary.failed++;
      }
    }
  }
  return summary;
}
