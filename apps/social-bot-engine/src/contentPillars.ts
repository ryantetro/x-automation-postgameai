/**
 * Load content pillars from campaign content-pillars.json.
 * Used by angles_only campaigns (e.g. canopy) to inject pillar post ideas and target audience into the user message.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPAIGNS_DIR } from "./config.js";

export interface ContentPillar {
  id: string;
  name: string;
  postIdeas: string[];
  examplePost?: string;
  targetAudiences: string[];
}

interface ContentPillarsData {
  pillars: ContentPillar[];
}

let cachedPillars: ContentPillar[] | null | undefined;

function loadContentPillars(): ContentPillar[] | null {
  if (cachedPillars !== undefined) return cachedPillars;
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) {
    cachedPillars = null;
    return null;
  }
  const path = resolve(CAMPAIGNS_DIR, slug, "content-pillars.json");
  if (!existsSync(path)) {
    cachedPillars = null;
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as ContentPillarsData;
    cachedPillars = Array.isArray(data.pillars) ? data.pillars : null;
    return cachedPillars;
  } catch {
    cachedPillars = null;
    return null;
  }
}

/** Get 2-3 post ideas and one target audience for the given angle (pillar name) and date. */
export function loadPillarForAngle(
  angle: string,
  date: Date
): { postIdeas: string[]; targetAudience: string } | null {
  const pillars = loadContentPillars();
  if (!pillars) return null;
  const pillar = pillars.find((p) => p.name === angle);
  if (!pillar) return null;
  const postIdeas = pillar.postIdeas.slice(0, 3);
  const audiences = pillar.targetAudiences;
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  const targetAudience =
    audiences.length > 0 ? audiences[dayOfYear % audiences.length] : "event planners and vendors";
  return { postIdeas, targetAudience };
}
