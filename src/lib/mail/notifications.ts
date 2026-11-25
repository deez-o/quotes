/**
 * Turns Microsoft Graph notifications into queued jobs. Kept free of Next.js
 * and Supabase so it can be tested with fakes. The webhook route wires it up.
 */
import { timingSafeEqual } from "node:crypto";
import type { GraphNotification } from "./graph";

export type Watch = { tenant_id: string; connection_id: string };

export type QueueInsert = {
  tenant_id: string;
  kind: "process_message" | "renew_watch" | "catch_up";
  payload: Record<string, unknown>;
  dedupe_key: string | null;
};

export type NotificationDeps = {
  /** Expected clientState (a secret set when the subscription was created). */
  clientState: string;
  findWatch: (subscriptionId: string) => Promise<Watch | null>;
  enqueue: (jobs: QueueInsert[]) => Promise<void>;
};

export type HandleResult = { queued: number; ignored: number; rejected: number };

function sameSecret(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function handleGraphNotifications(body: unknown, deps: NotificationDeps): Promise<HandleResult> {
  const value = (body as { value?: GraphNotification[] } | null)?.value;
  if (!Array.isArray(value)) return { queued: 0, ignored: 0, rejected: 0 };

  const jobs: QueueInsert[] = [];
  let ignored = 0;
  let rejected = 0;

  for (const n of value) {
    // Lifecycle notifications carry clientState too; anything without the right secret is dropped.
    if (!sameSecret(n.clientState, deps.clientState)) {
      rejected++;
      continue;
    }
    const watch = await deps.findWatch(n.subscriptionId);
    if (!watch) {
      ignored++;
      continue;
    }

    if (n.lifecycleEvent === "reauthorizationRequired" || n.lifecycleEvent === "subscriptionRemoved") {
      jobs.push({
        tenant_id: watch.tenant_id, kind: "renew_watch",
        payload: { connection_id: watch.connection_id, subscription_id: n.subscriptionId, event: n.lifecycleEvent },
        dedupe_key: null,
      });
      continue;
    }
    if (n.lifecycleEvent === "missed") {
      jobs.push({
        tenant_id: watch.tenant_id, kind: "catch_up",
        payload: { connection_id: watch.connection_id }, dedupe_key: null,
      });
      continue;
    }

    const messageId = n.resourceData?.id;
    if (n.changeType !== "created" || !messageId) {
      ignored++;
      continue;
    }
    jobs.push({
      tenant_id: watch.tenant_id,
      kind: "process_message",
      payload: { connection_id: watch.connection_id, message_id: messageId },
      // A notification for the same message twice does nothing.
      dedupe_key: `${watch.connection_id}:${messageId}`,
    });
  }

  if (jobs.length) await deps.enqueue(jobs);
  return { queued: jobs.length, ignored, rejected };
}
