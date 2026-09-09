export type StorefrontTemplate = "fresh-market" | "classic";
export interface BrandingConfig {
  companyName: string;
  primaryColor: string;
  currencySymbol: string;
  logoUrl?: string | null;
  storefrontTemplate: StorefrontTemplate;
  storefrontTemplates?: Array<{ id: StorefrontTemplate; name: string; description: string }>;
}
export const defaultBranding: BrandingConfig = {
  companyName: "GlobiPOS Market",
  primaryColor: "#286342",
  currencySymbol: "€",
  storefrontTemplate: "fresh-market",
  storefrontTemplates: [
    { id: "fresh-market", name: "Fresh Market", description: "Produce-led grocery storefront." },
    { id: "classic", name: "Classic", description: "Compact customer catalog." },
  ],
};