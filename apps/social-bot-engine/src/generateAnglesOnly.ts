import { OPENAI_API_KEY, ACTIVE_LLM_MODEL, MAX_POST_LEN } from "./config.js";
import type { CanopyStrategyEnvelope, CanopyRankedCandidate } from "./canopyAgent.js";
import { loadPillarForAngle } from "./contentPillars.js";
import { buildCanopyCustomerProfilePromptBlock } from "./canopyCustomerProfile.js";
import { BRAND_NAME, BRAND_WEBSITE } from "./validate.js";
import {
  loadCampaignSystemPrompt,
  cleanResponse,
  requestTweet,
  soundsLikeAd,
  isDuplicateOfRecent,
  createLLMClient,
  BRAND_SUFFIX,
  CANOPY_GENERIC_PHRASES,
  CANOPY_HARD_CTA_PATTERNS,
  CANOPY_MOTIVATIONAL_PATTERNS,
  CANOPY_CORPORATE_PATTERNS,
  CANOPY_FIELD_TERMS,
  ANGLES_ONLY_POST_FORMATS,
  getAnglesOnlyPostFormatForDate,
  ANGLES_ONLY_CONTEXT_SNIPPETS,
  getAnglesOnlyContextForDate,
} from "./generatePost.js";
import type { Persona } from "./personaEngine.js";
import { composeSystemPromptWithPersona } from "./personaEngine.js";
import type { ContentTypeId } from "./contentTypeTemplates.js";
import { buildContentTypeInstruction } from "./contentTypeTemplates.js";

export interface GeneratePostAnglesOnlyOptions {
  angle: string;
  date?: string;
  recentTweets?: string[];
  reserveChars?: number;
  iterationGuidance?: string;
  strategy?: CanopyStrategyEnvelope;
  candidateDirective?: string;
  persona?: Persona;
  contentTypeId?: ContentTypeId;
  brandMentionAllowed?: boolean;
}

function getAnglesOnlyPostFormat(
  date: Date,
  strategy?: CanopyStrategyEnvelope
): (typeof ANGLES_ONLY_POST_FORMATS)[number] {
  if (strategy?.voiceFamily === "buyer_intent_detail") return "SPECIFIC DETAIL";
  if (strategy?.voiceFamily === "micro_story") return "MICRO-STORY";
  if (strategy?.voiceFamily === "contrarian_take") return "CONTRARIAN";
  if (strategy?.voiceFamily === "deadline_urgency") return "TENSION";
  if (strategy?.voiceFamily === "soft_commercial") return "SPECIFIC DETAIL";
  return getAnglesOnlyPostFormatForDate(date);
}

export interface BuildAnglesOnlyPromptOptions {
  angle: string;
  date?: string;
  recentTweets?: string[];
  reserveChars?: number;
  iterationGuidance?: string;
  strategy?: CanopyStrategyEnvelope;
  candidateDirective?: string;
  persona?: Persona;
  contentTypeId?: ContentTypeId;
  brandMentionAllowed?: boolean;
}

export function buildAnglesOnlyPromptInput(options: BuildAnglesOnlyPromptOptions): {
  system: string;
  format: (typeof ANGLES_ONLY_POST_FORMATS)[number];
  context: string;
  pillarData: ReturnType<typeof loadPillarForAngle>;
  userMessage: string;
  maxBodyLength: number;
  date: Date;
  dateStr: string;
} {
  const { angle, date: dateStr = new Date().toISOString().slice(0, 10), recentTweets = [], reserveChars = 0 } = options;
  const date = new Date(dateStr + "T12:00:00Z");
  const maxBodyLength = Math.max(180, MAX_POST_LEN - Math.max(0, reserveChars));
  const baseSystem = loadCampaignSystemPrompt();
  const system = options.persona
    ? composeSystemPromptWithPersona(baseSystem, options.persona)
    : baseSystem;
  const format = getAnglesOnlyPostFormat(date, options.strategy);
  const context = getAnglesOnlyContextForDate(date);
  const pillarData = loadPillarForAngle(angle, date);
  const strategy = options.strategy;
  const avoidBlock =
    recentTweets.length > 0
      ? `\nDo NOT repeat or closely mimic these recent posts:\n${recentTweets.slice(0, 10).map((t) => `- ${t}`).join("\n")}`
      : "";
  const pillarBlock =
    pillarData && pillarData.postIdeas.length > 0
      ? `\nPost ideas for this pillar (use as inspiration, do not list): ${pillarData.postIdeas.join("; ")}.\nTarget audience today: ${pillarData.targetAudience}.`
      : "";
  const strategyBlock = strategy
    ? `\nCampaign optimizer picked this strategy:
- Series: ${strategy.seriesId.replaceAll("_", " ")}
- Content bucket: ${strategy.contentBucket}
- Voice family: ${strategy.voiceFamily.replaceAll("_", " ")}
- Buyer intent level: ${strategy.buyerIntentLevel.replaceAll("_", " ")}
- Use-case vertical: ${strategy.useCaseVertical}
- Product focus: ${strategy.productFocus}
- Urgency mode: ${strategy.urgencyMode.replaceAll("_", " ")}
- CTA mode: ${strategy.ctaMode.replaceAll("_", " ")}
- Creative direction: ${strategy.creativeDirection.replaceAll("_", " ")}
- Brand tag policy: ${strategy.brandTagPolicy.replaceAll("_", " ")}
- Context hint: ${strategy.contextHint}
- Reason selected: ${strategy.selectionReason}`
    : "";
  const customerProfileBlock = buildCanopyCustomerProfilePromptBlock(strategy);
  const iterationBlock = options.iterationGuidance
    ? `\nIteration guidance from analytics:\n${options.iterationGuidance}`
    : "";
  const candidateBlock = options.candidateDirective?.trim()
    ? `\nCandidate directive for this attempt: ${options.candidateDirective.trim()}`
    : "";
  const userMessage = `Date: ${dateStr}. Focus theme: ${angle}. Post format: ${format}.

Context for this post: ${context}.${pillarBlock}${strategyBlock}${iterationBlock}${candidateBlock}${customerProfileBlock ? `\n\n${customerProfileBlock}` : ""}

Write one post in the specified format. If relevant, tie to seasonality or upcoming events. Keep the body under ${maxBodyLength} characters.

Hard canopy quality rules:
- Prefer statements over questions. Only use a question if the strategy clearly supports it, and never use more than one.
- Avoid filler like "stand out", "make an impact", "inviting and sturdy", "premium quality", "ready to", "don't scrimp", "the whole conversation", "turn heads", "everyone talks about", "grab attention", "catch the eye", or "not a myth".
- Avoid caption-writer language like "vibe check", "first impression", "tells a story", "does the talking", or "before you even say a word".
- Do not sound like ad copy, a caption writer, or a motivational brand.
- The post should be follow-worthy even for someone who is not buying right now.
- Local event culture, vendor life, and booth identity are stronger than obvious selling.
- It is okay if the canopy is implied, in the scene, or secondary to the observation.
- Observational takes beat explanations.
- One strong idea beats polished caption language.
- If the series is Utah Event Radar, the post must feel local and should mention Utah or a Utah-region event context.
- If the brand tag policy is none, do not include the brand name or website.
- If the brand tag policy is optional, only use it if the post still reads organic without it.
- Specific beats generic. Name the booth problem, the buyer tension, the deadline, or the product detail.
- Trade show / market / event context should feel real, not generic event-marketing language.
- Prefer physical event details: frame, wind, aisle, parking lot, valance, setup window, paid booth, replacement order, drooping vinyl, curbside visibility.
- Use the assigned creative direction as a guideline, not a template. Stay original.

Output only the post text.${avoidBlock}`;

  // Append content type instruction when persona is active
  const contentTypeBlock = options.contentTypeId && options.persona
    ? `\n\nContent type: ${options.contentTypeId.toUpperCase()}. ${buildContentTypeInstruction(
        options.contentTypeId,
        options.persona,
        options.brandMentionAllowed ?? false
      )}`
    : "";

  return { system, format, context, pillarData, userMessage: userMessage + contentTypeBlock, maxBodyLength, date, dateStr };
}

function fitAnglesOnlyPostToLimit(
  content: string,
  maxBodyLength: number,
  includeBrandTag: boolean
): string {
  let text = content.trim();
  const suffix = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
  const brandTagPattern = /\s*[—-]?\s*Vicious Shade Supply Co\.\s*·\s*viciousshade\.com\s*$/i;
  text = text.replace(brandTagPattern, "").trim();

  if (includeBrandTag && (!text.includes(BRAND_NAME) || !text.includes(BRAND_WEBSITE))) {
    if (text.length + suffix.length <= maxBodyLength) return `${text}${suffix}`;

    const roomForBody = Math.max(0, maxBodyLength - suffix.length);
    if (roomForBody <= 3) return suffix.trim().slice(0, maxBodyLength);

    const max = roomForBody - 3;
    const truncated = text.slice(0, max + 1);
    const lastSentence = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("? "),
      truncated.lastIndexOf("! ")
    );
    const lastSpace = truncated.lastIndexOf(" ");
    const breakAt = lastSentence >= 0 ? lastSentence + 1 : lastSpace >= 0 ? lastSpace : max;
    const brokeAtSentence = lastSentence >= 0;
    text = text.slice(0, breakAt).trim();
    if (!brokeAtSentence) text += "...";
    return `${text}${suffix}`.slice(0, maxBodyLength).trim();
  }

  if (text.length <= maxBodyLength) return text;

  const max = maxBodyLength - 3;
  const truncated = text.slice(0, max + 1);
  const lastSentence = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! ")
  );
  const lastSpace = truncated.lastIndexOf(" ");
  const breakAt = lastSentence >= 0 ? lastSentence + 1 : lastSpace >= 0 ? lastSpace : max;
  const brokeAtSentence = lastSentence >= 0;
  text = text.slice(0, breakAt).trim();
  if (!brokeAtSentence) text += "...";
  return text.slice(0, maxBodyLength).trim();
}

function anglesOnlyDeterministicIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function shouldIncludeCanopyBrandTag(strategy: CanopyStrategyEnvelope | undefined, date: Date): boolean {
  if (!strategy) return true;
  if (strategy.brandTagPolicy === "none") return false;
  if (strategy.brandTagPolicy === "soft_commercial") {
    return strategy.ctaMode === "soft_commercial" || strategy.contentBucket === "promo";
  }
  if (strategy.ctaMode === "soft_commercial" || strategy.contentBucket === "promo") return true;
  const optionalRate =
    strategy.seriesId === "proof_in_the_wild" ? 18
    : strategy.seriesId === "booth_identity" ? 14
    : 10;
  return anglesOnlyDeterministicIndex(`${date.toISOString().slice(0, 10)}:${strategy.seriesId}:brand-tag`, 100) < optionalRate;
}


function canopySentenceCount(text: string): number {
  return text
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function canopyQuestionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function soundsGenericCanopyCopy(text: string): boolean {
  return CANOPY_GENERIC_PHRASES.some((pattern) => pattern.test(text));
}

function hasConcreteCanopySignal(text: string): boolean {
  return /\btrade show\b|\bfarmers market\b|\bopen house\b|\bfestival\b|\btournament\b|\bfood truck\b|\bcanopy\b|\bfeather flag\b|\bvalance\b|\bframe\b|\brush\b|\blead time\b|\bparking lot\b|\bbooth\b/i.test(text);
}

function hasFieldDetail(text: string): boolean {
  return CANOPY_FIELD_TERMS.some((pattern) => pattern.test(text));
}

function canopyBrandTagCount(text: string): number {
  let count = 0;
  if (text.includes(BRAND_NAME)) count += 1;
  if (text.includes(BRAND_WEBSITE)) count += 1;
  return count;
}

function hasSeriesSpecificSignal(text: string, strategy: CanopyStrategyEnvelope | undefined): boolean {
  if (!strategy) return true;
  const normalized = text.toLowerCase();
  if (strategy.seriesId === "vendor_life") {
    return /\b5 a\.?m\b|\bload-?in\b|\bsetup\b|\bparking lot\b|\bvan\b|\bmarket\b|\bwind\b/.test(normalized);
  }
  if (strategy.seriesId === "booth_hot_take") {
    return /\bhot take\b|\bbooth\b|\bsetup\b|\bfolding table\b|\bgarage sale\b|\bmismatched\b|\btaste\b/.test(normalized);
  }
  if (strategy.seriesId === "booth_identity") {
    return /\bbrand\b|\bbooth\b|\bsetup\b|\bsign\b|\bdetails\b|\bvisual\b|\bintentional\b/.test(normalized);
  }
  if (strategy.seriesId === "proof_in_the_wild") {
    return /\bwind\b|\bframe\b|\bvalance\b|\bfabric\b|\bprint\b|\bfield\b|\bweather\b/.test(normalized);
  }
  if (strategy.seriesId === "utah_event_radar") {
    return /\butah\b|\bsalt lake\b|\butah county\b|\bprovo\b|\bogden\b|\bst\.?\s*george\b|\bfair\b|\bfestival\b|\bexpo\b|\bmarket\b/.test(normalized);
  }
  return true;
}

function validateAnglesOnlyDraft(
  text: string,
  strategy: CanopyStrategyEnvelope | undefined,
  format: (typeof ANGLES_ONLY_POST_FORMATS)[number],
  date: Date
): { ok: boolean; failedChecks: string[]; rejectionReason?: string } {
  const failedChecks: string[] = [];
  const includeBrandTag = shouldIncludeCanopyBrandTag(strategy, date);
  if (soundsLikeAd(text)) failedChecks.push("ad_tone");
  if (soundsGenericCanopyCopy(text)) failedChecks.push("generic_canopy_copy");
  if (CANOPY_HARD_CTA_PATTERNS.some((pattern) => pattern.test(text))) failedChecks.push("hard_cta");
  if (CANOPY_MOTIVATIONAL_PATTERNS.some((pattern) => pattern.test(text))) failedChecks.push("motivational_tone");
  if (CANOPY_CORPORATE_PATTERNS.some((pattern) => pattern.test(text))) failedChecks.push("corporate_tone");
  if (!hasConcreteCanopySignal(text)) failedChecks.push("missing_concrete_signal");
  if (!hasFieldDetail(text)) failedChecks.push("missing_field_detail");
  if (!hasSeriesSpecificSignal(text, strategy)) failedChecks.push("missing_series_signal");
  if (canopySentenceCount(text) > 3) failedChecks.push("too_many_sentences");
  const questions = canopyQuestionCount(text);
  if (questions > 1) failedChecks.push("too_many_questions");
  if (questions === 1 && strategy?.ctaMode !== "question_led") failedChecks.push("question_when_not_allowed");
  if (/^[^.!?]{0,35}\?/.test(text.trim())) failedChecks.push("question_lead");
  if (canopyBrandTagCount(text) > 2) failedChecks.push("brand_tag_repeated");
  if (!includeBrandTag && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE))) failedChecks.push("brand_tag_when_not_allowed");

  if (failedChecks.length === 0) return { ok: true, failedChecks };

  const rejectionReason =
    failedChecks[0] === "hard_cta"
      ? "hard_cta"
      : failedChecks[0] === "motivational_tone" || failedChecks[0] === "corporate_tone"
        ? "generic_canopy_copy"
        : failedChecks[0] === "generic_canopy_copy"
      ? "generic_canopy_copy"
      : failedChecks[0] === "missing_concrete_signal"
        ? "missing_concrete_signal"
        : failedChecks[0] === "missing_field_detail"
          ? "missing_field_detail"
          : failedChecks[0] === "missing_series_signal"
            ? "missing_series_signal"
          : failedChecks[0] === "brand_tag_repeated" || failedChecks[0] === "brand_tag_when_not_allowed"
            ? "brand_tag_problem"
          : failedChecks[0] === "too_many_questions" || failedChecks[0] === "question_when_not_allowed" || failedChecks[0] === "question_lead"
            ? "question_heavy"
            : failedChecks[0];
  return { ok: false, failedChecks, rejectionReason };
}

function canopyCandidateDirective(ordinal: number, strategy: CanopyStrategyEnvelope): string {
  const directions: string[] = [];
  if (strategy.seriesId === "vendor_life") {
    directions.push("Make it feel like event-day life: load-in, setup, weather, van, parking lot, or market routine.");
  } else if (strategy.seriesId === "booth_hot_take") {
    directions.push("Make it feel like a shareable booth opinion or mild roast with real taste, not random snark.");
  } else if (strategy.seriesId === "booth_identity") {
    directions.push("Center the difference between a booth that feels like a brand and one that feels generic.");
  } else if (strategy.seriesId === "proof_in_the_wild") {
    directions.push("Ground the post in real-world product proof: weather, wear, frame, fabric, print, or field reality.");
  } else if (strategy.seriesId === "utah_event_radar") {
    directions.push("Keep it local and useful. Mention Utah or a Utah-region event context without sounding like a flyer caption.");
  }
  if (strategy.creativeDirection === "customer_showcase") {
    directions.push("Write like you are describing a real customer setup or real booth moment in the wild.");
  } else if (strategy.creativeDirection === "before_after_transformation") {
    directions.push("Hint at a transformation from forgettable setup to credible branded presence without sounding like a reel caption.");
  } else if (strategy.creativeDirection === "educational_breakdown") {
    directions.push("Center the post on one practical buying or setup insight, not a listicle.");
  } else if (strategy.creativeDirection === "behind_the_scenes") {
    directions.push("Make it feel like a behind-the-scenes observation from production, packing, printing, or setup.");
  } else if (strategy.creativeDirection === "seasonal_urgency") {
    directions.push("Ground the post in event-calendar pressure, rush timing, or replacement urgency.");
  } else if (strategy.creativeDirection === "social_proof") {
    directions.push("Make it feel like a buyer lesson learned from real customers or repeated reorder behavior.");
  }
  const variants = [
    "Lead with a blunt observation.",
    "Lead with a concrete field detail.",
    "Lead with a micro-story from event day.",
    "Lead with a contrarian buying truth.",
    "Lead with a product-proof statement tied to a real booth problem.",
    "Lead with a pressure moment tied to setup, lead time, or replacement.",
  ];
  directions.push(variants[(ordinal - 1) % variants.length]!);
  directions.push(`This is candidate ${ordinal}; keep it meaningfully different from other drafts while staying inside the same strategy envelope.`);
  return directions.join(" ");
}

export function normalizeAnglesOnlyPostForLimit(
  content: string,
  maxBodyLength: number,
  format: (typeof ANGLES_ONLY_POST_FORMATS)[number],
  strategy?: CanopyStrategyEnvelope,
  date?: Date
): string {
  return fitAnglesOnlyPostToLimit(content, maxBodyLength, shouldIncludeCanopyBrandTag(strategy, date ?? new Date()));
}

/**
 * Generate a single post for campaigns with dataSource "angles_only" (e.g. canopy).
 * Uses campaign system prompt, rotating angle, rotating post format, and rotating context.
 */
export async function generatePostAnglesOnly(
  options: GeneratePostAnglesOnlyOptions
): Promise<{ text: string | null }> {
  if (!OPENAI_API_KEY) return { text: null };
  const { angle } = options;
  const { system, format, userMessage, maxBodyLength } = buildAnglesOnlyPromptInput(options);

  const client = createLLMClient();
  let bestCandidate: string | null = null;
  let prompt = userMessage;
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await requestTweet(client, system, prompt);
    if (!raw) continue;
    let content = normalizeAnglesOnlyPostForLimit(cleanResponse(raw), maxBodyLength, format, options.strategy, new Date(`${options.date ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`));
    if (options.brandMentionAllowed === false) {
      content = content
        .replace(new RegExp(`\\s*[—-]?\\s*${BRAND_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*·\\s*${BRAND_WEBSITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), "")
        .trim();
    }
    if (!bestCandidate && content.trim().length >= 12) bestCandidate = content;
    const evaluation = validateAnglesOnlyDraft(content, options.strategy, format, new Date(`${options.date ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`));
    if (evaluation.ok) return { text: content };
    if (evaluation.rejectionReason === "hard_cta") {
      prompt += "\nRewrite it with zero call-to-action language. No quote requests, no DM language, no link in bio energy.";
      continue;
    }
    if (evaluation.rejectionReason === "generic_canopy_copy") {
      prompt += "\nRewrite it with sharper booth reality, less generic brand language, and no phrases like 'stand out' or 'make an impact'.";
      continue;
    }
    if (evaluation.rejectionReason === "missing_concrete_signal") {
      prompt += "\nRewrite it with a real canopy-world signal: booth, trade show, parking lot, frame, valance, rush order, market, tournament, or lead time.";
      continue;
    }
    if (evaluation.rejectionReason === "missing_field_detail") {
      prompt += "\nRewrite it with a physical field detail, not abstract marketing language. Use something tangible like aisle, paid booth, wind, frame, valance, drooping vinyl, curbside setup, or replacement order.";
      continue;
    }
    if (evaluation.rejectionReason === "missing_series_signal") {
      prompt += "\nRewrite it so it unmistakably fits the assigned recurring series instead of sounding like generic canopy copy.";
      continue;
    }
    if (evaluation.rejectionReason === "brand_tag_problem") {
      prompt += "\nRewrite it with the correct brand-tag behavior for this series. Do not force the brand name into the body.";
      continue;
    }
    if (evaluation.rejectionReason === "question_heavy") {
      prompt += "\nRewrite it as a statement, not a question-led post. No rhetorical opener. If you keep a question at all, it must be a single short closer.";
      continue;
    }
    prompt += "\nRewrite it shorter, sharper, and more specific to event-buyer reality.";
  }
  if (bestCandidate && hasConcreteCanopySignal(bestCandidate) && !soundsLikeAd(bestCandidate)) {
    return { text: bestCandidate };
  }
  return { text: null };
}

export interface GenerateCanopyCandidateBatchOptions {
  angle: string;
  date?: string;
  recentTweets?: string[];
  reserveChars?: number;
  iterationGuidance?: string;
  strategy: CanopyStrategyEnvelope;
  count: number;
  persona?: Persona;
  contentTypeId?: ContentTypeId;
  brandMentionAllowed?: boolean;
}

export async function generateCanopyCandidateBatch(
  options: GenerateCanopyCandidateBatchOptions
): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < options.count; i++) {
    const generated = await generatePostAnglesOnly({
      angle: options.angle,
      date: options.date,
      recentTweets: [...(options.recentTweets ?? []), ...results].slice(0, 12),
      reserveChars: options.reserveChars,
      iterationGuidance: options.iterationGuidance,
      strategy: options.strategy,
      candidateDirective: canopyCandidateDirective(i + 1, options.strategy),
      persona: options.persona,
      contentTypeId: options.contentTypeId,
      brandMentionAllowed: options.brandMentionAllowed,
    });
    if (generated.text) results.push(generated.text);
  }
  return [...new Set(results)];
}

function extractJudgeScore(raw: string): number {
  const match = raw.match(/score\s*[:=]\s*(\d{1,3})/i) ?? raw.match(/\b(\d{1,3})\b/);
  const parsed = match ? Number.parseInt(match[1] ?? "0", 10) : 0;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0;
}

export async function judgeCanopyCandidates(
  strategy: CanopyStrategyEnvelope,
  finalists: CanopyRankedCandidate[]
): Promise<Array<{ candidateId: string; judgeScore: number }>> {
  if (!OPENAI_API_KEY || finalists.length === 0) return finalists.map((row) => ({ candidateId: row.candidateId, judgeScore: 0 }));
  const client = createLLMClient();
  const judgeSystem = `You are ranking canopy social post drafts for a bot that must learn from actual X performance. Reward specificity, booth-world realism, screenshot-worthiness, vendor relatability, local/event relevance, and non-commercial tone. Penalize ad copy, slogans, generic motivational endings, vague event-marketing language, and obvious brand-tagging. Reply with only "score: N" where N is 0-100.`;
  const outputs: Array<{ candidateId: string; judgeScore: number }> = [];
  for (const finalist of finalists) {
    try {
      const resp = await client.chat.completions.create({
        model: ACTIVE_LLM_MODEL,
        messages: [
          { role: "system", content: judgeSystem },
          {
            role: "user",
            content: `Strategy envelope: ${strategy.id}\nSeries: ${strategy.seriesId}\nContent bucket: ${strategy.contentBucket}\nCreative direction: ${strategy.creativeDirection}\nVoice family: ${strategy.voiceFamily}\nDraft:\n${finalist.text}`,
          },
        ],
        max_tokens: 12,
        temperature: 0,
      });
      const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
      outputs.push({ candidateId: finalist.candidateId, judgeScore: extractJudgeScore(raw) });
    } catch {
      outputs.push({ candidateId: finalist.candidateId, judgeScore: 0 });
    }
  }
  return outputs;
}
