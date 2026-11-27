/**
 * Cloudflare Email Worker for quoteout: receives mail for *@in.<your-domain>
 * (Email Routing: catch-all on the in. subdomain -> this worker).
 * 1. asks quoteout where to put the email, 2. uploads the raw email straight to storage
 * (so big RFQ packs aren't limited by Vercel's request size), 3. tells quoteout it's there.
 *
 * Worker settings (Settings > Variables and Secrets):
 *   QUOTEOUT_URL   = https://quoteout.app           (plain text)
 *   INBOUND_SECRET = the same value as INBOUND_SECRET in Vercel (secret)
 */
const worker = {
  async email(message, env) {
    const auth = { Authorization: `Bearer ${env.INBOUND_SECRET}` };
    const start = await fetch(`${env.QUOTEOUT_URL}/api/inbound/start`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ to: message.to }),
    });
    if (start.status >= 500) return message.setReject(`quoteout temporarily unavailable (${start.status})`);
    const plan = await start.json().catch(() => ({}));
    if (!start.ok || plan.ignore || !plan.uploadUrl) return; // not a quoteout address: drop quietly

    const raw = await new Response(message.raw).arrayBuffer();
    const put = await fetch(plan.uploadUrl, { method: "PUT", headers: { "Content-Type": "message/rfc822" }, body: raw });
    if (!put.ok) return message.setReject(`quoteout storage unavailable (${put.status})`);

    const done = await fetch(`${env.QUOTEOUT_URL}/api/inbound/email`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: plan.path, id: plan.id, to: message.to }),
    });
    // 5xx: reject so the sender's mail server retries later. 4xx/200: accepted or deliberately dropped.
    if (done.status >= 500) message.setReject(`quoteout temporarily unavailable (${done.status})`);
  },
};

export default worker;
