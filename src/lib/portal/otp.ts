/** Finding a portal's one-time sign-in code in an email. */
export function codeFromEmail(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;
  const labelled = /(?:one[- ]time|verification|access|security|login|sign[- ]in)?\s*code(?: is)?[^A-Za-z0-9]{0,20}([A-Z0-9]{4,10})\b/i.exec(text);
  if (labelled && /\d/.test(labelled[1])) return labelled[1];
  return /\b(\d{6})\b/.exec(text)?.[1] ?? null;
}

/** Is this email from a tender portal's sign-in system? */
export function isPortalCodeEmail(from: string, subject: string): boolean {
  return /estimateone|tenderlink|buildingconnected|procore|aconex/i.test(from) && /code|verif|sign|log ?in|access/i.test(subject);
}
