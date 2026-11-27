import "server-only";

/** Sends email through Resend (https://resend.com). Set RESEND_API_KEY and MAIL_FROM (e.g. quotes@send.quoteout.app). */
export type OutgoingEmail = {
  fromName: string; replyTo: string | null; to: string[]; cc: string[]; subject: string; text: string; html: string;
  attachments: { filename: string; content: Uint8Array }[];
};

export function canSendEmail() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendEmail(m: OutgoingEmail): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { ok: false, message: "Sending email isn't set up yet." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${m.fromName} <${from}>`, to: m.to, cc: m.cc.length ? m.cc : undefined, reply_to: m.replyTo ?? undefined,
        subject: m.subject, text: m.text, html: m.html,
        attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!r.ok || !body.id) return { ok: false, message: body.message ? `The email service said: ${body.message}` : `The email service didn't accept it (${r.status}).` };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, message: e instanceof Error && e.name === "TimeoutError" ? "The email service didn't answer. Try again." : "Couldn't reach the email service." };
  }
}
