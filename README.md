# x-automation

- **Bot (post to X):** [postgame-x-bot](./postgame-x-bot) — runs on a schedule, writes state to `postgame-x-bot/state/tweet-analytics.json`.
- **Dashboard (Next.js):** [next-app](./next-app) — frontend that pulls results from the bot state (GitHub raw URL or local path).

## Vercel (dashboard)

Set **Root Directory** to **`next-app`** in Vercel → Project Settings → General. Then deploy. See [next-app/README.md](./next-app/README.md).
