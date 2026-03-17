import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { STATE_DIR } from "./config.js";
import type {
  ContentFrameId,
  EmotionTarget,
  HookStructureId,
  NewsMomentType,
} from "./contentArchitecture.js";
import type {
  CanopyAgentMode,
  CanopyBuyerIntentLevel,
  CanopyCtaMode,
  CanopyImageShotType,
  CanopyImageStyleFamily,
  CanopyUrgencyMode,
  CanopyVoiceFamily,
  PublishPlatform,
} from "./analytics.js";

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
  campaignStrategyId?: string;
  voiceFamily?: CanopyVoiceFamily;
  buyerIntentLevel?: CanopyBuyerIntentLevel;
  useCaseVertical?: string;
  productFocus?: string;
  urgencyMode?: CanopyUrgencyMode;
  ctaMode?: CanopyCtaMode;
  imageConceptId?: string;
  imageStyleFamily?: CanopyImageStyleFamily;
  imageShotType?: CanopyImageShotType;
  optimizerVersion?: string;
  selectionReason?: string;
  creativeDirection?: string;
  candidateId?: string;
  candidateBatchId?: string;
  candidateScore?: number;
  candidateRank?: number;
  candidateRejectionReason?: string;
  selectedForPublish?: boolean;
  agentMode?: CanopyAgentMode;
  strategyEnvelopeId?: string;
  agentReasoningSummary?: string;
  performanceWindowLabel?: string;
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
