# postgame.ai Social Bot

Automated sports content for X and Threads: fetch data from API-Sports (with ESPN fallback), generate posts with OpenAI, and publish twice daily via GitHub Actions. Built with **TypeScript** and Node.js.

## Setup

1. **Clone and enter the project**
   ```bash
   cd apps/postgame-x-bot
   ```

2. **Copy env template and add secrets**
   ```bash
   cp .env.example .env
   ```
   Fill in:
   - X (Twitter) OAuth 1.0: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
   - Threads Graph API: `THREADS_ACCESS_TOKEN` if you want Threads posting enabled
   - `OPENAI_API_KEY`
   - `API_SPORTS_KEY`
   - `POST_TARGETS=x` for X only, `POST_TARGETS=threads` for Threads only, or `POST_TARGETS=x,threads` for dual publishing

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Dry run (no live post)**
   ```bash
   npm run dry-run
   ```
   or `POST_ENABLED=false npx tsx src/main.ts`

5. **Live run**
   ```bash
   npm run post
   ```
   or `npx tsx src/main.ts`

## Platforms

- `POST_TARGETS=x` keeps the current X-only flow
- `POST_TARGETS=threads` publishes only to Threads
- `POST_TARGETS=x,threads` cross-posts the same generated text to both platforms
- `ANALYTICS_STORE_FILENAME=tweet-analytics.json` or `threads-analytics.json` lets each platform persist its own analytics state

Threads implementation notes:
- publishing uses the Threads Graph API text-post flow
- Threads text posts allow up to 500 characters; when X is also enabled the bot still uses the stricter 280-character shared limit
- a preflight check now queries the Threads publishing-limit endpoint before attempting to publish
- Threads media insights and profile insights are pulled into the analytics store when the token has `threads_manage_insights`
- existing tracked-link click analytics remain shared at the post level
- Threads publish results are recorded in `state/tweet-analytics.json`

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

There are now two scheduled workflows:
- `.github/workflows/post-daily-x.yml` runs the X bot with `POST_TARGETS=x` and stores analytics in `state/tweet-analytics.json`
- `.github/workflows/post-daily-threads.yml` runs the Threads bot with `POST_TARGETS=threads` and stores analytics in `state/threads-analytics.json`

Both workflows run at **6am and 6pm ET** and support manual `workflow_dispatch`.

Repository secrets:
- X bot: `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
- Threads bot: `THREADS_ACCESS_TOKEN`
- Shared: `OPENAI_API_KEY`, `API_SPORTS_KEY`, `NEWS_API_KEY`

Repository variables:
- Shared: `TARGET_SPORT`, `ANALYTICS_ENABLED`, `ANALYTICS_LOOKBACK_DAYS`, `ANALYTICS_MIN_AGE_MINUTES`, `ANALYTICS_MAX_REFRESH`, `NEWS_ENABLED`, `NEWS_LOOKBACK_HOURS`, `NEWS_MAX_ARTICLES`, `NEWS_LANGUAGE`, `NEWS_SORT_BY`, `NEWS_ALLOWED_DOMAINS`, `NEWS_ALLOWED_SOURCES`, `TRACKING_BASE_URL`, `CLICK_TARGET_URL`
- X bot toggle: `X_POST_ENABLED`
- Threads bot toggle: `THREADS_POST_ENABLED`

If you are running from the monorepo root, use `npm run bot:dry-run` or `npm run bot:post`. The root GitHub Actions workflow already targets `apps/postgame-x-bot`.

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
- store that token as `THREADS_ACCESS_TOKEN`
- set `POST_TARGETS=x,threads` once the token is ready

## PRD

Full product spec: [PRD.md](PRD.md).
