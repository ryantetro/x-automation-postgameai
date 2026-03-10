# x-automation

- **Web dashboard:** [apps/web](./apps/web) — Next.js frontend for viewing bot output and analytics.
- **Social bot engine:** [apps/social-bot-engine](./apps/social-bot-engine) — one engine, many bots. Each **campaign** (business / X account) has its own config and state.
- **Campaigns:** [campaigns/](./campaigns) — one directory per bot; add `campaigns/<slug>/config.json` to add a new bot.
- **Docs:** [docs/ai-docs](./docs/ai-docs)

## Multi-bot (campaigns)

The repo is set up so you can run **many X/Threads bots** (one per business, one per account) from one codebase:

- **One engine** — `apps/social-bot-engine` runs every campaign; no code change per bot.
- **One directory per campaign** — `campaigns/<slug>/config.json` defines brand, URL, platforms, data source.
- **Per-campaign state** — Analytics and logs live under `state/<slug>/` so bots never overwrite each other.
- **Credentials** — Each campaign uses its own X (and Threads) keys, via `BOT_CREDENTIALS_JSON` (one secret, keyed by slug) or a vault.

**Add a new bot:** Create `campaigns/<slug>/config.json` (see [campaigns/README.md](./campaigns/README.md) and [campaigns/schema.json](./campaigns/schema.json)), add that slug’s credentials to `BOT_CREDENTIALS_JSON`, then run with `CAMPAIGN=<slug>` or use the **Post to X (all campaigns)** workflow, which discovers and runs every campaign in `campaigns/`.

**List campaigns:** `npm run bot:campaigns:list` (outputs a JSON array of slugs).

## Local development

```bash
npm install
npm run dev
```

The dashboard runs from `apps/web`.

**Bot (default / single campaign):**

```bash
npm run bot:dry-run
```

**Bot for a specific campaign (uses `campaigns/<slug>/config.json` and optional `BOT_CREDENTIALS_JSON`):**

```bash
CAMPAIGN=postgame npm run bot:dry-run
```

## Deploy

Create the Vercel project for the web app with **Root Directory** set to `apps/web`.

Do not set an **Output Directory** override unless you also change Next.js `distDir`.

The bot is not a Vercel app. It runs from GitHub Actions:

- **Post to X** — single postgame bot (existing workflow).
- **Post to X (all campaigns)** — matrix over all `campaigns/`; each campaign uses its own credentials from `BOT_CREDENTIALS_JSON`.
