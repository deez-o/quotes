/** What a Xero quote status means for ours. */
export function statusFromXero(s: string | undefined): "won" | "lost" | null {
  if (s === "ACCEPTED" || s === "INVOICED") return "won";
  if (s === "DECLINED") return "lost";
  return null;
}

