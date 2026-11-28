import { describe, expect, it } from "vitest";
import { deviceLabel, devicesOverLimit, placeName, shareFlags, whereFrom, type DeviceRow } from "@/lib/devices";
import { limitsFor, PLANS } from "@/lib/plans";

const at = (minAgo: number) => new Date(Date.UTC(2026, 10, 27, 10, 0) - minAgo * 60000).toISOString();
const dev = (o: Partial<DeviceRow>): DeviceRow => ({
  id: "d", user_id: "u1", device_id: "x", label: null, session_id: null, city: "Brisbane", region: "QLD", country: "AU",
  last_seen: at(0), first_seen: at(0), revoked_at: null, ...o,
});
const now = new Date(Date.UTC(2026, 10, 27, 10, 0));

describe("devices", () => {
  it("labels common phones and browsers", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0")).toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("Android · Chrome");
    expect(deviceLabel(null)).toBe("Unknown device");
  });

  it("reads Vercel's location headers", () => {
    const w = whereFrom(new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "x-vercel-ip-city": "Burpengary%20East", "x-vercel-ip-country-region": "QLD", "x-vercel-ip-country": "AU" }));
    expect(w).toEqual({ ip: "1.2.3.4", city: "Burpengary East", region: "QLD", country: "AU" });
    expect(placeName(w)).toBe("Burpengary East, QLD");
  });

  it("signs out the device used longest ago when over the limit", () => {
    const list = [dev({ id: "a", last_seen: at(300) }), dev({ id: "b", last_seen: at(10) }), dev({ id: "new", last_seen: at(0) })];
    expect(devicesOverLimit(list, 2, "new").map((d) => d.id)).toEqual(["a"]);
    expect(devicesOverLimit(list, 3, "new")).toEqual([]);
    expect(devicesOverLimit(list, null, "new")).toEqual([]);
    // Never signs out the device that just signed in, even if its row looks oldest.
    expect(devicesOverLimit([dev({ id: "new", last_seen: at(900) }), dev({ id: "b", last_seen: at(5) })], 1, "new").map((d) => d.id)).toEqual(["b"]);
  });

  it("flags a login used in two cities close together", () => {
    const flags = shareFlags([dev({ id: "a", device_id: "1", city: "Brisbane", last_seen: at(5) }), dev({ id: "b", device_id: "2", city: "Sydney", last_seen: at(40) })], now);
    expect(flags).toHaveLength(1);
    expect(flags[0].reason).toMatch(/Brisbane and Sydney within 35 min/);
  });

  it("doesn't flag the same city, or cities hours apart", () => {
    expect(shareFlags([dev({ id: "a", city: "Brisbane", last_seen: at(5) }), dev({ id: "b", city: "Brisbane", last_seen: at(10) })], now)).toEqual([]);
    expect(shareFlags([dev({ id: "a", city: "Brisbane", last_seen: at(5) }), dev({ id: "b", city: "Sydney", last_seen: at(400) })], now)).toEqual([]);
  });

  it("flags lots of devices in a week", () => {
    const many = [1, 2, 3, 4, 5].map((i) => dev({ id: `d${i}`, device_id: `${i}`, last_seen: at(i * 60) }));
    expect(shareFlags(many, now).some((f) => /5 different devices/.test(f.reason))).toBe(true);
  });
});

describe("plans", () => {
  it("uses the founding prices, every plan with everything", () => {
    expect([PLANS.site.priceMonthly, PLANS.pro.priceMonthly, PLANS.business.priceMonthly]).toEqual([299, 499, 799]);
    expect([PLANS.site.aiQuotes, PLANS.pro.aiQuotes, PLANS.business.aiQuotes]).toEqual([30, 100, 200]);
    expect(PLANS.site.emailAutoQuote && PLANS.site.connectedMailbox).toBe(true);
  });
  it("lets a company's own limits override its plan", () => {
    expect(limitsFor({ plan: "pro", ai_quota_month: null, max_devices: null })).toMatchObject({ aiQuotes: 100, maxDevices: 3 });
    expect(limitsFor({ plan: "pro", ai_quota_month: 300, max_devices: 5 })).toMatchObject({ aiQuotes: 300, maxDevices: 5 });
    expect(limitsFor({ plan: "nonsense", ai_quota_month: null, max_devices: null }).plan.id).toBe("trial");
  });
});
