/** Unsaved changes kept on the phone, so a quote isn't lost when there's no signal on site. */
const key = (id: string) => `qo_unsaved_${id}`;

export type Backup<T> = { at: number; input: T };

export function readBackup<T>(id: string): Backup<T> | null {
  try {
    const raw = window.localStorage.getItem(key(id));
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup<T>;
    // Older than a fortnight: drop it.
    if (!b?.at || Date.now() - b.at > 14 * 86400_000) { window.localStorage.removeItem(key(id)); return null; }
    return b;
  } catch {
    return null;
  }
}

export function writeBackup<T>(id: string, input: T) {
  try { window.localStorage.setItem(key(id), JSON.stringify({ at: Date.now(), input })); } catch { /* storage full or blocked */ }
}

export function clearBackup(id: string) {
  try { window.localStorage.removeItem(key(id)); } catch { /* ignore */ }
}

/** A failed save that looks like no signal, rather than the server saying no. */
export const looksOffline = (e: unknown) => (typeof navigator !== "undefined" && navigator.onLine === false) || (e instanceof TypeError) || /fetch|network|Failed to/i.test(String((e as Error)?.message ?? e));
