import { keyFor, liveModel } from "@/lib/ai/call";
import Link from "next/link";
import { requireTenant } from "@/lib/tenant";
import { createClient } from "@/lib/supabase/server";
import { TalkToQuote } from "./talk";

export default async function NewSiteQuotePage() {
  const ctx = await requireTenant();
  const supabase = await createClient();
  const { count } = await supabase.from("cost_items").select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id).eq("active", true);

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <div>
        <Link href="/start" className="sub" style={{ marginTop: 0, fontSize: 13 }}>← New Quote</Link>
        <h1 style={{ fontSize: 26 }}>Tell me about the job</h1>
      </div>
      {ctx.role === "viewer" ? (
        <p className="sub">Viewers can&apos;t create quotes.</p>
      ) : (
        <TalkToQuote tenantId={ctx.tenant.id} hasAi={Boolean(keyFor(await liveModel()))} hasCosts={(count ?? 0) > 0} />
      )}
    </div>
  );
}
