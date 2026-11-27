/**
 * Cloudflare Email Worker: receives mail for *@in.<your-domain> (Email Routing,
 * catch-all -> this worker) and posts the raw email to QUOTES.
 *
 * Worker settings (Settings > Variables, as secrets):
 *   QUOTES_INBOUND_URL = https://<your-site>/api/inbound/email
 *   INBOUND_SECRET     = the same value as INBOUND_SECRET in Vercel
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const url = `${env.QUOTES_INBOUND_URL}?to=${encodeURIComponent(message.to)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "message/rfc822", Authorization: `Bearer ${env.INBOUND_SECRET}` },
      body: raw,
    });
    // 5xx: reject so the sender's mail server retries later. 4xx/200: accepted or deliberately dropped.
    if (res.status >= 500) message.setReject(`QUOTES temporarily unavailable (${res.status})`);
  },
};
