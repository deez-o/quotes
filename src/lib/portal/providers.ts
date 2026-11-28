/** Tender portals quoteout can sign in to. Safe to use in the browser. */
export const PORTAL_PROVIDERS = [
  { provider: "estimateone", name: "EstimateOne" },
  { provider: "tenderlink", name: "Tenderlink" },
  { provider: "buildingconnected", name: "BuildingConnected" },
  { provider: "procore", name: "Procore" },
  { provider: "aconex", name: "Aconex" },
] as const;
export type PortalProvider = (typeof PORTAL_PROVIDERS)[number]["provider"];

export function providerFor(portalName: string): PortalProvider | null {
  return PORTAL_PROVIDERS.find((p) => p.name.toLowerCase() === portalName.toLowerCase())?.provider ?? null;
}

