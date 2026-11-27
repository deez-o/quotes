import { describe, expect, it } from "vitest";
import { roadRoute, searchPlaces, truckMinutes } from "@/lib/maps";

type Call = { url: string; init?: RequestInit };
function fake(responses: { match: string; status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = responses.find((x) => url.includes(x.match));
    return new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 200 });
  }) as typeof fetch;
  return { impl, calls };
}

describe("place search", () => {
  it("uses Google Places when there is a key, biased to Australia", async () => {
    const { impl, calls } = fake([{ match: "places:searchText", body: { places: [
      { displayName: { text: "Downer Asphalt Brendale" }, formattedAddress: "1 Demo St, Brendale QLD 4500, Australia", location: { latitude: -27.32, longitude: 152.98 } },
    ] } }]);
    const r = await searchPlaces("Downer Brendale", { apiKey: "k", fetchImpl: impl });
    expect(r).toEqual([{ name: "Downer Asphalt Brendale", address: "1 Demo St, Brendale QLD 4500, Australia", lat: -27.32, lng: 152.98, source: "google" }]);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ textQuery: "Downer Brendale", regionCode: "AU" });
    expect((calls[0].init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
  });

  it("falls back to OpenStreetMap without a key", async () => {
    const { impl, calls } = fake([{ match: "nominatim", body: [{ name: "Brendale", display_name: "Brendale, Moreton Bay, QLD, Australia", lat: "-27.32", lon: "152.98" }] }]);
    const r = await searchPlaces("Brendale QLD", { fetchImpl: impl });
    expect(r[0]).toMatchObject({ name: "Brendale", lat: -27.32, lng: 152.98, source: "osm" });
    expect(calls[0].url).toContain("countrycodes=au");
  });

  it("ignores very short searches and reports Google errors", async () => {
    expect(await searchPlaces("ab")).toEqual([]);
    const { impl } = fake([{ match: "places", status: 403, body: { error: { message: "API key not valid" } } }]);
    await expect(searchPlaces("Downer", { apiKey: "bad", fetchImpl: impl })).rejects.toThrow("API key not valid");
  });
});

describe("road routing", () => {
  it("reads Google's distance and duration", async () => {
    const { impl } = fake([{ match: "computeRoutes", body: { routes: [{ distanceMeters: 38412, duration: "2465s" }] } }]);
    expect(await roadRoute({ lat: -27.2, lng: 152.96 }, { lat: -27.53, lng: 153.2 }, { apiKey: "k", fetchImpl: impl }))
      .toEqual({ km: 38.4, minutes: 41, source: "google" });
  });

  it("uses OSRM without a key", async () => {
    const { impl, calls } = fake([{ match: "router.project-osrm.org", body: { code: "Ok", routes: [{ distance: 45150, duration: 2700 }] } }]);
    expect(await roadRoute({ lat: -27.2, lng: 152.96 }, { lat: -27.53, lng: 153.2 }, { fetchImpl: impl }))
      .toEqual({ km: 45.2, minutes: 45, source: "osm" });
    expect(calls[0].url).toContain("152.96,-27.2;153.2,-27.53");
  });

  it("returns null when no route is found", async () => {
    const { impl } = fake([{ match: "osrm", body: { code: "NoRoute" } }]);
    expect(await roadRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { fetchImpl: impl })).toBeNull();
  });

  it("trucks take longer than cars", () => {
    expect(truckMinutes(40)).toBe(46);
    expect(truckMinutes(40, 1.3)).toBe(52);
  });
});
