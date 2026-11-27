import Link from "next/link";
import Image from "next/image";
import { PHOTOS } from "./photos";
import { PLANS, PLAN_FEATURES, MAILBOX_READY } from "@/lib/plans";

export const dynamic = "force-static";

const FAQ: [string, string][] = [
  ["Does quoteout send quotes to my customers?",
    "No. Every quote is a draft until you check it. You send it yourself as a PDF, or push it into Xero as a draft quote and send it from there."],
  ["Does the AI make up prices?",
    "No. The AI reads the RFQ and works out what the job is: areas, depths, mixes, what's asked for. Every dollar comes from your own costs, worked out by the app: your mix prices at each plant, truck rates and cycle times, crew hourly rates with overtime, plant hire and your margin."],
  ["What can it read?",
    "The email itself plus PDFs, Excel schedules of quantities, Word documents and photos. A scanned PDF with no text in it gets flagged so you can check it by eye."],
  ["What if the RFQ is missing something?",
    "It asks. Missing depth, hours on site, how many days: each one shows as a short question on the quote, with a box to answer it (or say it out loud), and the quote updates."],
  ["How does it know which plant to use?",
    "It works out the road distance from the job to each of your plants and picks the nearest one that makes the mix, then prices the trucks from the real drive time. You can switch plants and the mix prices and cartage change with it."],
  ["Can my whole team use it?",
    "Yes. Every plan includes unlimited users. Each person has their own login."],
  ["What happens after the free trial?",
    "Pick a plan to keep going. If you don't, your quotes and setup are kept, you just can't make new quotes until you do."],
  ["Who sets up my rates?",
    "We do, with you. Send us your price lists and rates and we'll load your plants, mixes, trucks, crews and quoting rules, so your first quote comes out right."],
];

export default function Home() {
  return (
    <main>
      <section className="w-hero">
        <div className="w-wrap w-hero-grid">
          <div>
            <h1>RFQs in. Priced quotes out.</h1>
            <p className="w-lede">
              Forward an RFQ to quoteout. It reads the email and the schedule, prices the job with your own rates, plants and trucks,
              and gives you a quote to check and send. Minutes, not an evening at the desk.
            </p>
            <div className="w-ctas">
              <Link href="/signup" className="w-btn hi">Start free trial</Link>
              <a href="#how" className="w-btn ghost-dark">See how it works</a>
            </div>
            <p className="w-small" style={{ marginTop: 14 }}>14 days free. No card needed.</p>
          </div>

          <div className="w-demo" aria-label="Example: an RFQ email and the quote quoteout makes from it">
            <div className="w-mail">
              <div className="w-from"><strong>Sam Patel</strong><span className="w-tag">Northgate Builders · 7:42 am</span></div>
              <div className="w-subj">RFQ: carpark resurfacing, 14 Kerr Rd Burpengary</div>
              <p>Hi, please quote to profile 40 mm and lay 40 mm AC10 over the main carpark, about 1,850 m². Tack coat to suit. Saturday works. Schedule attached.</p>
              <p>Quotes by Friday please. Cheers, Sam</p>
              <div className="w-files"><span className="w-file">Schedule of quantities.xlsx</span><span className="w-file">Carpark layout.pdf</span></div>
            </div>
            <div className="w-road" aria-hidden="true" />
            <div className="w-quote">
              <div className="w-quote-head">
                <h3>Northgate Builders, Kerr Rd carpark</h3>
                <span className="w-tag">Example quote · from Narangba plant, 21 km</span>
              </div>
              <table>
                <tbody>
                  <tr><td>Supply and lay AC10, 40 mm<small>178 t @ $205/t</small></td><td>$36,490</td></tr>
                  <tr><td>Profile existing surface, 40 mm<small>1,850 m² @ $4.20</small></td><td>$7,770</td></tr>
                  <tr><td>Tack coat<small>1,850 m² @ $0.95</small></td><td>$1,758</td></tr>
                  <tr><td>Establishment<small>Paver, roller and profiler float</small></td><td>$1,800</td></tr>
                  <tr className="w-total"><td>Total ex GST</td><td>$47,818</td></tr>
                </tbody>
              </table>
              <div className="w-margin">
                <span>Cost<b>$41,580</b></span>
                <span>Profit<b className="w-good">$6,238</b></span>
                <span>Profit a tonne<b className="w-good">$35/t</b></span>
              </div>
              <div className="w-ask">1 question: Saturday works. Use your weekend crew rate?</div>
            </div>
          </div>
        </div>
        <div className="w-photo">
          <Image src={PHOTOS.hero.src} width={PHOTOS.hero.width} height={PHOTOS.hero.height} alt={PHOTOS.hero.alt} sizes="100vw" priority />
        </div>
      </section>

      <section className="w-sec" id="how">
        <div className="w-wrap">
          <h2>How it works</h2>
          <p className="w-intro">The same steps you take now, without the spreadsheet.</p>
          <ol className="w-steps">
            <li>
              <h3>Forward the RFQ</h3>
              <p>Send it to your own quoteout address from your phone or desk. Or drop in the files, or paste the email.</p>
            </li>
            <li>
              <h3>quoteout prices it</h3>
              <p>It reads the email, specs and schedule, works out areas, tonnes, trucks, crew days and plant, and prices it all from your costs.</p>
            </li>
            <li>
              <h3>You check it and send it</h3>
              <p>See the cost, price and profit per tonne. Answer any questions, change the margin, then send a branded PDF or push it to Xero.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="w-sec grey">
        <div className="w-wrap w-split">
          <div>
            <h2>Priced the way you price</h2>
            <p className="w-intro">quoteout works from your numbers and your rules, not someone else&apos;s.</p>
            <ul className="w-list">
              <li><strong>Mix prices at each plant.</strong> Upload a plant&apos;s price list, even a photo of it, and the prices load themselves.</li>
              <li><strong>Real cartage.</strong> Road distance and drive time from the job to the nearest plant that makes the mix, with your load and tip times.</li>
              <li><strong>Crews by the hour.</strong> Normal hours, then time and a half, then double time, the way you pay them.</li>
              <li><strong>Your quoting rules.</strong> Teach it how you quote (minimums, wastage, what you always include) and every quote follows them.</li>
              <li><strong>Costs your customer never sees.</strong> Float moves and hidden costs come off your profit, not their quote.</li>
            </ul>
          </div>
          <Image src={PHOTOS.roller.src} width={PHOTOS.roller.width} height={PHOTOS.roller.height} alt={PHOTOS.roller.alt} sizes="(min-width: 900px) 50vw, 100vw" />
        </div>
      </section>

      <section className="w-sec">
        <div className="w-wrap w-split flip">
          <div>
            <h2>Quote from the ute</h2>
            <p className="w-intro">On site with no RFQ? Talk through the job and take a few photos.</p>
            <ul className="w-list">
              <li><strong>Say it how you&apos;d say it.</strong> &quot;Carpark, about two thousand square, 40 mil AC10, one day, bobcat half a day.&quot;</li>
              <li><strong>It knows where you are.</strong> Or say the address if you&apos;re quoting from home.</li>
              <li><strong>Priced before you leave.</strong> Check it on your phone and send it, or finish it at the desk.</li>
            </ul>
          </div>
          <Image src={PHOTOS.ute.src} width={PHOTOS.ute.width} height={PHOTOS.ute.height} alt={PHOTOS.ute.alt} sizes="(min-width: 900px) 50vw, 100vw" style={{ maxHeight: 640, objectFit: "cover" }} />
        </div>
      </section>

      <section className="w-sec grey" id="pricing">
        <div className="w-wrap">
          <h2>Pricing</h2>
          <p className="w-intro">One price for your whole company. Unlimited users on every plan, and we set up your rates for you.</p>
          <div className="w-plans">
            {(["site", "pro", "business"] as const).map((id) => (
              <div key={id} className={`w-plan${id === "pro" ? " pick" : ""}`}>
                <h3>{PLANS[id].name}</h3>
                <div className="w-price">${PLANS[id].priceMonthly}<span> a month + GST</span></div>
                <ul>{PLAN_FEATURES[id].map((f) => <li key={f}>{f}</li>)}</ul>
                <Link href={`/signup?plan=${id}`} className={`w-btn ${id === "pro" ? "hi" : "ghost"}`}>Choose {PLANS[id].name}</Link>
              </div>
            ))}
          </div>
          <p className="w-note">
            Or start with a 14-day free trial of everything{MAILBOX_READY ? ", including the connected inbox" : ""}, with 15 AI quotes and no card. <Link href="/signup" style={{ textDecoration: "underline", fontWeight: 600 }}>Start free trial</Link>.
            Launch prices: sign up now and keep them. Change plan or cancel any time.
          </p>
        </div>
      </section>

      <section className="w-sec" id="questions">
        <div className="w-wrap">
          <h2>Questions</h2>
          <div className="w-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="w-end">
        <div className="w-wrap">
          <h2>Get your evenings back.</h2>
          <p>Forward your next RFQ to quoteout and see the quote it makes. Free for 14 days.</p>
          <Link href="/signup" className="w-btn hi">Start free trial</Link>
        </div>
      </section>
    </main>
  );
}
