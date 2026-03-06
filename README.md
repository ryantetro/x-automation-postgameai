# x-automation

- **Bot (post to X):** [postgame-x-bot](./postgame-x-bot) — runs on a schedule, writes state to `postgame-x-bot/state/tweet-analytics.json`.
- **Dashboard (Next.js):** [next-app](./next-app) — frontend that pulls results from the bot state (GitHub raw URL or local path).

## Vercel (dashboard)

**Required:** In Vercel → your project → **Settings** → **General** → **Root Directory**, set to **`next-app`** and save.  
Without this, the build fails with "No Next.js version detected" because the repo root has no Next app. After setting it, redeploy.
