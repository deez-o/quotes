export const metadata = { title: "Terms · quoteout" };

/** Plain-language terms of use. Draft: have it checked before launch. */
export default function Terms() {
  return (
    <main className="w-doc">
      <h1>Terms of use</h1>
      <p style={{ color: "var(--muted)" }}>Last updated 28 November 2026</p>

      <h2>The service</h2>
      <p>quoteout reads requests for quote and what you tell it, and drafts priced quotes from the costs and rules your company sets up. You are responsible for checking every quote before you send it. quoteout never sends a quote to a customer for you.</p>

      <h2>Your account</h2>
      <p>Each login is for one person. Don&apos;t share logins: add your team instead, which is free on every plan. We may sign out or switch off a login that is being shared or misused.</p>

      <h2>Plans and payment</h2>
      <p>Plans are billed monthly in advance, in Australian dollars, plus GST. You can change plan or cancel at any time; changes take effect straight away and the difference is charged or credited. If a payment fails, you have 7 days to update your card before your account goes on hold. Free trials last 14 days or 15 AI quotes, whichever comes first.</p>

      <h2>Your data</h2>
      <p>Your company owns its rates, rules, RFQs and quotes. You give us permission to store and process them to run quoteout for you. See the privacy page for details.</p>

      <h2>Fair use</h2>
      <p>Each plan includes a number of AI quotes a month. Don&apos;t use quoteout to break the law, to send spam, or to try to get into another company&apos;s data.</p>

      <h2>Our responsibility</h2>
      <p>We work hard to keep quoteout accurate and available, but quotes are drafts made by software and AI, and can be wrong. To the extent the law allows, we are not responsible for losses from a quote you send without checking. Nothing here limits your rights under the Australian Consumer Law.</p>

      <h2>Changes</h2>
      <p>We may update these terms. If a change matters, we&apos;ll tell you before it takes effect.</p>

      <p>Questions: hello@quoteout.app</p>
    </main>
  );
}
