/** Colour helpers for a customer's own brand colour on their printed quotes. */
export const BRAND_PRESETS = ["#C2410C", "#16181B", "#1D4ED8", "#047857", "#B91C1C", "#7C3AED", "#0E7490", "#A16207"] as const;
export const DEFAULT_BRAND = "#16181B";

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Readable text on the brand colour: white or near-black, whichever reads better. */
export const textOn = (hex: string) => (contrast(hex, "#FFFFFF") >= contrast(hex, "#16181B") ? "#FFFFFF" : "#16181B");
/** The brand colour as text on white paper, or near-black if it's too pale to read. */
export const inkOnWhite = (hex: string) => (contrast(hex, "#FFFFFF") >= 4.5 ? hex : "#16181B");
