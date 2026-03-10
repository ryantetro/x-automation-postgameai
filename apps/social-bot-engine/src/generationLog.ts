import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_DIR } from "./config.js";
import type {
  ContentFrameId,
  EmotionTarget,
  HookStructureId,
  NewsMomentType,
} from "./contentArchitecture.js";
import type { PublishPlatform } from "./analytics.js";

export interface GenerationLogEntry {
  runId: string;
  attemptId: string;
  timestamp: string;
  platformTargets: PublishPlatform[];
  sport: string;
  angle: string;
  contentFrameId?: ContentFrameId;
  hookStructureId?: HookStructureId;
  emotionTarget?: EmotionTarget;
  newsUsed: boolean;
  newsMomentType?: NewsMomentType;
  openingPattern?: string;
  rawOutput?: string;
  cleanedOutput?: string;
  passedChecks: string[];
  failedChecks: string[];
  rejectionReason?: string;
  acceptedForPublish: boolean;
  usedFallback: boolean;
}

export const GENERATION_LOG_FILE = resolve(STATE_DIR, "generation-log.jsonl");

export function appendGenerationLog(entry: GenerationLogEntry): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(GENERATION_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf-8");
  } catch (error) {
    console.warn("Generation log append failed:", error);
  }
}
