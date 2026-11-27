/**
 * Recognising the phones and computers a login is used on, and spotting a login
 * that looks shared. Pure helpers: no database, so they are easy to test.
 */

export const DEVICE_COOKIE = "qo_device";
export const CHECK_COOKIE = "qo_chk";
/** How often (seconds) a signed-in browser is re-checked against the database. */
export const CHECK_EVERY_S = 300;

/** A short, human label like "iPhone · Safari" or "Windows · Chrome". */
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? "";
  const os = /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /Linux/.test(s) ? "Linux"
    : "Unknown device";
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\/|Opera/.test(s) ? "Opera"
    : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /CriOS|Chrome\//.test(s) ? "Chrome"
    : /FxiOS|Firefox\//.test(s) ? "Firefox"
    : /Safari\//.test(s) ? "Safari"
    : null;
  return browser ? `${os} · ${browser}` : os;
}

export type Where = { ip: string | null; city: string | null; region: string | null; country: string | null };

/** Rough location from the headers Vercel adds to each request. */
export function whereFrom(h: Headers): Where {
  const dec = (v: string | null) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return v; }
  };
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return {
    ip,
    city: dec(h.get("x-vercel-ip-city")),
    region: dec(h.get("x-vercel-ip-country-region")),
    country: dec(h.get("x-vercel-ip-country")),
  };
}

export function placeName(w: { city: string | null; region: string | null; country: string | null }) {
  return [w.city, w.region, w.country && w.country !== "AU" ? w.country : null].filter(Boolean).join(", ") || "Unknown place";
}

export type DeviceRow = {
  id: string;
  user_id: string;
  device_id: string;
  label: string | null;
  session_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  last_seen: string;
  first_seen: string;
  revoked_at: string | null;
};

/** Devices to sign out so a login keeps at most `max`: the ones used longest ago go first. */
export function devicesOverLimit(active: DeviceRow[], max: number | null, keepId: string): DeviceRow[] {
  if (!max || active.length <= max) return [];
  const others = active.filter((d) => d.id !== keepId).sort((a, b) => a.last_seen.localeCompare(b.last_seen));
  return others.slice(0, active.length - max);
}

export type ShareFlag = { userId: string; reason: string; at: string };

/**
 * Signs that one login is being used by more than one person:
 *  - two devices active within two hours of each other, in different cities;
 *  - more than four different devices in the last week.
 */
export function shareFlags(devices: DeviceRow[], now = new Date()): ShareFlag[] {
  const flags: ShareFlag[] = [];
  const byUser = new Map<string, DeviceRow[]>();
  for (const d of devices) byUser.set(d.user_id, [...(byUser.get(d.user_id) ?? []), d]);
  const week = now.getTime() - 7 * 24 * 3600 * 1000;

  for (const [userId, list] of byUser) {
    const recent = list.filter((d) => new Date(d.last_seen).getTime() >= week);
    if (recent.length > 4) {
      flags.push({ userId, reason: `${recent.length} different devices in the last week`, at: recent[0].last_seen });
    }
    const sorted = [...recent].sort((a, b) => b.last_seen.localeCompare(a.last_seen));
    outer: for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i], b = sorted[j];
        if (!a.city || !b.city || a.city === b.city) continue;
        const gap = Math.abs(new Date(a.last_seen).getTime() - new Date(b.last_seen).getTime());
        if (gap <= 2 * 3600 * 1000) {
          flags.push({ userId, reason: `Used in ${a.city} and ${b.city} within ${Math.max(1, Math.round(gap / 60000))} min`, at: a.last_seen });
          break outer;
        }
      }
    }
  }
  return flags;
}
