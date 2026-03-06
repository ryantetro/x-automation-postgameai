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

Deploy the repo root to Vercel. The root workspace install now pulls in both apps correctly, and `npm run build` targets `apps/web`.
