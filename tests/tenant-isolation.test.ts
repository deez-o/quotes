/**
 * The most important test in the project: a user in tenant A can never read
 * or change tenant B's data.
 *
 * Runs against a real Supabase project (use a separate TEST project, never
 * production). Needs, in .env.test.local or CI secrets:
 *   TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, TEST_SUPABASE_SERVICE_ROLE_KEY
 * Without them the test is skipped, so the build still runs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

// Every tenant table a signed-in user can read.
const TENANT_TABLES = [
  "tenant_modules", "connections", "customers", "jobs", "messages", "attachments",
  "catalogue_products", "rates", "rules", "examples", "workbook_templates",
  "ai_runs", "quote_drafts", "corrections", "usage_events", "tenant_settings", "inbound_addresses", "cost_items", "supply_plants", "binder_extras", "site_quotes", "quote_sends", "support_requests", "help_chats",
] as const;

describe.skipIf(!configured)("tenant isolation", () => {
  let admin: SupabaseClient;
  let asA: SupabaseClient;
  const run = randomUUID().slice(0, 8);
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userIds: string[] = [];
  const password = `Test-${randomUUID()}`;

  async function makeUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);
    return data.user.id;
  }

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });

    const { error: tErr } = await admin.from("tenants").insert([
      { id: tenantA, slug: `iso-a-${run}`, name: `Isolation A ${run}` },
      { id: tenantB, slug: `iso-b-${run}`, name: `Isolation B ${run}` },
    ]);
    if (tErr) throw tErr;

    const emailA = `iso-a-${run}@example.com`;
    const userA = await makeUser(emailA);
    const userB = await makeUser(`iso-b-${run}@example.com`);
    await admin.from("memberships").insert([
      { tenant_id: tenantA, user_id: userA, role: "admin" },
      { tenant_id: tenantB, user_id: userB, role: "admin" },
    ]);

    // Give tenant B one row in every table so there is something to leak.
    const { data: jobB } = await admin.from("jobs")
      .insert({ tenant_id: tenantB, quote_no: "Q-9999", customer_name: "Secret Co" })
      .select("id").single();
    const { data: runB } = await admin.from("ai_runs")
      .insert({ tenant_id: tenantB, module: "quoting", provider: "test", model: "test", prompt_version: "t" })
      .select("id").single();
    const { data: connB } = await admin.from("connections")
      .insert({ tenant_id: tenantB, provider: "microsoft", purpose: "mailbox", account_email: "b@example.com" })
      .select("id").single();
    const { data: msgB } = await admin.from("messages")
      .insert({ tenant_id: tenantB, connection_id: connB!.id, provider_message_id: `m-${run}`, subject: "Secret RFQ" })
      .select("id").single();

    const seeds: Record<string, object> = {
      tenant_modules: { tenant_id: tenantB, module: "quoting", enabled: true },
      customers: { tenant_id: tenantB, name: "Secret Co" },
      attachments: { tenant_id: tenantB, job_id: jobB!.id, message_id: msgB!.id, filename: "boq.pdf", storage_path: `${tenantB}/boq.pdf` },
      catalogue_products: { tenant_id: tenantB, code: "SECRET", name: "Secret mix", operation: "asphalt" },
      rates: { tenant_id: tenantB, kind: "crew", key: "secret", value: 1, unit: "AUD/shift" },
      rules: { tenant_id: tenantB, code: "R1", text: "Secret rule" },
      examples: { tenant_id: tenantB, title: "Secret example" },
      workbook_templates: { tenant_id: tenantB, filename: "secret.xlsm", storage_path: `${tenantB}/secret.xlsm` },
      quote_drafts: { tenant_id: tenantB, job_id: jobB!.id, ai_run_id: runB!.id, answer: {} },
      corrections: { tenant_id: tenantB, job_id: jobB!.id, field: "area" },
      usage_events: { tenant_id: tenantB, module: "quoting", kind: "rfq_drafted" },
      tenant_settings: { tenant_id: tenantB, margin_mode: "per_shift", margin_per_shift: 9999 },
      inbound_addresses: { tenant_id: tenantB, local_part: `iso-b-${run}` },
      cost_items: { tenant_id: tenantB, category: "crew", name: "Secret crew", unit: "shift", rate: 12345 },
      supply_plants: { tenant_id: tenantB, name: "Secret plant" },
      site_quotes: { tenant_id: tenantB, title: "Secret site quote", total_ex_gst: 99999 },
    };
    for (const [table, row] of Object.entries(seeds)) {
      const { error } = await admin.from(table).insert(row);
      if (error) throw new Error(`seeding ${table}: ${error.message}`);
    }
    const { data: plantB } = await admin.from("supply_plants").select("id").eq("tenant_id", tenantB).limit(1).single();
    await admin.from("binder_extras").insert({ tenant_id: tenantB, supply_plant_id: plantB!.id, binder: "C600", extra_per_t: 9 });
    await admin.from("connection_secrets").insert({ connection_id: connB!.id, tenant_id: tenantB, token_ciphertext: "secret" });

    asA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error: signInErr } = await asA.auth.signInWithPassword({ email: emailA, password });
    if (signInErr) throw signInErr;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("tenants").delete().in("id", [tenantA, tenantB]);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  it("can see its own tenant but not the other", async () => {
    const { data } = await asA.from("tenants").select("id");
    const ids = (data ?? []).map((t) => t.id);
    expect(ids).toContain(tenantA);
    expect(ids).not.toContain(tenantB);
  });

  it.each(TENANT_TABLES)("reads no rows of the other tenant from %s", async (table) => {
    const { data, error } = await asA.from(table).select("*").eq("tenant_id", tenantB);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it.each(["user_devices", "platform_admins", "platform_settings", "ai_trials", "app_errors"])("can never read the owner-only table %s", async (table) => {
    const { data } = await asA.from(table).select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("can never read stored tokens, even its own tenant's", async () => {
    const { data } = await asA.from("connection_secrets").select("*");
    expect(data ?? []).toHaveLength(0);
  });

  it("cannot write into the other tenant", async () => {
    const { error } = await asA.from("rules").insert({ tenant_id: tenantB, code: "R99", text: "planted" });
    expect(error).not.toBeNull();

    const { data: updated } = await asA.from("tenants").update({ name: "hacked" }).eq("id", tenantB).select("id");
    expect(updated ?? []).toHaveLength(0);

    const { data: still } = await admin.from("tenants").select("name").eq("id", tenantB).single();
    expect(still?.name).toBe(`Isolation B ${run}`);
  });

  it("cannot take the other tenant's quote numbers", async () => {
    const { error } = await asA.rpc("take_quote_number", { t: tenantB });
    expect(error).not.toBeNull();
    const own = await asA.rpc("take_quote_number", { t: tenantA });
    expect(own.error).toBeNull();
  });

  it("can upload into its own uploads folder but not the other tenant's", async () => {
    const own = await asA.storage.from("job-files").upload(`${tenantA}/uploads/${run}/rfq.txt`, new Blob(["rfq"]));
    expect(own.error).toBeNull();
    const other = await asA.storage.from("job-files").upload(`${tenantB}/uploads/${run}/planted.txt`, new Blob(["x"]));
    expect(other.error).not.toBeNull();
    const outside = await asA.storage.from("job-files").upload(`${tenantA}/some-job/planted.txt`, new Blob(["x"]));
    expect(outside.error).not.toBeNull();
    await admin.storage.from("job-files").remove([`${tenantA}/uploads/${run}/rfq.txt`]);
  });

  it("cannot read the other tenant's files", async () => {
    await admin.storage.from("job-files").upload(`${tenantB}/secret-${run}.txt`, new Blob(["secret"]), { upsert: true });
    const { data, error } = await asA.storage.from("job-files").download(`${tenantB}/secret-${run}.txt`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    await admin.storage.from("job-files").remove([`${tenantB}/secret-${run}.txt`]);
  });
});

describe("test configuration", () => {
  it("reports whether the isolation test ran", () => {
    if (!configured) console.warn("Tenant isolation test SKIPPED: set TEST_SUPABASE_* variables to run it.");
    expect(true).toBe(true);
  });
});
