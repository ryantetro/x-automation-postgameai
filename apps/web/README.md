# Tweet Momentum Exchange Dashboard

Crypto-terminal style dashboard for your automated postgame X bot.

## What It Shows

- total impressions, engagement velocity, activation rate
- momentum candles for recent tweet performance
- hashtag order book
- top-performing tweet signals with links back to X

## Data Source

By default the app reads live analytics JSON from:

`https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/apps/social-bot-engine/state/tweet-analytics.json`

Override with:

```bash
ANALYTICS_JSON_URL=https://your-domain-or-raw-json-url
```

If remote fetch fails, it falls back to local files when present:

- `apps/web/public/tweet-analytics.json`
- `../social-bot-engine/state/tweet-analytics.json`

## Local Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Deploy the repo root to Vercel. The root build script targets `apps/web`. Set `ANALYTICS_JSON_URL` only if you want a custom data endpoint.
