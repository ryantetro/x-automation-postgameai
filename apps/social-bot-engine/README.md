# Social Bot Engine

Multi-campaign social bot engine for X and Threads: fetch data, generate posts with OpenAI, and publish on schedule via GitHub Actions. Each campaign has its own config, prompts, and state. Built with **TypeScript** and Node.js.

## Setup

1. **Clone and enter the project**
   ```bash
   cd apps/social-bot-engine
   ```

2. **Copy env template and add secrets**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   - X (Twitter) OAuth 1.0: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
   - Threads Graph API: `THREADS_ACCESS_TOKEN` if you want Threads posting enabled
   - `THREADS_APP_SECRET` only if you want to run the one-time short-lived -> long-lived Threads token exchange locally
   - `OPENAI_API_KEY`
   - `API_SPORTS_KEY`
   - `POST_TARGETS=x` for X only, `POST_TARGETS=threads` for Threads only, or `POST_TARGETS=x,threads` for dual publishing

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Dry run (default when running locally)**
   ```bash
   npm run dry-run
   ```
   or just `npx tsx src/main.ts` — local runs are dry run by default.

5. **Live run (local)** — only when you explicitly want to post from your machine:
   ```bash
   POST_ENABLED=true npx tsx src/main.ts
   ```
   In GitHub Actions (CI), the bot always posts for real; no repo variables needed.

## Platforms

- `POST_TARGETS=x` keeps the current X-only flow
- `POST_TARGETS=threads` publishes only to Threads
- `POST_TARGETS=x,threads` cross-posts the same generated text to both platforms
- campaign-managed bots typically keep one analytics store file for the run, even when dual-publishing

Threads implementation notes:
- publishing uses the Threads Graph API text-post flow
- Threads text posts allow up to 500 characters; when X is also enabled the bot still uses the stricter 280-character shared limit
- a preflight check now queries the Threads publishing-limit endpoint before attempting to publish
- Threads media insights and profile insights are pulled into the analytics store when the token has `threads_manage_insights`
- tracked links are now generated per platform (`runId-x`, `runId-threads`) so X and Threads traffic can be attributed separately
- dual-platform campaign runs record both X and Threads publish results in the same campaign analytics store

## Traffic attribution

When `TRACKING_BASE_URL` is set, the bot now creates a tracked redirect URL for each publish target instead of a single shared link. The analytics store keeps those records under `outboundTracking`, including:

- `trackingId`
- `platform`
- `trackedUrl`
- `linkTargetUrl`
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `utmContent`
- `utmTerm`

This repo records click metrics at the redirect layer. Destination sites can then use the incoming `tracking_id` to emit PostHog landing and conversion events that flow back into the dashboard.

## Analytics Feedback Loop

The bot now runs a closed loop:
- Logs each post with metadata (`tweet_id`, sport, angle, source) in `state/tweet-analytics.json`
- Pulls X metrics for recent tweets
- Scores posts and derives winner/loser patterns
- Feeds those patterns back into generation prompts on future runs
- Optionally prefers recent, allowlisted news angles via NewsAPI when a strong article is available

Useful commands:

```bash
npm run analytics:pull    # Refresh metrics for recent tweets
npm run analytics:report  # Print + save winner/loser pattern report
npm run analytics:content-backfill  # Backfill frame/hook metadata into existing analytics
```

Environment variables:
- `ANALYTICS_ENABLED` (default `true`)
- `ANALYTICS_LOOKBACK_DAYS` (default `21`)
- `ANALYTICS_MIN_AGE_MINUTES` (default `45`)
- `ANALYTICS_MAX_REFRESH` (default `40`)
- `NEWS_API_KEY` (required only if you want NewsAPI-guided tweets)
- `NEWS_ENABLED` (default `true`)
- `NEWS_LOOKBACK_HOURS` (default `36`)
- `NEWS_MAX_ARTICLES` (default `10`)
- `NEWS_LANGUAGE` (default `en`)
- `NEWS_SORT_BY` (default `publishedAt`)
- `NEWS_ALLOWED_DOMAINS` (optional CSV; defaults to a trusted sports-media allowlist)
- `NEWS_ALLOWED_SOURCES` (optional CSV; used when domains are not configured)

On GitHub Actions, the workflow now auto-commits `state/tweet-analytics.json` after each run so learning persists across scheduled jobs with no manual intervention.

## NewsAPI-guided tweets

When `NEWS_ENABLED=true` and `NEWS_API_KEY` is set, the bot:
- queries NewsAPI for recent sport-relevant stories
- filters to an allowlist of trusted domains/sources
- scores freshness and coaching/performance relevance
- prefers a strong article as the tweet hook when one clears the threshold
- falls back to the normal sports/coaching flow when no article is strong enough

Important editorial behavior:
- the tweet still sounds like postgame AI, not a news wire account
- the article is used as context, not as a direct citation-heavy recap
- the tracked `postgame.ai` link remains the only link in the tweet

Default allowlist domains:
- `espn.com`
- `theathletic.com`
- `sports.yahoo.com`
- `cbssports.com`
- `nbcsports.com`
- `foxsports.com`
- `si.com`
- `sportingnews.com`
- `bleacherreport.com`

## GitHub Actions

There are two workflow models in the repo:
- `.github/workflows/post-daily-campaigns.yml` is the shared campaign workflow and is the default pattern for new campaigns; it honors each campaign’s `postTargets`
- the legacy postgame workflows (`post-daily-x.yml` and `post-daily-threads.yml`) remain for postgame only during the migration period

Repository secrets:
- X bot: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
- Threads bot: `THREADS_ACCESS_TOKEN`
- Shared: `OPENAI_API_KEY`, `API_SPORTS_KEY`, `NEWS_API_KEY`

Repository variables:
- Shared: `TARGET_SPORT`, `ANALYTICS_ENABLED`, `ANALYTICS_LOOKBACK_DAYS`, `ANALYTICS_MIN_AGE_MINUTES`, `ANALYTICS_MAX_REFRESH`, `NEWS_ENABLED`, `NEWS_LOOKBACK_HOURS`, `NEWS_MAX_ARTICLES`, `NEWS_LANGUAGE`, `NEWS_SORT_BY`, `NEWS_ALLOWED_DOMAINS`, `NEWS_ALLOWED_SOURCES`, `TRACKING_BASE_URL`, `CLICK_TARGET_URL`

Posting is **on** in CI (GitHub Actions) and **off** (dry run) when run locally, unless you set `POST_ENABLED=true`.

If you are running from the monorepo root, use `npm run bot:dry-run` or `npm run bot:post`. The root GitHub Actions workflow already targets `apps/social-bot-engine`.

Additional GitHub Actions setup for news:
- Add `NEWS_API_KEY` as a repository secret
- Add optional repository variables:
- `NEWS_ENABLED`
- `NEWS_LOOKBACK_HOURS`
- `NEWS_MAX_ARTICLES`
- `NEWS_LANGUAGE`
- `NEWS_SORT_BY`
- `NEWS_ALLOWED_DOMAINS`
- `NEWS_ALLOWED_SOURCES`

Threads app setup:
- create a Meta app with Threads API access and a user access token that can publish content
- ensure the token has `threads_basic` and `threads_content_publish`
- add `threads_manage_insights` if you want Threads metrics and follower/profile insights in the dashboard
- exchange the short-lived Explorer token for a long-lived token before storing it as `THREADS_ACCESS_TOKEN`
- for campaign-managed bots, put that token inside the campaign’s `BOT_CREDENTIALS_JSON` block

## Threads token lifecycle

Use a long-lived Threads token, not the 1-hour Explorer token.

One-time exchange from short-lived -> long-lived:

```bash
THREADS_APP_SECRET=your_threads_app_secret \
THREADS_SHORT_LIVED_ACCESS_TOKEN=your_short_lived_threads_token \
npm run bot:threads:token:exchange
```

Automatic refresh uses the current long-lived campaign `THREADS_ACCESS_TOKEN` values stored in `BOT_CREDENTIALS_JSON`:

```bash
npm run bot:threads:token:refresh
```

The repo includes a scheduled workflow at [.github/workflows/refresh-threads-token.yml](../../.github/workflows/refresh-threads-token.yml) that refreshes all campaign Threads tokens found inside `BOT_CREDENTIALS_JSON` and writes the updated JSON back to the repo secret automatically.

Required GitHub secrets for auto-refresh:
- `BOT_CREDENTIALS_JSON` — campaign-keyed credential JSON that may include `THREADS_ACCESS_TOKEN`
- `THREADS_SECRET_ADMIN_TOKEN` — a GitHub token that can update repository Actions secrets

Recommended GitHub token permissions for `THREADS_SECRET_ADMIN_TOKEN`:
- fine-grained PAT scoped to this repo
- repository permission: `Secrets` set to `Read and write`

## PRD

Full product spec: [PRD.md](PRD.md).
