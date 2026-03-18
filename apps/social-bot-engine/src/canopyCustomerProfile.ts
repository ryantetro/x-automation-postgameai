import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPAIGNS_DIR } from "./config.js";
import type { CanopyStrategyEnvelope } from "./canopyAgent.js";

export interface CanopyCustomerProfileCompanyType {
  id: string;
  label: string;
  examples: string[];
}

export interface CanopyCustomerProfile {
  jobTitles: string[];
  companyTypes: CanopyCustomerProfileCompanyType[];
  companySizes: string[];
  decisionMakerProfile: {
    ageRange: string;
    education: string;
    incomeRange: string;
    location: string;
    techComfort: string;
  };
  motivations: string[];
  mindset: string;
  highIntentTriggers: string[];
  timingWindow: string;
  purchaseBundle: string[];
  averageOrderValue: string;
}

let cachedProfile: CanopyCustomerProfile | null | undefined;
let cachedSlug: string | null | undefined;

export function loadCanopyCustomerProfile(): CanopyCustomerProfile | null {
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) {
    cachedSlug = null;
    cachedProfile = null;
    return null;
  }
  if (cachedProfile !== undefined && cachedSlug === slug) return cachedProfile;
  cachedSlug = slug;
  const path = resolve(CAMPAIGNS_DIR, slug, "customer-profile.json");
  if (!existsSync(path)) {
    cachedProfile = null;
    return null;
  }
  try {
    cachedProfile = JSON.parse(readFileSync(path, "utf-8")) as CanopyCustomerProfile;
    return cachedProfile;
  } catch {
    cachedProfile = null;
    return null;
  }
}

function audienceTypeIdsForStrategy(strategy: CanopyStrategyEnvelope | undefined): string[] {
  if (!strategy) return ["event_driven_businesses", "promotional_and_marketing"];
  const vertical = `${strategy.useCaseVertical} ${strategy.productFocus} ${strategy.angle}`.toLowerCase();
  const ids = new Set<string>();
  if (/\bsport|tournament|league|athletic|school|sideline|fitness\b/.test(vertical)) ids.add("sports_and_community");
  if (/\btrade show|expo|real estate|dealership|telecom|insurance|brand|activation|startup\b/.test(vertical)) ids.add("promotional_and_marketing");
  if (/\bfarmers market|food truck|festival|pop-up|craft|vendor\b/.test(vertical)) ids.add("event_driven_businesses");
  if (/\broofing|hvac|landscaping|pest|home improvement|service\b/.test(vertical)) ids.add("local_service_businesses");
  if (ids.size === 0) {
    ids.add("event_driven_businesses");
    ids.add("promotional_and_marketing");
  }
  return [...ids];
}

export function buildCanopyCustomerProfilePromptBlock(strategy: CanopyStrategyEnvelope | undefined): string {
  const profile = loadCanopyCustomerProfile();
  if (!profile) return "";
  const relevantTypes = profile.companyTypes.filter((type) => audienceTypeIdsForStrategy(strategy).includes(type.id));
  const jobTitles = profile.jobTitles.slice(0, 6).join(", ");
  const companyTypes = relevantTypes.map((type) => `${type.label}: ${type.examples.slice(0, 3).join(", ")}`).join(" | ");
  const companySizes = profile.companySizes.join(", ");
  const motivations = profile.motivations.slice(0, 4).join(", ");
  const triggers = profile.highIntentTriggers.slice(0, 4).join(", ");
  const bundle = profile.purchaseBundle.slice(0, 4).join(", ");
  return [
    "Ideal customer profile for this campaign:",
    `- Primary decision makers: ${jobTitles}.`,
    `- Most relevant buyer segments: ${companyTypes}.`,
    `- Company sizes in play: ${companySizes}.`,
    `- What they care about: ${motivations}.`,
    `- High-intent triggers: ${triggers}.`,
    `- Typical mindset: "${profile.mindset}"`,
    `- Common bundle: ${bundle}.`,
    `- Buying window: ${profile.timingWindow}`,
  ].join("\n");
}
