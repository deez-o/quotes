"use server";

import { requireTenant } from "@/lib/tenant";
import { searchPlaces, type Place } from "@/lib/maps";

/** Find a place by name or address ("Downer Brendale", "12 Smith St Caboolture"). Signed-in users only. */
export async function findPlaces(query: string, near?: { lat: number; lng: number } | null): Promise<{ ok: true; places: Place[]; google: boolean } | { ok: false; message: string }> {
  try {
    await requireTenant();
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || null;
    const places = await searchPlaces(String(query ?? "").slice(0, 200), { apiKey, near: near ?? null });
    return { ok: true, places, google: !!apiKey };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Search failed." };
  }
}
