/**
 * Documents linked from an RFQ email instead of attached: SharePoint / OneDrive (opened with the
 * company's connected Microsoft 365 account, as if they clicked the link), and public Dropbox and
 * Google Drive links. Tender portals are handled in lib/portal.
 */
import { unwrapLink } from "./portal";

export type DocLink = { kind: "microsoft" | "dropbox" | "gdrive"; url: string };

export function findDocLinks(body: string): DocLink[] {
  const out: DocLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    let url = unwrapLink(m[0].replace(/[.,;]+$/, ""));
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    const kind: DocLink["kind"] | null =
      /\.sharepoint\.com$|^1drv\.ms$|^onedrive\.live\.com$/.test(host) ? "microsoft"
      : /(^|\.)dropbox\.com$/.test(host) && /\/(s|sh|scl)\//.test(url) ? "dropbox"
      : /^drive\.google\.com$/.test(host) ? "gdrive" : null;
    if (!kind) continue;
    if (kind === "microsoft") url = cleanShareUrl(url);
    if (seen.has(url)) continue;
    // Not a document link: profile pages, sign-in pages, unsubscribes.
    if (/\/_layouts\/15\/(authenticate|signout)|\/personal\/[^/]+\/?$|login\./i.test(url)) continue;
    seen.add(url);
    out.push({ kind, url });
  }
  return out.slice(0, 5);
}

/** Outlook adds tracking (xsdata, sdata...) to SharePoint links; Microsoft rejects the link with them on. */
export function cleanShareUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k !== "e") u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

type File = { name: string; bytes: Uint8Array };
const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_FILES = 40;
const MAX_BYTES = 50 * 1024 * 1024;

/** A SharePoint / OneDrive sharing link -> its files (folders walked a few levels deep). */
export async function fetchMicrosoftShare(rawUrl: string, token: string, fetchImpl: typeof fetch = fetch): Promise<File[]> {
  const url = cleanShareUrl(rawUrl);
  const id = "u!" + Buffer.from(url).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
  const get = async (path: string) => {
    const r = await fetchImpl(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}`, Prefer: "redeemSharingLinkIfNecessary" } });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      throw new Error(r.status === 403 || r.status === 401 || /accessDenied|unauthenticated/i.test(detail)
        ? "the connected Microsoft account doesn't have access to that folder (it was probably shared only with the inbox it was sent to)"
        : r.status === 404 ? "that link has expired or was removed"
        : `Microsoft said ${r.status}${/"message":"([^"]{1,140})/.exec(detail)?.[1] ? `: ${/"message":"([^"]{1,140})/.exec(detail)![1]}` : ""}`);
    }
    return r.json() as Promise<Record<string, unknown>>;
  };
  type Item = { id: string; name: string; size?: number; folder?: unknown; file?: unknown; parentReference?: { driveId: string }; "@microsoft.graph.downloadUrl"?: string };
  const root = await get(`/shares/${id}/driveItem`) as unknown as Item;
  const files: File[] = [];
  const take = async (it: Item) => {
    if (files.length >= MAX_FILES || !it.file || (it.size ?? 0) > MAX_BYTES) return;
    const dl = it["@microsoft.graph.downloadUrl"];
    const r = dl ? await fetchImpl(dl) : await fetchImpl(`${GRAPH}/drives/${it.parentReference?.driveId}/items/${it.id}/content`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) files.push({ name: it.name, bytes: new Uint8Array(await r.arrayBuffer()) });
  };
  const walk = async (folder: Item, depth: number) => {
    const driveId = folder.parentReference?.driveId;
    let next: string | null = driveId ? `/drives/${driveId}/items/${folder.id}/children?$top=200` : `/shares/${id}/driveItem/children?$top=200`;
    while (next && files.length < MAX_FILES) {
      const page = await get(next.replace(GRAPH, "")) as { value: Item[]; "@odata.nextLink"?: string };
      for (const it of page.value) {
        if (it.folder && depth < 3) await walk(it, depth + 1);
        else await take(it);
      }
      next = page["@odata.nextLink"] ?? null;
    }
  };
  if (root.folder) await walk(root, 0); else await take(root);
  return files;
}

/** Public Dropbox / Google Drive links (anyone with the link). */
export async function fetchPublicLink(link: DocLink, fetchImpl: typeof fetch = fetch): Promise<File[]> {
  let url = link.url;
  if (link.kind === "dropbox") url = url.replace(/([?&])dl=0/, "$1dl=1") + (/[?&]dl=1/.test(url) ? "" : (url.includes("?") ? "&dl=1" : "?dl=1"));
  if (link.kind === "gdrive") {
    const id = /\/d\/([\w-]{10,})/.exec(url)?.[1] ?? new URL(url).searchParams.get("id");
    if (!id || /\/folders\//.test(url)) throw new Error("Google Drive folders need opening by hand");
    url = `https://drive.google.com/uc?export=download&id=${id}`;
  }
  const r = await fetchImpl(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`the link said ${r.status}`);
  const type = r.headers.get("content-type") ?? "";
  if (/text\/html/.test(type)) throw new Error("the link needs a sign-in or isn't public");
  const cd = r.headers.get("content-disposition") ?? "";
  const name = decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd)?.[1] ?? (link.kind === "dropbox" ? "dropbox.zip" : "document.pdf"));
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new Error("the download is over 50 MB");
  return [{ name, bytes }];
}
