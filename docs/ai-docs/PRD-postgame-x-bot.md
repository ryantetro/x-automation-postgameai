# PRD: Automated X (Twitter) Bot for postgame.ai

| Field | Value |
|-------|--------|
| **Product** | postgame.ai Automated X Marketing Bot |
| **Author** | Ryan Tetro |
| **Status** | Draft |
| **Created** | February 27, 2026 |
| **Last Updated** | February 27, 2026 |

---

## Overview

An automated system that fetches live and historical sports data from external APIs, generates engaging social media posts using OpenAI, and publishes them daily to X (Twitter) via **GitHub Actions** — driving consistent impressions and traffic back to [postgame.ai](https://postgame.ai) with zero manual effort.

This follows the proven pattern used by [Golf Agent Pro](https://jcdesign.medium.com/unlock-the-easiest-marketing-win-automated-daily-posts-on-x-b9b9e0605d4f), which achieved 1.1K impressions in its first week of fully automated posting.[^1]

---

## Problem Statement

Consistency is the hardest part of marketing on X. Between building product and managing everything else, social posting is the first thing that drops off. postgame.ai needs a steady drip of high-quality, sports-aware content that drives traffic without consuming founder time.

---

## Goals and Success Metrics

| Goal | Metric | Target (30 days) | Target (90 days) |
|------|--------|------------------|------------------|
| Build audience | Impressions | 5K+ | 25K+ |
| Drive traffic | Link clicks to postgame.ai | 50+ | 300+ |
| Grow following | Follower count | 100+ | 500+ |
| Convert visitors | Signups from X referral | 10+ | 50+ |
| Maintain consistency | Posts published | 60 (2/day) | 180 (2/day) |

---

## User Personas

### Primary: Sports Fan / Casual Coach

- Scrolls sports Twitter daily, follows teams and analysts
- Wants quick recaps, hot takes, and coaching insights
- Engages with posts that "sound like a buddy in the group chat" — not corporate marketing

### Secondary: Youth/Amateur Coach

- Looks for tactical analysis and coaching tips
- Follows hashtags like #CoachingTips, #BasketballIQ, #NFLAnalysis
- Potential postgame.ai power user

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────┐
│  API-Sports  │────▶│  Python Bot  │────▶│  OpenAI API │────▶│  X API   │
│  (data)      │     │  (GH Action) │     │  (generate) │     │  (post)  │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────┘
       │                    │                                       │
       │              ┌─────┴──────┐                                │
       │              │  Fallback: │                                │
       └─────────────▶│  ESPN API  │                          postgame.ai
                      └────────────┘                          (link in bio
                                                               + every post)
```

### Data Flow

1. **GitHub Actions cron** runs twice daily at 6am and 6pm ET (`0 11 * * *` and `0 23 * * *` UTC).
2. **Fetch** pulls current game data, scores, standings, and player stats from API-Sports.[^2]
3. **Fallback** — if API-Sports is down, hit ESPN's unofficial public API (no auth required).[^3]
4. **Generate** — pass fetched data as context to the OpenAI API; model produces a post in the postgame.ai brand voice.
5. **Validate** — ensure post is ≤ 280 characters (critical — truncation was a real issue for Golf Agent Pro).
6. **Publish** — post to X via tweepy using OAuth 1.0 credentials.[^4]
7. **Log** — store post text, timestamp, and any errors for monitoring.

---

## Tech Stack

| Component | Tool | Why |
|-----------|------|-----|
| Language | Python 3.11+ | Tweepy + OpenAI SDK both native Python[^4] |
| Scheduling | GitHub Actions | Free cron, secrets in repo, no separate hosting |
| Sports Data (primary) | [API-Sports](https://api-sports.io) | Free tier: 100 req/day, all sports, no credit card[^2] |
| Sports Data (fallback) | [ESPN Hidden API](https://site.api.espn.com) | Free, no auth; unofficial but reliable for fallback[^3] |
| Content Generation | OpenAI API (e.g. GPT-4o-mini) | Low cost per request; strong instruction-following |
| X Integration | tweepy (Python) | Mature library, OAuth 1.0, API v2 support[^4] |
| Secrets | GitHub Actions Secrets | All API keys in repo secrets, never in code |

---

## External API Details

### API-Sports (Primary Data Source)

- **Signup:** [dashboard.api-sports.io](https://dashboard.api-sports.io) — free, no credit card[^2]
- **Auth:** API key passed as `x-apisports-key` header[^8]
- **Free tier limits:** 100 requests/day per sport API[^2]
- **Sports covered:** Football (soccer), Basketball (NBA), American Football (NFL), Baseball (MLB), Hockey (NHL), Rugby, Formula 1, and more[^2]

| Sport | Base URL | Key Endpoints |
|-------|----------|---------------|
| NBA | `v1.basketball.api-sports.io` | `/games`, `/statistics`, `/standings` |
| NFL | `v1.american-football.api-sports.io` | `/games`, `/games/statistics`[^9] |
| MLB | `v1.baseball.api-sports.io` | `/games`, `/games/statistics`[^10] |
| Soccer | `v3.football.api-sports.io` | `/fixtures`, `/fixtures/statistics`, `/standings`[^8] |

### ESPN Hidden API (Fallback)

- **No signup needed** — public endpoints, no API key[^3]
- **Risk:** Unofficial, undocumented; may change without notice[^3]
- **Example endpoints:**
  - NFL: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`
  - NBA: `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
  - MLB: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`

### X (Twitter) API

- **Signup:** [developer.x.com](https://developer.x.com)[^11]
- **Free tier:** 500 posts/month write access (~16–17/day)[^12][^13]
- **Auth:** OAuth 1.0 — Consumer Key, Consumer Secret, Access Token, Access Token Secret[^4]
- **Critical setup:**
  1. Set app permissions to **Read and Write** before generating tokens[^1]
  2. Set app type to **Web App, Automated App or Bot**
  3. Callback URL (e.g. `https://localhost` is fine)
  4. If tokens were read-only, regenerate after changing permissions

### OpenAI API

- **Signup:** [platform.openai.com](https://platform.openai.com)
- **Model:** e.g. `gpt-4o-mini` for cost-effective, high-quality short text
- **Cost per post:** Typically well under $0.01 for a tweet-length prompt + response
- **Secrets:** Store `OPENAI_API_KEY` in GitHub Actions repository secrets

---

## Feature Requirements

### P0 — Must Have (MVP)

- [ ] **Twice-daily automated posting** — GitHub Action runs at 6am and 6pm ET; fetch data → generate → publish to X
- [ ] **Multi-sport data fetching** — scores, stats, standings from API-Sports for at least 2 sports (start NBA + NFL)
- [ ] **OpenAI-powered content generation** — pass game data + brand voice prompt; output tweet ≤ 280 characters
- [ ] **Character count validation** — hard reject and regenerate if output &gt; 280 chars
- [ ] **Link back to postgame.ai** — every post mentions `postgame.ai` or a shortened link
- [ ] **Fallback template system** — if OpenAI is down, use hardcoded template with live data from ESPN fallback
- [ ] **Secrets via GitHub** — all keys and tokens in GitHub Actions secrets, never in repo
- [ ] **Error logging** — log all post attempts, successes, and failures with timestamps

### P1 — Should Have (Week 2–3)

- [ ] **Sport-aware scheduling** — NBA on game nights, NFL on Sun/Mon/Thu, MLB in season
- [ ] **Hashtag strategy** — dynamic hashtags (#NBA, #MNF, #WorldSeries, etc.) by sport/event
- [ ] **Engagement tracking** — weekly script for impressions/engagement (X API Basic $200/mo — defer unless ROI clear)[^13]
- [ ] **Post variety** — rotate: game recaps, player spotlights, coaching tips, stat breakdowns, pregame previews
- [ ] **Multiple posts per day** — 2–3 posts on heavy game days (within 500/month free limit)[^12]

### P2 — Nice to Have (Month 2+)

- [ ] **Multiple X accounts** — e.g. 2–3 sport-specific accounts for postgame.ai
- [ ] **Image generation** — attach simple stat card image to tweets
- [ ] **Thread support** — 2–3 tweet threads for coaching breakdowns
- [ ] **A/B prompt testing** — two prompt variants, compare impressions, keep winner
- [ ] **Webhook integration** — trigger on game completion in addition to cron

---

## OpenAI Prompt Engineering

The prompt is the most important part of the system. The goal is posts that sound like a coach or sports buddy — not a brand account.

### System Prompt (v1)

```text
You are the social media voice for postgame.ai, an AI coaching assistant
for athletes and sports fans. Write a single tweet (MUST be under 280
characters including spaces, hashtags, and URLs).

Rules:
- Sound like a coach talking to players or a sports buddy in a group chat
- Be confident, opinionated; use real player names and real stats
- Use sport-specific language (e.g. "double-double", "red zone efficiency",
  "launch angle", "clean sheet")
- Include 1–2 relevant hashtags
- Mention postgame.ai naturally (weave it in, not as a CTA)
- Never sound corporate or use phrases like "check out our insights"
- Reference specific games, scores, or performances from the data provided

Bad: "postgame.ai's AI analysis shows strong predictions for tonight's
games. Check out our latest insights!"

Good: "Jokic just dropped 35/12/9 on 60% shooting. That's not a stat line,
that's a cheat code. postgame.ai had him flagged all week. #NBA #Nuggets"
```

### User Prompt Template

```text
Here is today's sports data:

{fetched_data_json}

Write one tweet about the most interesting storyline from this data.
Follow your system instructions. The tweet MUST be under 280 characters.
```

### Iteration Plan

1. Deploy v1 prompt; run for 1 week
2. Review posts manually — flag robotic or generic ones
3. Adjust prompt (more slang examples, ban overused phrases)
4. Repeat weekly for the first month, then monthly

---

## Project Structure

```text
apps/postgame-x-bot/
├── README.md
├── PRD.md
├── requirements.txt          # tweepy, openai, requests, python-dotenv
├── .env.example
├── .github/
│   └── workflows/
│       └── post-daily.yml    # Scheduled run: fetch → generate → post
├── src/
│   ├── main.py               # Entry: fetch → generate → post
│   ├── fetch_data.py         # API-Sports + ESPN fallback
│   ├── generate_post.py      # OpenAI prompt + API call
│   ├── post_to_x.py          # Tweepy OAuth + post
│   ├── validate.py           # 280-char + content checks
│   └── config.py             # Env loading, constants
├── prompts/
│   ├── system_prompt.txt     # Versioned system prompt
│   └── templates/            # Fallback templates per sport
│       ├── nba_template.txt
│       ├── nfl_template.txt
│       └── mlb_template.txt
└── logs/
    └── posts.log             # Post history with timestamps
```

### GitHub Actions Workflow (`.github/workflows/post-daily.yml`)

```yaml
name: Post to X (6am & 6pm ET)

on:
  schedule:
    # 6am ET (11:00 UTC) and 6pm ET (23:00 UTC)
    - cron: '0 11 * * *'
    - cron: '0 23 * * *'
  workflow_dispatch:  # Allow manual run

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: pip install -r requirements.txt

      - name: Run bot
        env:
          X_CONSUMER_KEY: ${{ secrets.X_CONSUMER_KEY }}
          X_CONSUMER_SECRET: ${{ secrets.X_CONSUMER_SECRET }}
          X_ACCESS_TOKEN: ${{ secrets.X_ACCESS_TOKEN }}
          X_ACCESS_TOKEN_SECRET: ${{ secrets.X_ACCESS_TOKEN_SECRET }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          API_SPORTS_KEY: ${{ secrets.API_SPORTS_KEY }}
          TARGET_SPORT: ${{ vars.TARGET_SPORT || 'nba' }}
          POST_ENABLED: ${{ vars.POST_ENABLED || 'true' }}
        run: python src/main.py
```

### `.env.example`

```env
# X (Twitter) API — OAuth 1.0
X_CONSUMER_KEY=
X_CONSUMER_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_TOKEN_SECRET=

# OpenAI
OPENAI_API_KEY=

# API-Sports
API_SPORTS_KEY=

# Config
TARGET_SPORT=nba
POST_ENABLED=true
```

### `requirements.txt`

```text
tweepy>=4.14.0
openai>=1.0.0
requests>=2.31.0
python-dotenv>=1.0.0
```

---

## Deployment Plan

### Phase 1: Local Testing (Day 1–2)

1. Register for API-Sports free account at [api-sports.io](https://api-sports.io)[^2]
2. Create X Developer app; get OAuth 1.0 credentials with Read+Write[^11]
3. Get OpenAI API key from [platform.openai.com](https://platform.openai.com)
4. Build `main.py` locally; test with `POST_ENABLED=false` (dry run)
5. Iterate on prompt until output is on-brand and ≤ 280 chars

### Phase 2: First Live Post (Day 3)

1. Set `POST_ENABLED=true`; run once manually
2. Verify post on X (formatting, link, hashtags)
3. Fix any issues (truncation, missing data, voice)

### Phase 3: Enable GitHub Actions (Day 4)

1. Push repo to GitHub
2. Add secrets: `X_*`, `OPENAI_API_KEY`, `API_SPORTS_KEY`
3. Optionally set vars: `TARGET_SPORT`, `POST_ENABLED`
4. Trigger workflow manually; confirm first automated run at schedule time

### Phase 4: Monitor and Iterate (Week 1–4)

1. Check posts daily for first week; flag robotic/generic ones
2. Refine prompt based on what works
3. Review X analytics weekly
4. Add second sport after Week 2 if first is working

---

## Cost Estimate

| Service | Plan | Monthly Cost |
|---------|------|-------------|
| API-Sports | Free (100 req/day)[^2] | $0 |
| ESPN API (fallback) | Free[^3] | $0 |
| OpenAI API | Pay-per-use (~60 calls/mo) | ~$1–4 |
| X API | Free (500 posts/mo)[^12] | $0 |
| GitHub Actions | Free (scheduled workflows) | $0 |
| **Total** | | **~$1–4/month** |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| ESPN API changes | Fallback data unavailable | Use ESPN only as fallback; API-Sports primary[^2] |
| Model output &gt; 280 chars | Tweet truncated | Validate; regenerate up to 3x; then fallback template |
| X API free tier restricted | Can't post | 500/mo enough for 2/day; evaluate Basic $200/mo if needed[^13] |
| Posts sound robotic | Low engagement, brand harm | Weekly prompt review; keep examples and constraints specific |
| API-Sports rate limit | No data | 100 req/day sufficient; batch into 3–5 calls max[^2] |
| X flags account as bot | Suspension | Use "Automated App or Bot"; ≤3 posts/day; vary content |

---

## Open Questions

- [ ] Bot respond to replies/mentions, or post-only for MVP?
- [ ] Start with NBA + NFL, or follow in-season sports?
- [ ] Tag team/player accounts for reach (higher spam risk)?
- [ ] At what impression level is X API Basic ($200/mo) for analytics worth it?[^13]
- [ ] Post during off-season or pause to preserve quota?

---

## References

[^1]: Golf Agent Pro — [Unlock the easiest marketing win](https://jcdesign.medium.com/unlock-the-easiest-marketing-win-automated-daily-posts-on-x-b9b9e0605d4f)
[^2]: API-Sports — [api-sports.io](https://api-sports.io), free tier
[^3]: ESPN Hidden API — [site.api.espn.com](https://site.api.espn.com)
[^4]: tweepy — Python X/Twitter library, OAuth 1.0
[^8]: API-Sports Football — v3 base URL, `x-apisports-key` header
[^9]: API-Sports American Football endpoints
[^10]: API-Sports Baseball endpoints
[^11]: X Developer — [developer.x.com](https://developer.x.com)
[^12]: X API free tier — 500 posts/month
[^13]: X API Basic — $200/mo, analytics
