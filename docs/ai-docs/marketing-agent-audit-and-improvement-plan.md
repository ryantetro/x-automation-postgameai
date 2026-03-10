# X-Automation Marketing Agent: Full Audit & Improvement Plan

**Date:** 2026-03-10
**Status:** Active (2 campaigns: postgame, canopy)
**Platforms:** X (Twitter), Threads

---

## Part 1: System Overview

### Architecture

A multi-campaign automated social media engine built in TypeScript/Node.js:

- **Engine:** `apps/social-bot-engine` - shared bot that runs any campaign
- **Dashboard:** `apps/web` - Next.js analytics dashboard
- **Campaigns:** `campaigns/<slug>/config.json` - per-brand config (no code changes to add a new bot)
- **State:** `state/<slug>/tweet-analytics.json` - persistent per-campaign analytics
- **Automation:** GitHub Actions cron jobs (2x daily per campaign)

### Campaigns

| Campaign | Brand | Platform(s) | Data Source | Image |
|----------|-------|-------------|-------------|-------|
| postgame | postgame AI (getpostgame.ai) | X + Threads | Sports (ESPN, NewsAPI) | No |
| canopy | Vicious Shade Supply Co. (viciousshade.com) | X only | Angles-only (11 rotating pillars) | Yes (AI-generated) |

### Content Generation Pipeline

**Postgame (sports):**
1. Select sport by day rotation (NBA, NFL, MLB, Soccer)
2. Fetch live sports data (ESPN) + news articles (NewsAPI)
3. Select content architecture: Frame (6 types) x Hook (6 types) x Emotion (8 types)
4. Generate post via OpenAI (gpt-4o-mini, temp 0.8, max_tokens 120)
5. Validate (hook detection, ad drift, opener variety, length, brand tag)
6. Up to 3 retry attempts with specific followup prompts per failure type
7. If all fail -> fallback template
8. Publish to X and/or Threads

**Canopy (angles-only):**
1. Select angle from 11 content pillars (rotated by day of year)
2. Select post format (TENSION, MICRO-STORY, CONTRARIAN, SPECIFIC DETAIL, QUESTION, BEHIND-THE-SCENES)
3. Generate post via OpenAI with campaign-specific system prompt
4. Generate AI image (gpt-image-1) matching the angle
5. Publish to X with image

### Scheduling

- **X posts:** 6:00 AM and 6:00 PM ET daily (all campaigns via matrix job)
- **Threads posts:** 6:05 AM and 6:05 PM ET daily (postgame only, separate workflow)
- **State persistence:** Git commit after each run with `[skip ci]`

---

## Part 2: Current Performance (as of March 10, 2026)

### Key Metrics Summary

| Metric | Postgame (X) | Postgame (Threads) | Canopy (X) |
|--------|-------------|-------------------|-----------|
| Total posts | 15 posted (+ 7 dry runs, 3 failed) | 6 posted (+ 9 dry runs) | 2 posted |
| Avg impressions | 22.6 | 12.2 | 1.5 |
| Best impressions | 118 | 45 | 3 |
| Total engagement | 0 across all posts | 0 across all posts | 0 |
| Engagement rate | 0% | 0% | 0% |
| Followers | N/A | 0 | N/A |
| Click-throughs | 0 | 0 | 0 |

### Post-by-Post Performance (Postgame X - sorted by impressions)

| Date | Impressions | Source | Content Summary | Hook |
|------|------------|--------|----------------|------|
| Mar 9 | **118** | LLM + news | "Only 30% of teams capitalize on free agency. Cowboys/Packers..." | Specific Number |
| Mar 2 | 33 | backfill | "Teams that analyze shot selection improve scoring..." | Universal Truth |
| Mar 5 | 30 | LLM | "Coaches who review game film within 48 hours..." | Universal Truth |
| Mar 2 | 28 | backfill | "Coaches who focus on shot selection see 30%..." | Universal Truth |
| Mar 7 | 28 | LLM | "Pro teams spend 20+ hours weekly on film..." | Universal Truth |
| Mar 5 | 27 | backfill | "Coaches who review game film within 24-48 hours..." | Universal Truth |
| Mar 4 | 27 | backfill | "Teams leveraging data analytics see 15%..." | Universal Truth |
| Mar 5 | 26 | LLM | "Coaches who review game film within 48 hours..." | Universal Truth |
| Mar 8 | 26 | LLM | "Focusing on just 2-3 key plays can make or break..." | Universal Truth |
| Mar 6 | 25 | LLM | "Specific feedback can improve player performance..." | Universal Truth |
| Mar 3 | 25 | backfill | "Elite teams adjust strategies based on situational..." | Universal Truth |
| Mar 7 | 24 | LLM | "Pro teams dive deep into film with 20+ hours..." | Contradiction |
| Mar 9 | 18 | fallback | "Good football prep looks boring right up until chaos hits..." | — |
| Mar 9 | 13 | fallback | "Football staffs do not need more film..." | — |
| Mar 9 | 11 | LLM + news | "Lost opportunities exist in every 48-hour window. Saints..." | Contradiction |
| Mar 9 | 3 | fallback | "Good football prep looks boring right up until chaos hits..." | — (duplicate) |
| Mar 10 | 2 | LLM | "The truth is, talent can't take the field without..." | Universal Truth |
| Mar 10 | 0 | LLM | "72 hours is all you have..." | Specific Number |
| Mar 10 | 0 | LLM | "The game was lost in the 7th inning..." | Named Moment |

### Critical Problems Identified

#### 1. ZERO ENGAGEMENT (Likes, Replies, Retweets, Bookmarks = 0 across ALL posts)
- **Every single post** across both platforms has 0 likes, 0 replies, 0 retweets
- This is the biggest red flag. Even bad content on new accounts typically gets some engagement
- Possible causes: new/cold accounts with no followers, no community interaction, purely broadcast model

#### 2. Declining Impressions Trend
- Early posts (Mar 2-5): 25-33 impressions avg
- Mid posts (Mar 6-8): 24-28 impressions avg
- Recent posts (Mar 9-10): 0-18 impressions avg (with one outlier at 118)
- The algorithm is likely suppressing reach due to zero engagement signals

#### 3. Heavy Fallback Usage
- Multiple posts used the exact same fallback template: "Good football prep looks boring right up until chaos hits..."
- This caused a 403 duplicate rejection from X's API
- The LLM is failing validation checks frequently (especially hook detection)
- On Mar 8, there were 7 consecutive dry_run/fallback attempts before getting a valid post

#### 4. Content Sameness
- 80%+ of posts use "Universal Truth" hook structure
- 60%+ use "Development Gap" frame
- 60%+ target "frustration" emotion
- Most posts follow the same pattern: "[Stat claim]. [Coaching observation]. postgame AI - getpostgame.ai"
- Opening patterns repeat heavily: "coaches_who", "teams_that", "elite_teams"

#### 5. Threads Platform Issues
- 0 followers on Threads account
- API permission errors on older posts (can't fetch metrics)
- Several posts show "skipped" analytics status with permission errors

#### 6. Content Reads Like Marketing Copy Despite Guardrails
- Despite extensive banned-phrase lists, posts still read formulaic
- "postgame AI helps you..." pattern persists in backfill posts
- Many posts use made-up statistics ("30% improvement", "15% increase", "40% improvement")
- The voice doesn't match the system prompt's "brutally honest former coach" persona

#### 7. News Integration Underutilized
- Best performing post (118 impressions) was the one that named specific teams (Cowboys, Packers)
- But many news-driven posts still abstract away the specifics into generic coaching wisdom
- The news headline reference check is too easily satisfied

#### 8. No Community Engagement Strategy
- Bot only broadcasts, never replies, never likes, never follows
- X algorithm heavily penalizes accounts that only post and never engage
- No hashtag strategy (most posts have 0 hashtags despite coaching community using them)

---

## Part 3: Improvement Plan

### TIER 1: Critical Fixes (Immediate Impact)

#### 1.1 Implement Automated Engagement Loop
**Problem:** Zero engagement because the account is purely broadcast
**Solution:** Add a reply/like bot that runs on a separate schedule

```
New workflow: engage-daily.yml
Schedule: 4x daily (staggered from post times)
Actions:
  1. Search X for keywords in target niche (e.g., "coaching film review", "postgame analysis")
  2. Like 10-15 relevant tweets per run
  3. Reply to 3-5 high-relevance tweets with genuine, non-promotional takes
  4. Follow 2-3 accounts in the coaching community per day
```

This is the single highest-impact change. X's algorithm requires reciprocal engagement.

#### 1.2 Fix Content Voice - Stop Sounding Like a SaaS Account
**Problem:** Posts still read like marketing copy despite guardrails
**Solution:** Overhaul the system prompt and generation approach

- Switch from `gpt-4o-mini` to `gpt-4o` for content generation (better voice adherence)
- Reduce `max_tokens` from 120 to 90 (forces tighter writing)
- Add real coach quotes/tweets as few-shot examples in the prompt
- Remove all made-up statistics from the prompt template ("30% improvement" etc.)
- Add a post-generation "voice check" that scores how much it sounds like a real person vs a brand

#### 1.3 Diversify Content Architecture Selection
**Problem:** 80% Universal Truth hooks, 60% Development Gap frames
**Solution:** Weight selection against recently-used combinations

- Track frame/hook usage in last 14 posts (not just opener pattern)
- Hard-block any frame used 3+ times in last 7 posts
- Hard-block any hook used 3+ times in last 7 posts
- Implement weighted random selection that penalizes recent usage
- Add new hooks: "Hot Take", "Unpopular Opinion", "Story Thread"

#### 1.4 Fix Fallback Duplication
**Problem:** Same fallback template posted multiple times, causing 403s
**Solution:** Already have `pickNonDuplicateFallback` but it's not catching all cases

- Expand fallback templates from 6 to 20+ per sport
- Make fallbacks time-aware (reference current season, month, events)
- Add a hard check: if fallback would be duplicate, skip the post entirely rather than risk a 403
- Log fallback usage frequency and alert when templates are exhausted

### TIER 2: Content Quality (High Impact)

#### 2.1 Analytics-Driven Content Optimization (Automated A/B Testing)
**Problem:** No automated learning from what works
**Solution:** Build a feedback loop that actually changes generation behavior

The system already has `buildIterationInsights()` and `promptGuidance` but they're underutilized:

- **Weighted scoring:** Current score is just engagement count. Change to:
  `score = (impressions * 0.3) + (likes * 3) + (replies * 5) + (retweets * 4) + (bookmarks * 2) + (clicks * 10)`
- **Top performer analysis:** After 50+ posts, run weekly analysis:
  - Which frames/hooks/emotions get highest engagement rate?
  - Which posting times get more impressions?
  - News-driven vs sports-only performance comparison
  - Optimal post length range
- **Prompt mutation:** Feed top 5 performing posts as examples into the system prompt
- **Auto-retire:** If a frame/hook combo scores below average for 10+ posts, temporarily disable it

#### 2.2 Posting Time Optimization
**Problem:** Fixed 6am/6pm ET schedule regardless of audience behavior
**Solution:** Test different times and auto-optimize

- Add 4 time slots: 7am, 12pm, 5pm, 9pm ET
- Run each for 2 weeks, compare impression/engagement rates
- Implement automated slot selection based on rolling 14-day performance
- Consider sport-specific timing (NFL content does better on Tuesdays/Wednesdays, NBA game nights, etc.)

#### 2.3 Thread/Multi-Post Content
**Problem:** Single tweets have limited reach and depth
**Solution:** Add thread capability for high-value content

- 1-2x per week, generate a 3-4 tweet thread instead of single post
- Use threads for deeper coaching insights, mini case studies
- First tweet is the hook, subsequent tweets deliver value
- Threads get significantly more impressions on X's algorithm

#### 2.4 Visual Content for Postgame
**Problem:** Postgame posts are text-only, canopy has images
**Solution:** Add image/graphic generation for postgame

- Generate stat cards or insight graphics for sports posts
- Use DALL-E or a template-based approach for consistent branding
- Posts with images get 2-3x more engagement on X
- Create a "coaching whiteboard" visual style

### TIER 3: Growth Automation (Medium-Term)

#### 3.1 Hashtag Strategy Engine
**Problem:** No hashtags being used despite coaching community using them
**Solution:** Dynamic hashtag selection based on trending + niche tags

- Maintain a curated list of high-performing coaching hashtags per sport
- Use X API to check trending hashtags before posting
- Add 1-2 relevant hashtags per post (not spam, strategic placement)
- Track which hashtags correlate with higher impressions

#### 3.2 Content Calendar Intelligence
**Problem:** Content doesn't align with real-world sporting calendar
**Solution:** Integrate with sports calendar APIs

- Know when NFL Draft, NBA Playoffs, MLB Opening Day, etc. are happening
- Automatically shift content themes to match current sporting events
- "Moment marketing" - react to major games/events within hours
- Seasonal content planning (offseason vs in-season strategies)

#### 3.3 Cross-Platform Content Differentiation
**Problem:** Same content posted to X and Threads
**Solution:** Tailor content per platform

- **X:** Shorter, punchier, controversy-friendly, 1-2 hashtags
- **Threads:** Longer-form, storytelling, more personal, no hashtags
- Different posting frequencies per platform
- Platform-specific voice adjustments in the system prompt

#### 3.4 Audience Growth Tracking
**Problem:** No follower/audience growth metrics
**Solution:** Track and optimize for audience growth

- Pull follower count daily via X API
- Track follower growth rate vs posting frequency
- Identify which content types drive follows vs just impressions
- Set growth targets and adjust strategy accordingly

### TIER 4: Advanced Automation (Long-Term)

#### 4.1 Autonomous Performance Optimization Agent
**Problem:** Manual review needed to identify what's working
**Solution:** Build a self-improving optimization loop

```
Weekly cron job: optimization-cycle.yml
1. Pull all analytics for last 30 days
2. Run comprehensive performance analysis (frames, hooks, emotions, times, lengths)
3. Generate updated prompt guidance based on statistical analysis
4. Update system prompt parameters (emotion weights, frame preferences)
5. A/B test: keep 70% proven patterns, 30% experimental
6. Log all changes for human review
```

#### 4.2 Real-Time Trend Surfing
**Problem:** Bot posts on fixed schedule regardless of what's happening
**Solution:** Add event-triggered posting

- Monitor X trending topics for relevant sports keywords
- When a major story breaks, trigger an immediate post (with rate limiting)
- Use stronger news integration for time-sensitive content
- "First-mover advantage" for trending topics in the coaching niche

#### 4.3 Reply-to-Engagement Automation
**Problem:** When someone does engage, there's no follow-up
**Solution:** Auto-respond to engagement

- Monitor for replies to bot posts
- Generate contextual, non-promotional responses
- Like all positive replies
- Follow accounts that engage multiple times
- Never auto-reply with promotional content

#### 4.4 Multi-Model Content Generation
**Problem:** Single model (gpt-4o-mini) produces repetitive patterns
**Solution:** Use multiple models and compare

- Generate candidate posts from 2-3 models (gpt-4o, claude, gpt-4o-mini)
- Score candidates on voice adherence, uniqueness, hook strength
- Select the best candidate for publication
- Track which model produces highest-performing content

---

## Part 4: Implementation Priority Matrix

| Change | Impact | Effort | Priority |
|--------|--------|--------|----------|
| 1.1 Engagement loop (likes/replies) | Critical | Medium | **NOW** |
| 1.2 Fix content voice (better model, tighter prompts) | High | Low | **NOW** |
| 1.3 Diversify content architecture | High | Low | **NOW** |
| 1.4 Fix fallback duplication | Medium | Low | **NOW** |
| 2.1 Analytics-driven optimization | High | Medium | Week 1-2 |
| 2.4 Visual content for postgame | High | Medium | Week 1-2 |
| 2.2 Posting time optimization | Medium | Low | Week 2 |
| 3.1 Hashtag strategy | Medium | Low | Week 2 |
| 2.3 Thread/multi-post content | High | Medium | Week 3 |
| 3.2 Content calendar intelligence | Medium | Medium | Week 3-4 |
| 3.3 Cross-platform differentiation | Medium | Medium | Week 4 |
| 3.4 Audience growth tracking | Low | Low | Week 4 |
| 4.1 Autonomous optimization agent | High | High | Month 2 |
| 4.2 Real-time trend surfing | High | High | Month 2 |
| 4.3 Reply automation | Medium | Medium | Month 2-3 |
| 4.4 Multi-model generation | Medium | High | Month 3 |

---

## Part 5: Key Files Reference

| File | Purpose |
|------|---------|
| `apps/social-bot-engine/src/main.ts` | Main orchestration - post generation and publishing |
| `apps/social-bot-engine/src/generatePost.ts` | LLM prompt construction, validation, retry logic |
| `apps/social-bot-engine/src/contentArchitecture.ts` | Frame/hook/emotion selection system |
| `apps/social-bot-engine/src/contentHeuristics.ts` | Pre-publish validation checks |
| `apps/social-bot-engine/src/analytics.ts` | Metrics tracking, iteration insights, scoring |
| `apps/social-bot-engine/src/fetchData.ts` | Sports data fetching (ESPN/API-Sports) |
| `apps/social-bot-engine/src/fetchNews.ts` | News article sourcing (NewsAPI) |
| `apps/social-bot-engine/src/postToX.ts` | X/Twitter publishing |
| `apps/social-bot-engine/src/postToThreads.ts` | Threads publishing |
| `apps/social-bot-engine/src/generateImage.ts` | AI image generation (canopy) |
| `campaigns/postgame/config.json` | Postgame campaign config |
| `campaigns/canopy/config.json` | Canopy campaign config |
| `campaigns/canopy/system_prompt.txt` | Canopy voice/brand prompt |
| `campaigns/canopy/content-pillars.json` | 11 rotating content themes |
| `.github/workflows/post-daily-campaigns.yml` | Main cron automation |
| `state/postgame/tweet-analytics.json` | Postgame X analytics state |
| `state/canopy/tweet-analytics.json` | Canopy analytics state |
| `apps/social-bot-engine/state/tweet-analytics.json` | Legacy postgame analytics |
| `apps/social-bot-engine/state/threads-analytics.json` | Threads analytics state |

---

## Part 6: Bottom Line

The system is **technically impressive** - the multi-campaign architecture, content validation pipeline, and analytics tracking are well-built. But the content strategy and growth mechanics are fundamentally broken:

1. **No engagement = no reach.** X's algorithm requires interaction, not just broadcasting. Without likes, replies, and follows, the algorithm will continue suppressing reach.

2. **The content sounds like a bot.** Despite extensive guardrails against marketing copy, the posts still read formulaic. The "brutally honest former coach" voice is not coming through - instead we get "[Stat claim]. [Generic coaching observation]. Brand tag."

3. **No learning loop.** The iteration insights system exists but isn't driving meaningful change. The same frame/hook combos keep getting selected. The best-performing post (118 impressions) used news + specific team names, but the system hasn't adapted to produce more of that.

4. **The single biggest win is engagement automation.** Adding likes/replies/follows to relevant accounts will do more for performance than any content quality improvement. You cannot grow on X by only posting.

The path from "working okay" to "working great" requires treating this less like a content publishing tool and more like a **social media presence** - one that engages, adapts, and builds community, not just broadcasts into the void.
