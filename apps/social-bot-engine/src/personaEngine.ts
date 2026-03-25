import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPAIGNS_DIR } from "./config.js";
import { BRAND_NAME, BRAND_WEBSITE } from "./validate.js";

// ── Types ──

export interface PersonaVoiceTraits {
  humor: string;
  sentenceStyle: string;
  tone: string;
  perspective: string;
}

export interface PersonaDimensionMapping {
  voiceFamilies?: string[];
  contentBuckets?: string[];
  seriesIds?: string[];
}

export interface Persona {
  id: string;
  name: string;
  weight: number;
  brandMentionPolicy: "never" | "sometimes";
  contentTerritory: string[];
  voiceTraits: PersonaVoiceTraits;
  contentTypes: string[];
  dimensionMapping?: PersonaDimensionMapping;
  preferredFrames?: string[];
  preferredHooks?: string[];
  examplePosts: string[];
  antiPatterns: string[];
}

export interface PersonasFile {
  personas: Persona[];
}

export interface PersonaSelection {
  persona: Persona;
  adjustedWeight: number;
}

export interface WeightAdjustment {
  personaId: string;
  oldWeight: number;
  newWeight: number;
}

// ── Constants ──

const VALID_CONTENT_TYPES = new Set([
  "observation",
  "hot_take",
  "micro_story",
  "community_question",
  "list_post",
]);
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 0.40;
const MIN_EXAMPLE_POSTS = 3;

// ── Loading & Validation ──

export function loadPersonas(campaignSlug: string): PersonasFile | null {
  const path = resolve(CAMPAIGNS_DIR, campaignSlug, "personas.json");
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as PersonasFile;
  validatePersonas(data);
  return data;
}

export function validatePersonas(data: PersonasFile): void {
  if (!data.personas || data.personas.length === 0) {
    throw new Error("personas.json must have at least one persona");
  }

  const weightSum = data.personas.reduce((sum, p) => sum + p.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    console.warn(
      `Persona weights sum to ${weightSum.toFixed(3)}, expected 1.0. Normalizing.`
    );
    const factor = 1.0 / weightSum;
    for (const p of data.personas) {
      p.weight = Number((p.weight * factor).toFixed(4));
    }
  }

  for (const p of data.personas) {
    for (const ct of p.contentTypes) {
      if (!VALID_CONTENT_TYPES.has(ct)) {
        console.warn(
          `Persona "${p.id}" has unknown content type "${ct}". Ignoring.`
        );
      }
    }
    if (p.examplePosts.length < MIN_EXAMPLE_POSTS) {
      console.warn(
        `Persona "${p.id}" has ${p.examplePosts.length} example posts (minimum ${MIN_EXAMPLE_POSTS}).`
      );
    }
  }
}

// ── Selection ──

export function selectPersona(
  personas: PersonasFile,
  weightAdjustments?: WeightAdjustment[]
): PersonaSelection {
  const adjusted = personas.personas.map((p) => {
    let weight = p.weight;
    const adj = weightAdjustments?.find((a) => a.personaId === p.id);
    if (adj) {
      weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, adj.newWeight));
    }
    return { persona: p, weight };
  });

  // Normalize
  const total = adjusted.reduce((sum, a) => sum + a.weight, 0);
  const normalized = adjusted.map((a) => ({
    ...a,
    weight: a.weight / total,
  }));

  // Weighted random
  const rand = Math.random();
  let cumulative = 0;
  for (const entry of normalized) {
    cumulative += entry.weight;
    if (rand <= cumulative) {
      return { persona: entry.persona, adjustedWeight: entry.weight };
    }
  }

  // Fallback to last
  const last = normalized[normalized.length - 1];
  return { persona: last.persona, adjustedWeight: last.weight };
}

// ── Prompt Composition ──

export function composePersonaOverlay(persona: Persona): string {
  const lines: string[] = [
    "",
    "--- ACTIVE PERSONA ---",
    `You are posting as: ${persona.name}`,
    "",
    "Voice for this post:",
    `- Humor: ${persona.voiceTraits.humor}`,
    `- Sentence style: ${persona.voiceTraits.sentenceStyle}`,
    `- Tone: ${persona.voiceTraits.tone}`,
    `- Perspective: ${persona.voiceTraits.perspective}`,
    "",
    `Content territory for this post: ${persona.contentTerritory[Math.floor(Math.random() * persona.contentTerritory.length)]}`,
    "",
    "Study these example posts for rhythm and voice (do not copy them):",
    ...persona.examplePosts.map((ex) => `- "${ex}"`),
    "",
    "Rules for this persona:",
    ...persona.antiPatterns.map((ap) => `- ${ap}`),
  ];

  if (persona.brandMentionPolicy === "never") {
    lines.push(
      "",
      `Brand mention: DO NOT include "${BRAND_NAME}" or "${BRAND_WEBSITE}" in this post. This is a pure personality post.`
    );
  } else if (persona.brandMentionPolicy === "sometimes") {
    lines.push(
      "",
      `Brand mention: You MAY include a light "${BRAND_NAME} · ${BRAND_WEBSITE}" tag at the end ONLY if the post reads naturally with it. If the post works better without it, skip it. Never force it.`
    );
  }

  return lines.join("\n");
}

export function composeSystemPromptWithPersona(
  baseSystemPrompt: string,
  persona: Persona
): string {
  return `${baseSystemPrompt}\n${composePersonaOverlay(persona)}`;
}
