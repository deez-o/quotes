export const metadata = { title: "Privacy · quoteout" };

/** Plain-language privacy policy. Draft: have it checked before launch. */
export default function Privacy() {
  return (
    <main className="w-doc">
      <h1>Privacy</h1>
      <p style={{ color: "var(--muted)" }}>Last updated 28 November 2026</p>

      <p>quoteout helps asphalt contractors turn requests for quote into priced quotes. This page explains what we keep about you and your customers, why, and who else handles it.</p>

      <h2>What we keep</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email address and password (stored scrambled, never readable), and the company you belong to.</li>
        <li><strong>Your company&apos;s setup:</strong> rates, plants, trucks, crews, quoting rules, terms and branding you enter.</li>
        <li><strong>Quotes and RFQs:</strong> emails you forward or import, their attachments, what you say into the app, site photos, and the quotes made from them. These may include your customers&apos; names and contact details.</li>
        <li><strong>Sign-in records:</strong> the device and rough location (city) each login is used from, so we can keep accounts secure and stop logins being shared.</li>
        <li><strong>Billing:</strong> your plan and payment status. Card details are handled by Stripe; we never see or store your card number.</li>
      </ul>

      <h2>How we use it</h2>
      <p>Only to run quoteout for you: to read RFQs, price quotes from your costs, keep your account secure, bill you, and support you. We don&apos;t sell your data or use it for advertising. Your rates and quotes are never shown to another company.</p>

      <h2>Who else handles it</h2>
      <ul>
        <li><strong>Supabase</strong> stores your data and files, and <strong>Vercel</strong> runs the app.</li>
        <li><strong>xAI</strong> provides the AI that reads RFQs and what you say. It receives the text and pictures needed to read the job, not your billing details. We use it under terms that don&apos;t let it train on your data.</li>
        <li><strong>Google Maps</strong> or <strong>OpenStreetMap</strong> find job addresses and road distances.</li>
        <li><strong>Cloudflare</strong> receives emails forwarded to your quoteout address.</li>
        <li><strong>Stripe</strong> takes payments. <strong>Xero</strong> receives quotes only when you choose Send to Xero.</li>
      </ul>
      <p>Some of these services store data outside Australia.</p>

      <h2>How long we keep it</h2>
      <p>For as long as your company uses quoteout. If you leave, we delete your company&apos;s data within 90 days of being asked, apart from billing records we must keep by law.</p>

      <h2>Your choices</h2>
      <p>You can see and change your company&apos;s data in the app, delete quotes yourself, and ask us for a copy of your data or to delete it. Contact us at privacy@quoteout.app.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit and at rest. Each company&apos;s data is kept apart from every other company&apos;s. Connections to Xero and email are stored encrypted, and only the app itself can use them.</p>
    </main>
  );
}
