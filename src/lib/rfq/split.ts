/** Shared by the worker and the quote page. */
export type RfqSummary = {
  from: string; subject: string; received: string | null;
  files: { name: string; path: string; read: "text" | "image" | "no"; note: string | null }[];
  followUps: number;
};

/** Splits our saved "From/To/Date/Subject + body" text back into header and body. */
export function splitSavedEmail(text: string) {
  const [head, ...rest] = text.split(/\r?\n\r?\n/);
  const get = (k: string) => new RegExp(`^${k}: (.*)$`, "mi").exec(head)?.[1]?.trim() ?? null;
  return { from: get("From"), subject: get("Subject"), date: get("Date"), body: rest.join("\n\n") };
}
