import { describe, expect, it } from "vitest";
import { authorizeUrl, exchangeCode, validAccessToken, type MsConfig, type MsTokens } from "@/lib/microsoft/oauth";

const cfg: MsConfig = { clientId: "client-1", clientSecret: "secret", redirectUri: "https://quotes.example/api/connect/microsoft/callback" };

function tokenFetch(response: object, status = 200) {
  const bodies: URLSearchParams[] = [];
  const impl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify(response), { status });
  }) as typeof fetch;
  return { impl, bodies };
}

describe("Microsoft OAuth", () => {
  it("asks only for the three scopes, with state", () => {
    const url = new URL(authorizeUrl(cfg, "abc"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access User.Read Mail.ReadWrite");
    expect(url.searchParams.get("state")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
  });

  it("exchanges a code and refreshes a minute early", async () => {
    const { impl, bodies } = tokenFetch({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "Mail.ReadWrite" });
    const t = await exchangeCode(cfg, "code-1", impl, 1_000_000);
    expect(t).toEqual({ access_token: "at", refresh_token: "rt", expires_at: 1_000_000 + 3540_000, scope: "Mail.ReadWrite" });
    expect(bodies[0].get("grant_type")).toBe("authorization_code");
    expect(bodies[0].get("client_secret")).toBe("secret");
  });

  it("surfaces Microsoft's error message", async () => {
    const { impl } = tokenFetch({ error: "invalid_grant", error_description: "Code expired" }, 400);
    await expect(exchangeCode(cfg, "old", impl)).rejects.toThrow("Code expired");
  });

  it("reuses a valid token and refreshes an expired one, keeping the old refresh token if none is returned", async () => {
    const tokens: MsTokens = { access_token: "old", refresh_token: "rt1", expires_at: 2_000, scope: "" };
    let saved: MsTokens | null = null;
    const { impl } = tokenFetch({ access_token: "new", expires_in: 3600 });

    expect(await validAccessToken(cfg, tokens, async (t) => { saved = t; }, impl, 1_000)).toBe("old");
    expect(saved).toBeNull();

    expect(await validAccessToken(cfg, tokens, async (t) => { saved = t; }, impl, 3_000)).toBe("new");
    expect(saved).toMatchObject({ access_token: "new", refresh_token: "rt1" });
  });
});
