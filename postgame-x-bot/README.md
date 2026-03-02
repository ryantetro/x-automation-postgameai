# postgame.ai X Bot

Automated sports content for X (Twitter): fetch data from API-Sports (with ESPN fallback), generate posts with OpenAI, and publish twice daily via GitHub Actions. Built with **TypeScript** and Node.js.

## Setup

1. **Clone and enter the project**
   ```bash
   cd postgame-x-bot
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

## GitHub Actions

Workflow runs at **6am and 6pm ET** (cron) and supports manual `workflow_dispatch`. Add the same env vars as **Repository secrets** (`X_CONSUMER_KEY`, etc.). Optionally set **Variables**: `TARGET_SPORT` (default `nba`), `POST_ENABLED` (default `true`).

If this repo lives inside a monorepo, copy `.github/workflows/post-daily.yml` to the root `.github/workflows/` and set `working-directory: postgame-x-bot` (or `cd postgame-x-bot`) before install/run.

## PRD

Full product spec: [PRD.md](PRD.md).
