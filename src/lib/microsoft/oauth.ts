import { createHmac } from "node:crypto";
/**
 * Microsoft sign-in for connecting a mailbox (OAuth 2.0 authorization code flow,
 * multi-tenant app). The app gets tokens, never a password.
 * Scopes: offline_access (refresh token), User.Read (who connected), Mail.ReadWrite (read, label, draft).
 */
export const MS_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Files.Read.All"] as const;
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";

export type MsConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function msConfigFromEnv(siteUrl: string): MsConfig | null {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${siteUrl}/api/connect/microsoft/callback` };
}

export function authorizeUrl(cfg: MsConfig, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: MS_SCOPES.join(" "),
    state,
    prompt: "select_account",
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `${AUTHORITY}/authorize?${p.toString()}`;
}

export type MsTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
};

type TokenResponse = {
  access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
  error?: string; error_description?: string;
};

async function tokenRequest(cfg: MsConfig, body: Record<string, string>, fetchImpl: typeof fetch, now: number): Promise<MsTokens> {
  const res = await fetchImpl(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }).toString(),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`Microsoft sign-in failed: ${data.error_description ?? data.error ?? res.status}`);
  }
  return {
    access_token: data.access_token,
    // Microsoft may not return a new refresh token on every refresh; keep the old one then.
    refresh_token: data.refresh_token ?? body.refresh_token ?? "",
    // Refresh a minute early.
    expires_at: now + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
    scope: data.scope ?? "",
  };
}

export function exchangeCode(cfg: MsConfig, code: string, fetchImpl: typeof fetch = fetch, now = Date.now()) {
  return tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, scope: MS_SCOPES.join(" ") }, fetchImpl, now);
}

/**
 * Refresh with the scopes this connection was actually granted (older connections didn't approve
 * newer permissions; asking for them on refresh would fail and break the inbox).
 */
export function refreshTokens(cfg: MsConfig, refreshToken: string, fetchImpl: typeof fetch = fetch, now = Date.now(), granted?: string) {
  const scope = granted?.trim() ? (/offline_access/.test(granted) ? granted.trim() : `${granted.trim()} offline_access`) : MS_SCOPES.join(" ");
  return tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: refreshToken, scope }, fetchImpl, now);
}

/** Did this connection approve reading shared files (SharePoint / OneDrive links)? */
export function canReadFiles(tokens: Pick<MsTokens, "scope">): boolean {
  return /files\.read\.all/i.test(tokens.scope ?? "");
}

/** Returns a valid access token, refreshing (and reporting the new tokens to save) when needed. */
export async function validAccessToken(
  cfg: MsConfig,
  tokens: MsTokens,
  save: (t: MsTokens) => Promise<void>,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  if (tokens.expires_at > now) return tokens.access_token;
  const fresh = await refreshTokens(cfg, tokens.refresh_token, fetchImpl, now, tokens.scope);
  await save(fresh);
  return fresh.access_token;
}

export async function whoAmI(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<{ email: string; id: string }> {
  const res = await fetchImpl("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not read the Microsoft account (${res.status}).`);
  const me = (await res.json()) as { id: string; mail?: string | null; userPrincipalName?: string };
  return { id: me.id, email: me.mail ?? me.userPrincipalName ?? "" };
}

/**
 * The secret Microsoft echoes back on inbox notifications, so we know they're real.
 * GRAPH_CLIENT_STATE if set; otherwise derived from TOKEN_ENCRYPTION_KEY (never sent anywhere but Microsoft).
 */
export function graphClientState(): string | null {
  if (process.env.GRAPH_CLIENT_STATE) return process.env.GRAPH_CLIENT_STATE;
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("graph-client-state").digest("base64url").slice(0, 64);
}
