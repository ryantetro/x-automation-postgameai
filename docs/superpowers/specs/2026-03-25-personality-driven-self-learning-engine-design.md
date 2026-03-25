# Personality-Driven Self-Learning Social Engine

**Date:** 2026-03-25
**Status:** Draft
**Campaigns:** All (Canopy, Postgame, future campaigns)

## Problem

The bot engine produces posts that read like ad copy despite explicit anti-ad-copy guardrails. Across 25 Canopy posts: 134 total impressions, 0 likes, 0 engagements. The content lacks real personality, the learning loop has no signal to learn from, and every post follows the same format.

The PLAYBOOK.md test: "Would a vendor follow this account even if they were not buying this month?" — current answer is no.

## Goals

1. Posts that feel like they come from a real person with a specific point of view
2. Content that earns follows through value, humor, and community — not product pitches
3. A system that genuinely learns what works and shifts strategy accordingly
4. 80% of posts have zero brand mention; 20% max have soft brand presence
5. Generic system that works across all campaigns without campaign-specific code

## Non-Goals

- Competitive intelligence / scraping other accounts
- Engagement automation (replying, liking, following)
- Image generation changes
- Dashboard/web app changes

---

## System 1: Persona Archetypes

### Concept

Each campaign defines 3-5 distinct persona archetypes. Each persona has a unique voice, content territory, and brand mention policy. The generation system selects a persona for each post, composing the system prompt dynamically from: base campaign voice + persona overlay.

This layers on top of the existing strategy selection system (canopyAgent explore/exploit, content architecture frames/hooks). Personas are a higher-level abstraction: each persona maps to a subset of the existing dimensions (voiceFamily, contentBucket, seriesId). The existing dimension-level intelligence is preserved.

### Campaign Directory Resolution

Personas live in `campaigns/<slug>/personas.json`. The path is resolved using the existing `CAMPAIGNS_DIR` constant from `src/config.ts`, which resolves to `../../campaigns` relative to the engine's `src/` directory (or the `CAMPAIGNS_DIR` env var if set). The existing pattern in `contentPillars.ts` line 87 (`resolve(CAMPAIGNS_DIR, slug, "content-pillars.json")`) is the reference implementation.

### Schema: `campaigns/<slug>/personas.json`

```json
{
  "personas": [
    {
      "id": "booth_critic",
      "name": "The Booth Critic",
      "weight": 0.25,
      "brandMentionPolicy": "never",
      "contentTerritory": [
        "booth setup opinions",
        "what looks cheap vs intentional",
        "event aisle observations",
        "setup taste commentary"
      ],
      "voiceTraits": {
        "humor": "dry, observational",
        "sentenceStyle": "short declarative, sometimes fragments",
        "tone": "opinionated but not mean",
        "perspective": "someone who has walked thousands of vendor rows"
      },
      "contentTypes": ["hot_take", "observation"],
      "dimensionMapping": {
        "voiceFamilies": ["contrarian_take", "observational_thought_leadership"],
        "contentBuckets": ["culture"],
        "seriesIds": ["booth_hot_take", "booth_identity"]
      },
      "platformLengthHint": {
        "x": "observation, hot_take only (280 char budget)",
        "threads": "all types including micro_story (500 char budget)"
      },
      "examplePosts": [
        "Walked an entire market row Saturday. Counted eleven white tents with zero signage. That is not a booth. That is a placeholder.",
        "The difference between a booth that gets stopped at and one that gets walked past is usually about forty dollars of intention.",
        "Controversial opinion: your tent frame matters more than your graphics. A crooked frame with great art just looks like a crooked frame."
      ],
      "antiPatterns": [
        "never mention product specs",
        "never suggest buying anything",
        "never use 'stand out' or 'make an impact'"
      ]
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for the persona |
| `name` | string | yes | Human-readable name |
| `weight` | number | yes | Selection probability (0-1). All weights must sum to 1.0 (validated at load time with warning if not). Learning loop adjusts these. |
| `brandMentionPolicy` | `"never"` \| `"sometimes"` | yes | `never` = pure personality post. `sometimes` = brand tag at end if it fits naturally. The `"always"` value was removed since no persona needs forced brand mention and it conflicts with the 80/20 goal. |
| `contentTerritory` | string[] | yes | What this persona talks about. Used in prompt composition. |
| `voiceTraits` | object | yes | Specific writing style guidance injected into the system prompt. |
| `voiceTraits.humor` | string | yes | Type of humor or lack thereof. |
| `voiceTraits.sentenceStyle` | string | yes | How sentences are structured. |
| `voiceTraits.tone` | string | yes | Overall emotional register. |
| `voiceTraits.perspective` | string | yes | Who this person is / where they're coming from. |
| `contentTypes` | string[] | yes | Which content type formats this persona uses. Must only reference types that are valid for the target platform (see platform length constraints in System 3). Validated at load time. |
| `dimensionMapping` | object | no | Maps this persona to existing canopyAgent dimensions (voiceFamilies, contentBuckets, seriesIds). When present, persona selection constrains the existing strategy envelope to these dimensions. |
| `platformLengthHint` | object | no | Advisory note on which content types fit which platform's character limit. Not enforced here — enforced at content type selection. |
| `examplePosts` | string[] | yes | 3-10 gold-standard posts that nail this persona's voice. The LLM studies these for rhythm and style, not exact words. |
| `antiPatterns` | string[] | yes | Specific things this persona must never do. |

### Persona Loading Validation

When `personas.json` is loaded:
1. Verify all weights sum to 1.0. If not, log a warning and normalize.
2. Verify all `contentTypes` are valid type IDs from System 3.
3. Verify `contentTypes` respect platform constraints: if target platform is `x` (280 chars), content types like `micro_story` (3-4 sentences) must not appear without a Threads-only qualifier. If a persona only has platform-incompatible types for the current target, fall back to `observation`.
4. Verify at least 3 `examplePosts` per persona.

### Persona Selection Logic (`src/personaEngine.ts`)

```
function selectPersona(personas, recentHistory, lesson):
    1. Read current weights from personas.json
    2. If lesson exists and has weight adjustments, apply them (capped: no persona > 0.40, no persona < 0.05)
    3. Normalize weights to sum to 1.0
    4. Weighted random selection
    5. Return selected persona
```

Note: The persona cooldown from the original design was removed. With 5 personas and weighted random, natural variety is sufficient. The existing `openingPattern` tracking in contentHeuristics.ts already prevents repetitive openers.

### Prompt Composition

The system prompt for generation becomes:

```
[Base campaign system_prompt.txt — brand identity, non-negotiables]

--- ACTIVE PERSONA ---
You are posting as: {persona.name}
{persona.voiceTraits — formatted as voice guidance}

Content territory for this post: {selected content territory item}

Study these example posts for rhythm and voice (do not copy them):
{persona.examplePosts}

Rules for this persona:
{persona.antiPatterns}

Brand mention: {persona.brandMentionPolicy explanation}
```

The user message template is adapted based on the selected content type (see System 3).

### Initial Persona Definitions

#### Canopy (Vicious Shade) — `dataSource: "angles_only"` path

1. **The Booth Critic** (weight: 0.25, brand: never) — Setup opinions, dry humor, vendor row observations. Maps to: contrarian_take + booth_hot_take.
2. **The Vendor Friend** (weight: 0.25, brand: never) — Relatable vendor life, load-in chaos, market mornings. Maps to: micro_story + vendor_life.
3. **The Event Insider** (weight: 0.20, brand: never) — Utah local event intel, what's coming up, community useful. Maps to: observational_thought_leadership + utah_event_radar.
4. **The Setup Nerd** (weight: 0.15, brand: sometimes) — Craft appreciation, frame quality, fabric details. This is where soft brand lives. Maps to: buyer_intent_detail + proof_in_the_wild.
5. **The Hot Take Machine** (weight: 0.15, brand: never) — Controversial booth/event opinions designed to drive replies. Maps to: contrarian_take + booth_hot_take.

#### Postgame AI — `dataSource: "sports"` path

Postgame uses the sports data path in `generatePost.ts` which includes news fetching, content architecture (frames, hooks, emotions), and sports context. Personas layer ON TOP of this existing system. The persona overlays the system prompt while the content architecture (frame, hook, emotion target) continues to drive the user message template.

1. **The Film Room Realist** (weight: 0.25, brand: never) — Blunt coaching truths. Best with frames: `film_room_truth`, `development_gap`.
2. **The Sideline Observer** (weight: 0.25, brand: never) — Game moments that reveal coaching gaps. Best with frames: `forty_eight_hour_window`, `moment_nobody_captures`.
3. **The Staff Chat Leaker** (weight: 0.20, brand: never) — "What coaches text each other after games." Best with frames: `conversation_that_doesnt_happen`, `scoreboard_lie`.
4. **The Development Skeptic** (weight: 0.15, brand: sometimes) — Challenges conventional wisdom. Works with any frame.
5. **The Friday Night Narrator** (weight: 0.15, brand: never) — Atmospheric, game-day storytelling. Best with hooks: `scene_setter`, `named_moment`.

For Postgame, persona selection happens BEFORE content architecture selection. The persona's preferred frames/hooks are weighted higher in `selectContentDecision()` but do not override it — the existing news-matching and frame rotation logic remains active.

---

## System 2: Self-Learning Loop

### Concept

Build a learning system on top of the **existing analytics store** (`state/<slug>/tweet-analytics.json`). No new storage layer. The existing store already tracks every post with metadata and engagement metrics. The learning loop reads from it, generates lessons, and adjusts persona weights.

This replaces the approach of adding a separate ruflo memory store, which would create a dual source of truth with the existing analytics JSON. Instead, we add new fields to the existing `TweetAnalyticsRecord` type and build lesson generation as a pure function over the existing data.

### New Fields on `TweetAnalyticsRecord` (in `src/analytics.ts`)

```typescript
// Added to existing TweetAnalyticsRecord interface:
personaId?: string;         // Which persona generated this post
contentType?: string;       // observation, hot_take, micro_story, etc.
brandMentioned?: boolean;   // Whether brand was included in final post
lessonVersion?: string;     // Which lesson was active when this was generated
```

### Data Flow

```
[Post Generated] --> [Store in existing analytics with new persona/contentType fields]
        |
        v
[Analytics Pull (cron)] --> [Metrics updated in existing store as-is]
        |
        v
[Pre-Generation: generateLesson()] --> [Read store, compute patterns, output lesson text + weight adjustments]
        |
        v
[Lesson injected into generation prompt] --> [Persona weights adjusted in-memory for this run]
```

### Lesson Generation (`src/learningLoop.ts`)

Before each generation run:

```
function generateLesson(campaignSlug, analyticsStore):
    1. Filter store.tweets: status === "posted", sport === campaignSlug, has metrics with impressionCount
    2. Keep only posts from last 45 days
    3. Sort by hybridScore using the CANONICAL formula (see below)
    4. If fewer than 10 posts with metrics: return cold-start lesson (see Cold Start)
    5. Identify patterns:
       a. Top 5 posts: what persona, content type, brand mention?
       b. Bottom 5 posts: same breakdown
       c. Per-persona average hybridScore
       d. Per-content-type average hybridScore
       e. Brand-mention vs no-brand-mention average hybridScore
    6. Generate lesson text (structured, NOT LLM-generated):
       "LESSON FROM LAST 45 DAYS:
        - Best performing persona: {name} (avg score: X, N posts)
        - Worst performing persona: {name} (avg score: X, N posts)
        - Best content type: {type} (avg score: X)
        - Posts without brand mention averaged {X}x more engagement
        - Top post: '{text truncated to 100 chars}' (score: X, persona: Y)
        - Avoid: posts similar to '{worst text truncated}' (score: X)

        WEIGHT ADJUSTMENTS:
        - Increase {persona} from {old}% to {new}%
        - Decrease {persona} from {old}% to {new}%"
    7. Return lesson text for prompt injection + weight adjustment map
```

### Canonical Hybrid Score Formula

There are currently two scoring formulas in the codebase:
- `canopyAgent.ts:144`: `impressions + likes*8 + replies*16 + reposts*14 + quotes*12 + bookmarks*10`
- `analytics.ts:371` (`computeScore`): `impressions + likes*20 + replies*30 + retweets*25 + bookmarks*15 + quotes*20`

The canonical formula for the learning loop is the **canopyAgent formula** (the one with lower engagement multipliers), since it weights impressions more heavily relative to engagement — appropriate for an account in growth phase where impressions are the primary signal. Both formulas should eventually be unified, but that's out of scope for this spec.

### Weight Adjustment Rules

- Computed during lesson generation, NOT written back to `personas.json`. Weights in `personas.json` are the defaults. Adjustments are applied in-memory at runtime.
- This eliminates the race condition risk of two concurrent runs writing to the same file.
- Adjustment magnitude: proportional to score difference, capped at +/- 0.05 per lesson cycle.
- Floor: no persona below 0.05 weight. Ceiling: no persona above 0.40 weight.
- Minimum sample size: a persona needs at least 3 posts with metrics to receive a weight adjustment. Otherwise, held at default.
- Adjustment frequency: once per generation run. Since the bot runs 1-2x/day per campaign, this means weight drift is slow (max 0.05/day).
- The lesson text and applied weights are recorded in the generation log for every run.

### Cold Start (No Data Yet)

When a campaign has fewer than 10 posts with metrics:
- Use default weights from personas.json
- Inject a cold-start lesson: "Not enough data yet. Focus on variety and testing all personas equally. Prioritize posts that would earn a follow even with zero product mention."
- After 10+ posts with metrics, switch to data-driven lessons

---

## System 3: Content Type Diversification

### Concept

Move beyond the single "2 sentences + brand tag" format. Define content type templates that each produce different post structures. Personas have affinity for certain types.

### Content Types

| Type | Format | Max Length | Platform | When to Use |
|------|--------|------------|----------|-------------|
| `observation` | 1-2 sentences. Declarative. No question. | 280 | x, threads | Default. Sharp insight or recognition moment. |
| `hot_take` | "Hot take:" or strong opinion lead. 1-2 sentences. | 280 | x, threads | When persona is opinionated and content is debatable. |
| `micro_story` | 3-4 sentences. Scene-setting, specific moment, punchline. | 500 | threads only | When persona has a story to tell. NOT used for X single posts. |
| `community_question` | 1 sentence observation + genuine question. | 280 | x, threads | Engagement-driving. Max 1 in 5 posts (enforced by contentMixer). |
| `list_post` | "Two kinds of..." or short comparison. 2-3 bullet-style lines. | 280 | x, threads | When comparing or categorizing. Keep each line very short for X. |

**Removed from original design:**
- `react_quote` — removed because it implies reacting to external content but scraping/finding that content is a non-goal. Would produce fabricated quotes.
- `thread` — already has its own code path via `generateThread()` gated on `isThreadDay()`. Thread content type selection should stay in the existing thread logic, not be mixed into single-post persona selection.

### Content Type Selection

```
function selectContentType(persona, targetPlatform, recentHistory, lesson):
    1. Get persona's allowed content types
    2. Filter by platform compatibility:
       - If targetPlatform includes "x" only: exclude "micro_story"
       - If targetPlatform includes "threads" only: all types allowed
       - If dual-platform: use X-compatible types (since X is the stricter constraint)
    3. Check recent history: avoid repeating the same type 3x in a row
    4. If lesson recommends a specific type, weight it 2x
    5. Enforce community_question cap: if 1 of last 5 posts was community_question, exclude it
    6. Weighted random from remaining types (equal weight by default)
    7. Return selected type
```

### User Message Templates Per Type

Each content type has its own user message template. These are shorter and more focused than the current monolithic template. The key structural change: brand mention instructions appear ONLY when the content mixer allows it (see System 4).

Templates live as string constants in a new file `src/contentTypeTemplates.ts` (not in `generatePost.ts` which is already over the 500-line limit).

---

## System 4: 80/20 Content Mix Enforcement

### Concept

Hard enforcement that 80% of posts have zero brand mention.

### Implementation

In `src/contentMixer.ts`:

```
function enforceBrandMix(selectedPersona, recentPostedTweets):
    1. Filter recentPostedTweets to last 10 with status === "posted" (excludes dry_run)
    2. Count posts where brandMentioned === true (new field) or brandTagIncluded === true (existing field)
    3. If >= 2 out of last 10 had brand mention:
       - Force brandMentionAllowed = false for this post regardless of persona policy
    4. If < 2 out of last 10:
       - Use persona's brandMentionPolicy:
         - "never" -> brandMentionAllowed = false
         - "sometimes" -> brandMentionAllowed = true (50% chance, weighted random)
    5. Return { brandMentionAllowed: boolean }
```

### Fallback Post Handling

The existing fallback templates in `generatePost.ts` (used when all LLM retries fail) contain brand mentions. Under the new system:
- Fallback posts count against the 80/20 ratio
- If brandMentionAllowed is false for this run but the only available text is a fallback with brand mention: strip the brand suffix before posting
- The brand suffix pattern `— {BRAND_NAME} · {BRAND_WEBSITE}` is already a consistent format, making it safe to strip via string replacement

---

## File Changes Summary

### New Files

| File | Purpose | Lines (est.) |
|------|---------|-------------|
| `campaigns/canopy/personas.json` | Canopy persona definitions | ~150 |
| `campaigns/postgame/personas.json` | Postgame persona definitions | ~150 |
| `src/personaEngine.ts` | Persona loading/validation, selection, prompt composition | ~200 |
| `src/learningLoop.ts` | Lesson generation from analytics store, weight computation | ~250 |
| `src/contentMixer.ts` | Content type selection, 80/20 brand mix enforcement | ~150 |
| `src/contentTypeTemplates.ts` | Per-content-type user message templates | ~200 |

### Modified Files

| File | Changes |
|------|---------|
| `src/generatePost.ts` | Import persona + content type. Use composed system prompt from personaEngine. Use content-type-specific user message template. Keep existing retry/validation logic. Extract `angles_only` path to reduce file size. |
| `src/main.ts` | Pre-generation: call learningLoop.generateLesson(). Call personaEngine.selectPersona(). Call contentMixer.selectContentType() + enforceBrandMix(). Pass persona/contentType/brandAllowed to generatePost. Post-generation: record personaId, contentType, brandMentioned on the analytics record. |
| `src/canopyAgent.ts` | NOT replaced. Persona selection constrains the strategy envelope via dimensionMapping. The existing explore/exploit, dimension scoring, candidate ranking, and judge pass remain. Persona is an input that narrows the envelope, not a replacement for it. |
| `src/analytics.ts` | Add `personaId`, `contentType`, `brandMentioned`, `lessonVersion` fields to `TweetAnalyticsRecord`. No other changes — existing scoring and refresh logic stays. |
| `campaigns/schema.json` | Add optional `personasFile` field (default: `personas.json` in campaign dir). |

### Unchanged Files

| File | Why |
|------|-----|
| `src/postToX.ts` | Posting mechanics don't change |
| `src/postToThreads.ts` | Same |
| `src/generateImage.ts` | Image generation is separate concern |
| `src/fetchData.ts` | Data fetching is separate concern |
| `src/fetchNews.ts` | News fetching is separate concern |
| `src/contentHeuristics.ts` | Pre-publish checks still apply |
| `src/config.ts` | Config loading doesn't change significantly |
| `src/contentArchitecture.ts` | Frame/hook system preserved, not replaced |
| `src/contentPillars.ts` | Pillars preserved, personas layer on top |

---

## generatePost.ts Decomposition

`generatePost.ts` is currently 1,453 lines (3x the 500-line project limit). As part of Phase 1, it must be split:

| New file | What moves there | Est. lines |
|----------|-----------------|------------|
| `src/generatePost.ts` | Core generation logic: LLM call, retry loop, validation. Shared by both paths. | ~400 |
| `src/generateAnglesOnly.ts` | The `angles_only` / Canopy path: `generatePostAnglesOnly()`, `generateCanopyCandidateBatch()`, `judgeCanopyCandidates()`, candidate ranking. | ~500 |
| `src/generateSportsPost.ts` | The sports data path: `generatePost()` with news context, content architecture integration. | ~400 |
| `src/contentTypeTemplates.ts` | Per-content-type user message templates (new). | ~200 |

Imports are updated in `main.ts` and other consumers. The split is mechanical — no logic changes, just file boundaries.

---

## Migration Path

### Phase 1: Personas + Content Types (biggest impact, no learning yet)
1. Create `personas.json` for both campaigns
2. Create `personaEngine.ts`, `contentMixer.ts`, `contentTypeTemplates.ts`
3. Split `generatePost.ts` into 3 files
4. Wire persona selection and content type into main.ts generation flow
5. Add personaId, contentType, brandMentioned fields to analytics records
6. Test with dry-run for both campaigns

**Phase 1 alone fixes the core problem:** posts will have distinct voices, 80% will have no brand mention, and content format will vary.

### Phase 2: Self-Learning Loop
1. Create `learningLoop.ts`
2. Wire lesson generation into pre-generation flow in main.ts
3. Inject lesson text into system prompt
4. Apply in-memory weight adjustments
5. Record lesson in generation log

### Phase 3: Campaign Agent Generalization
1. Add `dimensionMapping` to persona definitions
2. Modify `canopyAgent.ts` to accept persona as a constraint on strategy envelope selection
3. Verify explore/exploit works correctly with persona-narrowed dimensions
4. Test with Postgame to verify the sports path + persona overlay works

Each phase is independently valuable and deployable.

---

## Success Criteria

- Posts from "never brand" personas should be indistinguishable from a real person's account
- Engagement rate > 0% within 2 weeks of deployment (current: 0%)
- At least 3 distinct "voices" visible in the post history
- Learning loop generates actionable lessons after 10+ posts with metrics
- No post in the 80% pure-personality bucket mentions the brand name or website
- A real vendor/coach should want to follow the account even without buying intent
- `generatePost.ts` is split and no source file exceeds 500 lines

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| LLM still produces ad copy despite persona instructions | Stronger example posts, explicit anti-patterns per persona, post-generation ad-copy detection (existing heuristic) with auto-retry |
| Learning loop over-fits to one persona | Weight ceiling of 0.40, minimum of 0.05. Max adjustment of 0.05 per cycle. Min 3-post sample. |
| Cold start with no engagement data | Default equal weights. Prioritize variety. Learning kicks in after 10+ scored posts. |
| Persona definitions get stale | Lessons flag underperforming personas. Human review recommended quarterly. |
| Content type exceeds platform char limit | Platform-aware content type filtering at selection time. micro_story excluded for X-only runs. |
| Fallback posts bypass 80/20 ratio | Brand suffix stripped from fallbacks when brandMentionAllowed is false. |
| Dual scoring formulas in codebase | Canonical formula documented. Unification deferred but flagged. |
