/** Finding a portal's one-time sign-in code in an email. */
export function codeFromEmail(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;
  const labelled = /(?:one[- ]time|verification|access|security|login|sign[- ]in)?\s*code(?: is)?[^A-Za-z0-9]{0,20}([A-Z0-9]{4,10})\b/i.exec(text);
  if (labelled && /\d/.test(labelled[1])) return labelled[1];
  return /\b(\d{6})\b/.exec(text)?.[1] ?? null;
}

/** Is this email from a tender portal's sign-in system? */
export function isPortalCodeEmail(from: string, subject: string, body = ""): boolean {
  const portal = /estimateone|tenderlink|buildingconnected|procore|aconex/i;
  // Straight from the portal, or forwarded on (e.g. an inbox rule from the sales inbox).
  return /code|verif|sign|log ?in|access/i.test(subject) && (portal.test(from) || (portal.test(body) && /one[- ]time|verification|code/i.test(body)));
}
