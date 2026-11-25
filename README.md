# QUOTES

A web app for asphalt and civil contractors. It reads RFQ emails, files the job, drafts the quote in the contractor's own products and workbook, and leaves a draft for a person to check and send. Quoting is the first module; inbox sorting and others plug into the same portal.

**Status:** milestone M0 (foundations). Sign-in, customer accounts kept apart, the database, Demo Asphalt Co test data, and the Setup, Queue and Teach screens reading live data.

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
