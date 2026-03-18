/**
 * Canopy campaign regression tests (no network).
 * Verifies canopy strategy selection, prompt assembly, and image variant testing logic.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.CAMPAIGN = "canopy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

const { bootstrap } = await import("../src/bootstrap.js");
bootstrap();

const config = await import("../src/config.js");
const {
  loadContentPillars,
  loadPillarForAngle,
} = await import("../src/contentPillars.js");
const {
  buildCanopyAgentLesson,
  buildCanopyAgentMemory,
  chooseCanopyAgentStrategy,
  chooseCanopyImageDirection,
  chooseCanopyImagePlan,
  formatCanopyAgentReport,
  rankCanopyCandidates,
} = await import("../src/canopyAgent.js");
const {
  buildAnglesOnlyPromptInput,
  getAnglesOnlyContextForDate,
  getAnglesOnlyPostFormatForDate,
  normalizeAnglesOnlyPostForLimit,
} = await import("../src/generatePost.js");
const { buildCampaignImagePromptForAngle } = await import("../src/generateImage.js");

type PillarsFile = {
  pillars: Array<{
    id: string;
    name: string;
    seriesId: string;
    contentBuckets: string[];
    brandTagPolicy?: string;
    postIdeas: string[];
    targetAudiences: string[];
    voiceFamilies?: string[];
    buyerIntentLevels?: string[];
    productFocuses?: string[];
    useCaseVerticals?: string[];
    creativeDirections?: string[];
  }>;
};

type ImageFile = {
  variants: Array<{
    id: string;
    pillarId: string;
    style: "mockup" | "lifestyle";
    shotType: "close_up" | "medium" | "wide";
  }>;
};

const pillarsPath = resolve(WORKSPACE_ROOT, "campaigns", "canopy", "content-pillars.json");
const imagePromptsPath = resolve(WORKSPACE_ROOT, "campaigns", "canopy", "image-prompts.json");
const pillarsFile = JSON.parse(readFileSync(pillarsPath, "utf-8")) as PillarsFile;
const imagePrompts = JSON.parse(readFileSync(imagePromptsPath, "utf-8")) as ImageFile;

let passed = 0;

function ok(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    throw error;
  }
}

function makeSyntheticStore() {
  const now = new Date("2026-03-16T12:00:00Z");
  const tweets = Array.from({ length: 8 }, (_, index) => ({
    runId: `canopy-${index}`,
    tweetId: `tweet-${index}`,
    postedAt: new Date(now.getTime() - index * 86_400_000).toISOString(),
    dateContext: "2026-03-16",
    sport: "canopy",
    angle: index < 5 ? "Booth Identity and Setup Taste" : "Utah Event Radar",
    source: "llm",
    status: "posted" as const,
    text: `Sample canopy post ${index}`,
    metrics: {
      platform: "x" as const,
      fetchedAt: now.toISOString(),
      likeCount: 0,
      replyCount: 0,
      retweetCount: 0,
      quoteCount: 0,
      bookmarkCount: 0,
      shareCount: 0,
      impressionCount: index < 5 ? 20 + index * 4 : 4 + index,
      engagementCount: index < 5 ? 1 : 0,
      engagementRate: null,
    },
    score: index < 5 ? 60 + index * 8 : 8 + index,
    hasImage: index < 5,
    seriesId: index < 5 ? "booth_identity" : "utah_event_radar",
    contentBucket: index < 5 ? "culture" : "education",
    brandTagIncluded: index % 2 === 0,
    voiceFamily: index < 5 ? "buyer_intent_detail" : "observational_thought_leadership",
    buyerIntentLevel: index < 5 ? "purchase_intent" : "awareness",
    useCaseVertical: index < 5 ? "trade shows" : "community events",
    productFocus: index < 5 ? "custom canopies" : "replacement canopies",
    urgencyMode: index < 5 ? "rush_order" : "seasonal",
    ctaMode: index < 5 ? "soft_commercial" : "none",
    creativeDirection: index < 5 ? "customer_showcase" : "seasonal_urgency",
    imageConceptId: index < 5 ? "buyer-canopy-tradeshow-wide" : "speed-rush-packout-medium",
    imageStyleFamily: index < 5 ? "lifestyle" : "mockup",
    imageShotType: index < 5 ? "wide" : "medium",
    openingPattern: index < 4 ? "most_teams" : "scene_setter",
    campaignStrategyId: index < 5 ? "buyer_intent_products" : "speed_and_deadlines",
  }));
  return {
    version: 1,
    updatedAt: now.toISOString(),
    tweets,
    analyticsHealth: {},
  };
}

console.log("--- canopy bootstrap/config ---");
ok("campaign bootstrap selects angles_only", () => {
  assert.equal(process.env.DATA_SOURCE, "angles_only");
  assert.equal(config.DATA_SOURCE, "angles_only");
});
ok("campaign bootstrap applies canopy brand", () => {
  assert.equal(config.BRAND_NAME, "Vicious Shade Supply Co.");
  assert.equal(config.BRAND_WEBSITE, "viciousshade.com");
  assert.equal(config.CLICK_TARGET_URL, "https://www.viciousshade.com");
});

console.log("\n--- canopy pillars/angles ---");
const expectedAngles = pillarsFile.pillars.map((pillar) => pillar.name);
ok("angles load from content-pillars.json in file order", () => {
  assert.deepEqual(config.getAnglesOnlyAngles(), expectedAngles);
});
ok("content pillars use the new compressed commercial-intent set", () => {
  assert.equal(expectedAngles.length, 5);
  assert.deepEqual(
    pillarsFile.pillars.map((pillar) => pillar.id),
    [
      "buyer_intent_products",
      "use_case_moments",
      "speed_and_deadlines",
      "durability_and_product_proof",
      "competitive_value_framing",
    ]
  );
  assert.deepEqual(
    pillarsFile.pillars.map((pillar) => pillar.seriesId),
    [
      "booth_identity",
      "vendor_life",
      "utah_event_radar",
      "proof_in_the_wild",
      "booth_hot_take",
    ]
  );
});
ok("each pillar exposes strategy metadata for optimizer use", () => {
  const loaded = loadContentPillars();
  assert.ok(loaded);
  for (const pillar of loaded ?? []) {
    assert.ok(pillar.seriesId.length > 0);
    assert.ok((pillar.contentBuckets?.length ?? 0) > 0);
    assert.ok((pillar.voiceFamilies?.length ?? 0) > 0);
    assert.ok((pillar.buyerIntentLevels?.length ?? 0) > 0);
    assert.ok((pillar.productFocuses?.length ?? 0) > 0);
    assert.ok((pillar.useCaseVerticals?.length ?? 0) > 0);
    assert.ok((pillar.creativeDirections?.length ?? 0) > 0);
  }
});
ok("each pillar returns post ideas and a rotated target audience", () => {
  const sampleDate = new Date("2026-03-09T12:00:00Z");
  for (const pillar of pillarsFile.pillars) {
    const loaded = loadPillarForAngle(pillar.name, sampleDate);
    assert.ok(loaded, `missing pillar ${pillar.name}`);
    assert.ok(loaded!.postIdeas.length >= 2 && loaded!.postIdeas.length <= 3);
    assert.deepEqual(loaded!.postIdeas, pillar.postIdeas.slice(0, 3));
    assert.ok(pillar.targetAudiences.includes(loaded!.targetAudience));
  }
});

console.log("\n--- canopy optimizer ---");
const syntheticStore = makeSyntheticStore();
const memory = buildCanopyAgentMemory(syntheticStore, new Date("2026-03-16T12:00:00Z"));
const strategy = chooseCanopyAgentStrategy(syntheticStore, new Date("2026-03-16T12:00:00Z"));
const buyerIntentStrategy = {
  ...strategy,
  angle: "Booth Identity and Setup Taste",
  pillarId: "buyer_intent_products",
  seriesId: "booth_identity" as const,
  contentBucket: "culture" as const,
  brandTagPolicy: "optional" as const,
  voiceFamily: "buyer_intent_detail" as const,
  buyerIntentLevel: "consideration" as const,
  useCaseVertical: "trade shows",
  productFocus: "custom canopies",
  urgencyMode: "seasonal" as const,
  ctaMode: "soft_commercial" as const,
  creativeDirection: "social_proof",
  contextHint: "Lead with setup identity and first impressions instead of shopping language.",
  selectionReason: "setup identity posts are currently outperforming peers",
};
ok("agent memory summarizes canopy winners from posted X analytics only", () => {
  assert.equal(memory.optimizerVersion, "canopy_agent_v2");
  assert.equal(memory.performanceWindowLabel, "last_45_days");
  assert.equal(memory.totalPostsConsidered, 8);
  assert.ok(memory.averageHybridScore > 0);
  assert.equal(memory.dimensions.pillar[0]?.value, "buyer_intent_products");
  assert.equal(memory.dimensions.seriesId[0]?.value, "booth_identity");
  assert.equal(memory.dimensions.contentBucket[0]?.value, "culture");
  assert.equal(memory.dimensions.voiceFamily[0]?.value, "buyer_intent_detail");
  assert.ok(memory.winnerClusters.length > 0);
});
ok("agent chooses a valid canopy strategy with real-X reasoning metadata", () => {
  assert.ok(pillarsFile.pillars.some((pillar) => pillar.id === strategy.pillarId));
  assert.ok(["vendor_life", "booth_hot_take", "booth_identity", "proof_in_the_wild", "utah_event_radar"].includes(strategy.seriesId));
  assert.ok(["culture", "education", "community", "promo"].includes(strategy.contentBucket));
  assert.ok(["buyer_intent_detail", "deadline_urgency", "soft_commercial", "observational_thought_leadership", "contrarian_take", "micro_story"].includes(strategy.voiceFamily));
  assert.ok(["awareness", "consideration", "purchase_intent"].includes(strategy.buyerIntentLevel));
  assert.ok(strategy.productFocus.length > 0);
  assert.ok(strategy.creativeDirection.length > 0);
  assert.equal(strategy.optimizerVersion, "canopy_agent_v2");
  assert.ok(["exploit", "explore"].includes(strategy.agentMode));
  assert.match(strategy.id, /buyer_intent_products|speed_and_deadlines|durability_and_product_proof|use_case_moments|competitive_value_framing/);
  assert.match(strategy.selectionReason, /outperforming|exploration|Top canopy pillar|content is due/i);
  assert.match(strategy.agentReasoningSummary, /agent mode/i);
});
ok("agent lesson summarizes winners, weak patterns, and exploration targets", () => {
  const guidance = buildCanopyAgentLesson(memory);
  assert.ok(guidance);
  assert.match(guidance, /Top canopy pillar on X lately: buyer_intent_products/i);
  assert.match(guidance, /Best voice family: buyer_intent_detail/i);
  assert.match(guidance, /Weak opening patterns:/i);
});
ok("agent report exposes what it believes is working and what it is testing", () => {
  const report = formatCanopyAgentReport(memory);
  assert.match(report, /Launch pacing/i);
  assert.match(report, /What the agent believes is working/i);
  assert.match(report, /What the agent is avoiding/i);
  assert.match(report, /What the agent is testing next/i);
});

console.log("\n--- canopy prompt assembly ---");
const promptDate = "2026-03-09";
const promptInput = buildAnglesOnlyPromptInput({
  angle: buyerIntentStrategy.angle,
  date: promptDate,
  recentTweets: ["Most booths are invisible because they stay flat."],
  reserveChars: 25,
  strategy: buyerIntentStrategy,
  iterationGuidance: "Recent canopy winners are clustered around the Buyer-Intent Products pillar.",
});
ok("angles_only prompt includes canopy strategy and iteration guidance", () => {
  assert.match(promptInput.system, /Allowed voice families/i);
  assert.equal(promptInput.context, getAnglesOnlyContextForDate(new Date("2026-03-09T12:00:00Z")));
  assert.equal(promptInput.format, getAnglesOnlyPostFormatForDate(new Date("2026-03-09T12:00:00Z")));
  assert.match(promptInput.userMessage, /Campaign optimizer picked this strategy:/);
  assert.match(promptInput.userMessage, /Series: booth identity/i);
  assert.match(promptInput.userMessage, /Content bucket: culture/i);
  assert.match(promptInput.userMessage, /Voice family: buyer intent detail/i);
  assert.match(promptInput.userMessage, /Buyer intent level: consideration/i);
  assert.match(promptInput.userMessage, /Creative direction: social proof/i);
  assert.match(promptInput.userMessage, /Brand tag policy: optional/i);
  assert.match(promptInput.userMessage, /Iteration guidance from analytics:/);
  assert.match(promptInput.userMessage, /Do NOT repeat or closely mimic these recent posts:/);
});
ok("angles_only prompt includes the canopy customer profile block", () => {
  assert.match(promptInput.userMessage, /Ideal customer profile for this campaign:/i);
  assert.match(promptInput.userMessage, /Primary decision makers: marketing manager, marketing director, event coordinator/i);
  assert.match(promptInput.userMessage, /Most relevant buyer segments: Promotional and marketing teams: tech startups, real estate agencies, car dealerships/i);
  assert.match(promptInput.userMessage, /Company sizes in play: small businesses \(1-20 employees\), growing SMBs \(20-200 employees\), enterprise and national brands \(200\+ employees\)/i);
  assert.match(promptInput.userMessage, /What they care about: brand visibility, standing out at crowded events, professional appearance, easy setup/i);
  assert.match(promptInput.userMessage, /High-intent triggers: upcoming trade shows, farmers market season, sports tournaments, grand openings/i);
});
ok("golden buyer-intent prompt contains commercial canopy context", () => {
  assert.match(promptInput.userMessage, /Use-case vertical: trade shows/i);
  assert.match(promptInput.userMessage, /Product focus: custom canopies/i);
  assert.match(promptInput.userMessage, /rush order|seasonal|replacement/i);
});
ok("golden thought-leadership prompt can still be built from another voice family", () => {
  const altPrompt = buildAnglesOnlyPromptInput({
    angle: "Vendor Life and Event Culture",
    date: promptDate,
    strategy: {
      ...buyerIntentStrategy,
      angle: "Vendor Life and Event Culture",
      pillarId: "use_case_moments",
      voiceFamily: "observational_thought_leadership",
      buyerIntentLevel: "awareness",
      useCaseVertical: "farmers markets",
      productFocus: "event banners",
      urgencyMode: "none",
      ctaMode: "none",
      creativeDirection: "educational_breakdown",
      contextHint: "Make it feel like a lived-in field observation.",
      selectionReason: "manual test strategy",
    },
  });
  assert.match(altPrompt.userMessage, /Voice family: observational thought leadership/i);
  assert.match(altPrompt.userMessage, /Use-case vertical: farmers markets/i);
  assert.match(altPrompt.userMessage, /Creative direction: educational breakdown/i);
  assert.match(altPrompt.userMessage, /Most relevant buyer segments: Event-driven businesses: food and beverage brands, beverage distributors, farmers market vendors/i);
});
ok("angles_only normalization keeps branded posts within limit", () => {
  const long = "Rush orders usually mean somebody waited too long or somebody's old tent embarrassed the brand at the last event. Either way, visibility and lead time suddenly become the whole conversation on a Wednesday afternoon.";
  const normalized = normalizeAnglesOnlyPostForLimit(long, 280, "TENSION");
  assert.ok(normalized.length <= 280);
  assert.match(normalized, /Vicious Shade Supply Co\./);
  assert.match(normalized, /viciousshade\.com/);
});

console.log("\n--- canopy candidate ranking ---");
ok("candidate ranking prefers concrete booth-world drafts over slogan-y copy", () => {
  const ranked = rankCanopyCandidates(
    [
      "Stand out at your next event with a custom canopy that grabs attention and makes an impact.",
      "Trade show aisle, 2pm: the wind hits the valance and the cheap frame starts walking. Ours stays square, logo visible from the parking lot.",
      "Your booth deserves better branding for every event this spring.",
    ],
    buyerIntentStrategy
  );
  assert.equal(ranked[0]?.text, "Trade show aisle, 2pm: the wind hits the valance and the cheap frame starts walking. Ours stays square, logo visible from the parking lot.");
  assert.ok(ranked[0]!.totalScore > ranked[1]!.totalScore);
});

console.log("\n--- canopy image variants ---");
ok("image prompt file includes broad A/B coverage across styles and shot types", () => {
  assert.ok(imagePrompts.variants.length >= 12);
  assert.ok(imagePrompts.variants.some((variant) => variant.style === "mockup"));
  assert.ok(imagePrompts.variants.some((variant) => variant.style === "lifestyle"));
  assert.ok(imagePrompts.variants.some((variant) => variant.shotType === "close_up"));
  assert.ok(imagePrompts.variants.some((variant) => variant.shotType === "medium"));
  assert.ok(imagePrompts.variants.some((variant) => variant.shotType === "wide"));
});
ok("each pillar has multiple image variants", () => {
  for (const pillar of pillarsFile.pillars) {
    const count = imagePrompts.variants.filter((variant) => variant.pillarId === pillar.id).length;
    assert.ok(count >= 3, `expected >=3 variants for ${pillar.id}, got ${count}`);
  }
});
ok("preferred mockup variant can be selected explicitly", () => {
  const details = buildCampaignImagePromptForAngle("Booth Identity and Setup Taste", {
    pillarId: "buyer_intent_products",
    preferredVariantId: "buyer-flags-product-close",
  });
  assert.ok(details);
  assert.equal(details!.variantId, "buyer-flags-product-close");
  assert.equal(details!.style, "mockup");
  assert.equal(details!.shotType, "close_up");
});
ok("preferred lifestyle variant can be selected explicitly", () => {
  const details = buildCampaignImagePromptForAngle("Vendor Life and Event Culture", {
    pillarId: "use_case_moments",
    preferredVariantId: "usecase-foodtruck-wide",
  });
  assert.ok(details);
  assert.equal(details!.variantId, "usecase-foodtruck-wide");
  assert.equal(details!.style, "lifestyle");
  assert.equal(details!.shotType, "wide");
});
ok("automatic image selection can reflect winning image families", () => {
  const details = chooseCanopyImageDirection(
    syntheticStore,
    buyerIntentStrategy,
    new Date("2026-03-16T12:00:00Z")
  );
  assert.ok(details);
  assert.equal(details!.pillarId, "buyer_intent_products");
  assert.equal(details!.style, "lifestyle");
  assert.equal(details!.shotType, "wide");
  assert.match(details!.selectionReason, /outperforming|exploration|preferred|highest/i);
});
ok("launch image plan keeps utah-event posts text-first before event-feed automation", () => {
  const plan = chooseCanopyImagePlan(syntheticStore, {
    ...buyerIntentStrategy,
    angle: "Utah Event Radar",
    pillarId: "speed_and_deadlines",
    seriesId: "utah_event_radar",
    contentBucket: "education",
    brandTagPolicy: "none",
    voiceFamily: "observational_thought_leadership",
    creativeDirection: "seasonal_urgency",
    buyerIntentLevel: "awareness",
    productFocus: "replacement canopies",
    useCaseVertical: "community events",
    urgencyMode: "seasonal",
    ctaMode: "none",
  }, new Date("2026-03-16T12:00:00Z"));
  assert.equal(plan.enabled, false);
  assert.match(plan.reason, /text-only|event feed/i);
});
ok("launch image plan keeps booth-identity visuals enabled", () => {
  const plan = chooseCanopyImagePlan(syntheticStore, buyerIntentStrategy, new Date("2026-03-16T12:00:00Z"));
  assert.equal(plan.enabled, true);
});

console.log(`\n${passed} canopy checks passed`);
