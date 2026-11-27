# QUOTES

A web app for asphalt and civil contractors. It reads RFQ emails, files the job, drafts the quote in the contractor's own products and workbook, and leaves a draft for a person to check and send. Quoting is the first module; inbox sorting and others plug into the same portal.

**Status (26 Nov 2026):** M0 done and live. M1 (mail intake) and the M3 quote-engine core are built and tested, waiting on the Microsoft app registration and server settings below.

| Area | State |
| --- | --- |
| Sign-in, tenants, RLS, demo data, Setup / Queue / Teach / Settings screens | Live |
| Starter pack (40 rules) and per-customer settings | Live |
| Job queue, Graph webhook, worker (every minute), inbox sorting, job linking, filing | Built, needs settings below |
| Connect Microsoft 365 (OAuth, encrypted tokens, subscriptions + renewal) | Built, needs settings below |
| New quote: drag in a saved email/files or paste text | Built, needs `SUPABASE_SERVICE_ROLE_KEY` + `CRON_SECRET` |
| Forwarding address per customer | Built, needs a domain + inbound email service |
| Quote engine: schema v1.0, checks, maths, prompt, xAI provider, retry | Built and tested; plugs into the worker at M3 |
| Text extraction, workbook fill, overview PDF, drawing measure-up | Not started (M2/M3/M5) |

## Stack

- Next.js 16 (App Router, TypeScript) on Vercel. Note: `src/proxy.ts` is what older Next.js called middleware.
- Supabase: Postgres with Row Level Security, sign-in, file storage. Use the Sydney region.
- Later milestones add a worker service, Microsoft Graph, the xAI Grok API and Stripe.

## First-time setup (about 20 minutes)

1. **Supabase project.** Create a project in the Sydney region. In the SQL editor, run the files in `supabase/migrations/` in order, then `supabase/seed.sql`.
2. **Sign-in settings.** Supabase > Authentication > URL Configuration: set Site URL to `http://localhost:3000` (add your Vercel URL later) and add `http://localhost:3000/auth/callback` to Redirect URLs. Email sign-in links work straight away. Microsoft sign-in needs the Azure provider set up (milestone M1).
3. **Local settings.** Copy `.env.example` to `.env.local` and fill in the Supabase URL and keys (Project Settings > API).
4. **Run it.**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 and sign in with your email link.
5. **Give yourself access.** After your first sign-in, run the two `insert` lines at the bottom of `supabase/seed.sql` in the SQL editor with your email. Refresh: you're now admin of Demo Asphalt Co.

## Connecting Microsoft (milestone M1)

1. **Register the app** at entra.microsoft.com > App registrations > New registration:
   - Name: QUOTES. Supported account types: *any organisational directory and personal Microsoft accounts*.
   - Redirect URI (Web): `https://<your-site>/api/connect/microsoft/callback`
   - API permissions > Microsoft Graph > Delegated: `offline_access`, `User.Read`, `Mail.ReadWrite`. Nothing else.
   - Certificates & secrets > New client secret. Copy the value (shown once).
2. **Vercel > Settings > Environment Variables** (Production), then redeploy:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-site>` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API Keys > secret key |
   | `MS_CLIENT_ID` | Application (client) ID from step 1 |
   | `MS_CLIENT_SECRET` | Client secret value from step 1 |
   | `TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
   | `GRAPH_CLIENT_STATE` | Any long random string: `openssl rand -hex 24` |
   | `CRON_SECRET` | Any long random string: `openssl rand -hex 24` |

3. In the app: Setup > **Connect Microsoft 365**, sign in with the test mailbox, approve. Send a test RFQ to that mailbox: within about a minute it is labelled *QUOTES/1. To Be Quoted* and appears as a job.

## Forwarding address and drag-in (no inbox connection)

Customers who don't want to connect their inbox can use **New quote**: drag in the saved email (.msg/.eml) and files, or paste the email text. That works as soon as `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are set in Vercel.

To also give each customer a forwarding address (e.g. `demo-asphalt@in.<your-domain>`):

1. Put the domain on Cloudflare, turn on **Email Routing** for the `in.` subdomain, and set the catch-all to an **Email Worker** using `infra/cloudflare-email-worker.js` (its two settings are in the file).
2. In Vercel add `INBOUND_DOMAIN` (e.g. `in.yourdomain.com.au`) and `INBOUND_SECRET` (`openssl rand -hex 24`, same value as in the worker), then redeploy.
3. Only people on the customer's team (admins and estimators) can forward in; anything else is dropped. Each customer's address is in the `inbound_addresses` table (Demo Asphalt Co: `demo-asphalt`).

Any inbound email service that can POST the raw message works the same way (SendGrid Inbound Parse with "raw", Mailgun, Postmark).

## Maps: plant search and road distance

Plants are found by name ("Downer Brendale") and the road distance from each plant to the job is worked
out when a site quote is made or the site is found on the map. Drive times are scaled by 1.15 for loaded trucks.

- With `GOOGLE_MAPS_API_KEY` set (server only): Google Places API (New) "Text Search" and the Routes API.
  In Google Cloud, enable both APIs, create an API key, restrict it to those two APIs, and set a billing budget alert.
- Without it: OpenStreetMap (Nominatim search, OSRM routing). Fine for a pilot; business names are hit and miss.
- If routing fails, the straight-line estimate (× road factor) is used, and the user can always type their own km and minutes.

## Plant price lists

Each plant has its own mix prices (Costs screen). Upload the plant's price list as a PDF, photo or phone
screenshot: the AI copies the printed prices into a table, the admin ticks and corrects the rows, then imports.
Nothing is saved before that. Scanned PDFs with no text need a photo or screenshot instead. Prices can always
be typed in by hand.

## Tests

The tenant isolation test proves one customer can never see or change another's data. It needs a **separate test Supabase project** with the same migration applied:

```bash
# .env.test.local (not committed)
TEST_SUPABASE_URL=...
TEST_SUPABASE_ANON_KEY=...
TEST_SUPABASE_SERVICE_ROLE_KEY=...

npm test
```

In GitHub, add the same three values under Settings > Secrets and variables > Actions so CI runs it on every change. Without them the test is skipped and CI says so.

## Deploying to Vercel

Import the repo in Vercel, add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SITE_URL` as environment variables, and add the Vercel URL + `/auth/callback` to Supabase's Redirect URLs.

## Rules for this codebase

- Every table with customer data has `tenant_id` and RLS. New tables get added to the isolation test.
- The worker (service role) bypasses RLS: every worker query must filter by `tenant_id`.
- Tokens live only in `connection_secrets`, which signed-in users can never read.
- Never commit secrets. `.env*.local` is git-ignored.
- Demo data is made up. No real customer's rates, quotes or emails go in this repo.
