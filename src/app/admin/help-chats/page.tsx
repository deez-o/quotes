import { requireOwner } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatMsg } from "@/app/(app)/help/chat-actions";

/** What people ask the help assistant: shows where the app is confusing, and anything the assistant got wrong. */
export default async function HelpChatsPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const { only } = await searchParams;
  await requireOwner();
  const admin = createAdminClient();
  let q = admin.from("help_chats").select("id, tenant_id, email, messages, escalated, page, updated_at").order("updated_at", { ascending: false }).limit(150);
  if (only === "sent") q = q.eq("escalated", true);
  const [{ data: chats }, { data: tenants }] = await Promise.all([q, admin.from("tenants").select("id, name")]);
  const names = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <div><h1>Help chats</h1><p className="sub">Conversations with the help assistant, newest first. Edit what it knows in src/lib/help/guide.ts.</p></div>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn" href="/admin/help-chats" aria-current={!only ? "page" : undefined}>All</a>
          <a className="btn" href="/admin/help-chats?only=sent" aria-current={only === "sent" ? "page" : undefined}>Sent to the team</a>
        </div>
      </div>
      {(chats ?? []).length === 0 ? <div className="card"><p className="sub" style={{ margin: 0 }}>No conversations yet.</p></div> : (chats ?? []).map((c) => {
        const msgs = (c.messages as ChatMsg[]) ?? [];
        const first = msgs.find((m) => m.role === "user")?.text ?? "";
        return (
          <details key={c.id} className="card">
            <summary style={{ cursor: "pointer", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <strong style={{ flex: 1, minWidth: 0 }}>{first.slice(0, 140)}</strong>
              <span className="sub" style={{ marginTop: 0 }}>{c.escalated ? "Sent to team · " : ""}{names.get(c.tenant_id) ?? "?"} · {c.email ?? "-"} · {msgs.length} messages · {new Date(c.updated_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" })}</span>
            </summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {c.page && <div className="sub">Opened from {c.page}</div>}
              {msgs.map((m, i) => (
                <div key={i} style={{ whiteSpace: "pre-wrap", padding: "8px 10px", borderRadius: 8, background: m.role === "user" ? "#eef2ff" : "#f3f4f6" }}>
                  <strong>{m.role === "user" ? "Them" : "Assistant"}{m.person ? " (suggested a person)" : ""}:</strong> {m.text}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
