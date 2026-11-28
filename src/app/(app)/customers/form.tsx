"use client";

import { useActionState } from "react";
import { saveCustomer, type CustomerState } from "./actions";

export type CustomerRow = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; address: string | null; abn: string | null; notes: string | null };

export function CustomerForm({ c, canEdit }: { c: CustomerRow | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState<CustomerState, FormData>(saveCustomer, null);
  const f: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600 };
  return (
    <form action={action} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8, alignItems: "end" }}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <label style={f}>Company or name<input name="name" defaultValue={c?.name ?? ""} required disabled={!canEdit} /></label>
      <label style={f}>Contact<input name="contact_name" defaultValue={c?.contact_name ?? ""} disabled={!canEdit} /></label>
      <label style={f}>Email<input name="email" type="email" defaultValue={c?.email ?? ""} disabled={!canEdit} /></label>
      <label style={f}>Phone<input name="phone" type="tel" defaultValue={c?.phone ?? ""} disabled={!canEdit} /></label>
      <label style={f}>Address<input name="address" defaultValue={c?.address ?? ""} disabled={!canEdit} /></label>
      <label style={f}>ABN<input name="abn" defaultValue={c?.abn ?? ""} disabled={!canEdit} /></label>
      <label style={{ ...f, gridColumn: "1 / -1" }}>Notes<textarea name="notes" rows={2} defaultValue={c?.notes ?? ""} disabled={!canEdit} /></label>
      {canEdit && <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Saving..." : c ? "Save" : "Add customer"}</button>
        {state && <span className={state.ok ? "sub" : "error"} style={{ marginTop: 0 }} role="status">{state.message}</span>}
      </div>}
    </form>
  );
}
