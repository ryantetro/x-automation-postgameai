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

## Traffic Attribution

The dashboard now supports two attribution layers:

- redirect click metrics keyed by per-platform `trackingId`
- optional PostHog site metrics keyed by the same `tracking_id`

Optional env vars for site-traffic ingestion:

```bash
POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_PROJECT_API_KEY=phx_your_project_api_key
POSTHOG_PROJECT_ID=123456
```

When configured, the dashboard enriches posts with:

- landing visits
- unique visitors
- sessions
- engaged sessions
- signups started
- signups completed
- demo bookings
- trial starts
- purchases

The copyable destination-site integration spec lives at:

- `docs/social-traffic-attribution-integration.md`

## Local Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

Deploy the repo root to Vercel. The root build script targets `apps/web`. Set `ANALYTICS_JSON_URL` only if you want a custom data endpoint.
