# postgame.ai X Bot

Automated sports content for X (Twitter): fetch data from API-Sports (with ESPN fallback), generate posts with OpenAI, and publish twice daily via GitHub Actions. Built with **TypeScript** and Node.js.

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
   - `OPENAI_API_KEY`
   - `API_SPORTS_KEY`

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Dry run (no post to X)**
   ```bash
   npm run dry-run
   ```
   or `POST_ENABLED=false npx tsx src/main.ts`

5. **Live run**
   ```bash
   npm run post
   ```
   or `npx tsx src/main.ts`

## Analytics Feedback Loop

The bot now runs a closed loop:
- Logs each post with metadata (`tweet_id`, sport, angle, source) in `state/tweet-analytics.json`
- Pulls X metrics for recent tweets
- Scores posts and derives winner/loser patterns
- Feeds those patterns back into generation prompts on future runs

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

On GitHub Actions, the workflow now auto-commits `state/tweet-analytics.json` after each run so learning persists across scheduled jobs with no manual intervention.

## GitHub Actions

Workflow runs at **6am and 6pm ET** (cron) and supports manual `workflow_dispatch`. Add the same env vars as **Repository secrets** (`X_CONSUMER_KEY`, etc.). Optionally set **Variables**: `TARGET_SPORT` (default `nba`), `POST_ENABLED` (default `true`), `ANALYTICS_ENABLED`, `ANALYTICS_LOOKBACK_DAYS`, `ANALYTICS_MIN_AGE_MINUTES`, `ANALYTICS_MAX_REFRESH`.

If you are running from the monorepo root, use `npm run bot:dry-run` or `npm run bot:post`. The root GitHub Actions workflow already targets `apps/postgame-x-bot`.

## PRD

Full product spec: [PRD.md](PRD.md).
