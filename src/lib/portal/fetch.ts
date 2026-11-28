/**
 * Downloads tender documents from a portal in a headless browser, signed in with the company's
 * saved login. It only ever opens the documents link, signs in and presses "download".
 * It never presses anything that answers the builder (quoting, not quoting, already have docs,
 * submit, decline) and never types anything but the saved email and password.
 */
import { readFile } from "node:fs/promises";

export type FetchResult =
  | { ok: true; files: { name: string; bytes: Uint8Array }[]; note: string }
  | { ok: false; reason: "login_needed" | "login_failed" | "two_step" | "no_documents" | "blocked" | "error"; message: string };

/** Words on a button or link we must never press. */
const NEVER = /quot(e|ing)|not quoting|declin|submit|already|respond|unsubscribe|request.*update|accept|reject|sign out|log ?out|delete|remove/i;
/** Words on a button or link that download documents. */
const DOWNLOAD = /download\s*(all|\d+\s*packages?|packages?|documents?|docs|files?|zip|everything)\b|^download$|get documents/i;

export type Login = { username: string; password: string } | null;
/** Reads a portal's emailed one-time code from the company's connected inbox (sent after `since`). */
export type OtpReader = (since: Date) => Promise<string | null>;

export async function fetchPortalDocs(docsUrl: string, login: Login, opts: { timeoutMs?: number; otp?: OtpReader | null } = {}): Promise<FetchResult> {
  const timeout = opts.timeoutMs ?? 120_000;
  const started = Date.now();
  const left = () => Math.max(5_000, timeout - (Date.now() - started));
  const { chromium } = await import("playwright-core");
  const sparticuz = (await import("@sparticuz/chromium")).default;
  const browser = await chromium.launch({ executablePath: await sparticuz.executablePath(), args: sparticuz.args, headless: true });
  try {
    const context = await browser.newContext({ acceptDownloads: true, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(docsUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Signed out: an emailed one-time code (read from the connected inbox), or the saved login.
    if (await onLoginPage(page)) {
      const viaCode = opts.otp ? await signInWithCode(page, opts.otp) : false;
      if (!viaCode) {
        if (!login) return { ok: false, reason: "login_needed", message: opts.otp ? "The portal's one-time code didn't arrive in your connected inbox, and there's no login saved." : "The portal asked to sign in. Connect the inbox the invites go to (Setup → Outlook) or save a portal login." };
        const signed = await signIn(page, login);
        if (!signed.ok) return signed;
      }
      await page.goto(docsUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      if (await onLoginPage(page)) return { ok: false, reason: "login_failed", message: "Signed in, but the portal asked to sign in again." };
    }
    if (/captcha|are you a robot|verify you are human/i.test(await page.content())) return { ok: false, reason: "blocked", message: "The portal showed a robot check." };

    // Pop-ups asking to create an account: close them.
    for (const close of await page.getByRole("button", { name: /^(×\s*)?close$|^×$/i }).all()) {
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
    }
    // Some portals open a project page with a Documents tab first.
    const docsTab = page.getByRole("link", { name: /^(documents|docs|files|tender documents)$/i }).or(page.getByRole("tab", { name: /^(documents|docs|files)$/i })).first();
    if (await docsTab.isVisible().catch(() => false)) { await docsTab.click(); await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}); }

    // 1. A "Download all" button (EstimateOne: "Download 1 package").
    const candidates = page.locator(".download-all-trigger, .download-trigger").or(page.getByRole("button", { name: DOWNLOAD })).or(page.getByRole("link", { name: DOWNLOAD }));
    const n = await candidates.count();
    for (let i = 0; i < n && Date.now() - started < timeout; i++) {
      const el = candidates.nth(i);
      const text = ((await el.innerText().catch(() => "")) || (await el.getAttribute("aria-label")) || "").trim();
      if (!text || NEVER.test(text) || !(await el.isVisible().catch(() => false))) continue;
      const got = await clickForDownload(page, el, left());
      if (got.length) return { ok: true, files: got, note: `Downloaded with "${text}".` };
    }

    // 2. Links straight to files.
    const hrefs: string[] = await page.$$eval("a[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const fileLinks = [...new Set(hrefs.filter((h) => /\.(pdf|zip|xlsx?|docx|dwg|png|jpe?g)(\?|$)/i.test(h)))].slice(0, 40);
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const h of fileLinks) {
      if (Date.now() - started > timeout) break;
      const r = await context.request.get(h, { timeout: 30_000 }).catch(() => null);
      if (!r || !r.ok()) continue;
      const name = decodeURIComponent(new URL(h).pathname.split("/").pop() || "document.pdf");
      files.push({ name, bytes: new Uint8Array(await r.body()) });
    }
    if (files.length) return { ok: true, files, note: `Downloaded ${files.length} file${files.length === 1 ? "" : "s"} from the documents page.` };
    return { ok: false, reason: "no_documents", message: "Signed in, but couldn't find the documents to download on that page." };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message.slice(0, 300) : "Fetching failed." };
  } finally {
    await browser.close().catch(() => {});
  }
}

type Page = import("playwright-core").Page;
type Locator = import("playwright-core").Locator;

async function onLoginPage(page: Page): Promise<boolean> {
  if (/\/(auth\/)?(login|signin|sign-in)\b|\/otp\b/i.test(page.url())) return true;
  if (/verify it.s you|one-time code/i.test(await page.locator("body").innerText().catch(() => ""))) return true;
  return (await page.locator("input[type=password]:visible").count()) > 0
    || (await page.locator("input[name*='login' i][type=email]:visible, input[autocomplete=username]:visible").count()) > 0;
}

/** "Get a one-time code by email", read it from the connected inbox, enter it. */
async function signInWithCode(page: Page, otp: OtpReader): Promise<boolean> {
  const ask = page.getByRole("button", { name: /one-time code|email (me )?a code|send (me )?a code/i }).first();
  const box = page.locator("input[name*='otp' i], input[autocomplete='one-time-code'], input[name*='code' i]").first();
  if (!(await box.isVisible().catch(() => false))) {
    if (!(await ask.isVisible().catch(() => false))) return false;
    const since = new Date(Date.now() - 60_000);
    await ask.click();
    await box.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    return enterCode(page, box, await waitForCode(otp, since));
  }
  return enterCode(page, box, await waitForCode(otp, new Date(Date.now() - 10 * 60_000)));
}

async function waitForCode(otp: OtpReader, since: Date): Promise<string | null> {
  for (let i = 0; i < 12; i++) {
    const code = await otp(since).catch(() => null);
    if (code) return code;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return null;
}

async function enterCode(page: Page, box: Locator, code: string | null): Promise<boolean> {
  if (!code) return false;
  await box.fill(code);
  await Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {}), box.press("Enter")]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return !(await onLoginPage(page));
}

async function signIn(page: Page, login: { username: string; password: string }): Promise<{ ok: true } | FetchResult & { ok: false }> {
  // "We need to verify it's you": choose to log in (not the emailed one-time code).
  const logIn = page.getByRole("link", { name: /^log ?in( to \w+)?$/i }).or(page.getByRole("button", { name: /^log ?in( to \w+)?$/i })).first();
  if (await logIn.isVisible().catch(() => false) && !(await page.locator("input[type=email]:visible, input[type=password]:visible").count())) {
    await logIn.click();
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }
  const email = page.locator("input[type=email]:visible, input[name*='email' i]:visible, input[autocomplete=username]:visible").first();
  if (await email.count()) {
    await email.fill(login.username);
    // Two-step forms (EstimateOne): email, then Next, then the password.
    if (!(await page.locator("input[type=password]:visible").count())) {
      await page.getByRole("button", { name: /^(next|continue|log ?in|sign ?in)$/i }).first().click();
      await page.locator("input[type=password]").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    }
  }
  const pw = page.locator("input[type=password]:visible").first();
  if (!(await pw.count())) {
    // Sent to Google/Microsoft/SSO instead of a password box.
    return { ok: false, reason: "login_failed", message: "This account signs in with Google, Microsoft or SSO, not a password. Set a password on the portal account, or add the documents by hand." };
  }
  await pw.fill(login.password);
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => {}),
    pw.press("Enter"),
  ]);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const html = (await page.content()).toLowerCase();
  if (/verification code|one-time code|authenticator|two-factor|2fa|enter the code/.test(html)) {
    return { ok: false, reason: "two_step", message: "The portal asked for a verification code (two-step sign-in)." };
  }
  if (/incorrect|invalid (email|password|credentials)|wrong password|couldn.t sign you in/.test(html) && (await page.locator("input[type=password]:visible").count())) {
    return { ok: false, reason: "login_failed", message: "The portal said the email or password is wrong." };
  }
  return { ok: true };
}

async function clickForDownload(page: Page, el: Locator, timeout: number): Promise<{ name: string; bytes: Uint8Array }[]> {
  const got: { name: string; bytes: Uint8Array }[] = [];
  // Packages are zipped on request, which can take a minute or two.
  const wait = page.waitForEvent("download", { timeout: Math.min(timeout, 150_000) }).catch(() => null);
  await el.click().catch(() => {});
  // A confirm box ("Download 23 files?") with its own download button.
  const confirm = page.getByRole("dialog").getByRole("button", { name: DOWNLOAD });
  if (await confirm.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    const t = (await confirm.first().innerText().catch(() => "")) || "";
    if (!NEVER.test(t)) await confirm.first().click().catch(() => {});
  }
  const d = await wait;
  if (d) {
    const path = await d.path().catch(() => null);
    if (path) got.push({ name: d.suggestedFilename() || "documents.zip", bytes: new Uint8Array(await readFile(path)) });
  }
  return got;
}
