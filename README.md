# x-automation

- **Web dashboard:** [apps/web](./apps/web) — Next.js frontend for viewing bot output and analytics.
- **X automation bot:** [apps/postgame-x-bot](./apps/postgame-x-bot) — scheduled bot that writes state to `apps/postgame-x-bot/state/tweet-analytics.json`.
- **Docs:** [docs/ai-docs](./docs/ai-docs)

## Local development

```bash
npm install
npm run dev
```

The dashboard runs from `apps/web`.

For the bot:

```bash
npm run bot:dry-run
```

## Deploy

Create the Vercel project for the web app with **Root Directory** set to `apps/web`.

Do not set an **Output Directory** override unless you also change Next.js `distDir`.

The bot is not a Vercel app. It runs from GitHub Actions via the root workflow.
