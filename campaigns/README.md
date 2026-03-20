# Campaigns (multi-bot)

Each **campaign** is one X/Threads bot: one business, one account, one content profile.

- **One repo, one engine** — All bots share the same posting pipeline in `apps/social-bot-engine`.
- **One directory per campaign** — `campaigns/<slug>/` holds config and (optionally) prompts.
- **Per-campaign state** — Analytics and logs live under `state/<slug>/` so bots never overwrite each other.
- **Credentials per campaign** — Each bot uses its own X (and Threads) credentials, provided at run time (e.g. from `BOT_CREDENTIALS_JSON` or a vault).

## Layout

```
campaigns/
  README.md           # this file
  schema.json         # JSON schema for config.json (optional)
  postgame/           # postgame.ai sports bot
    config.json
  canopy/             # example: canopy/promo business (angles_only)
    config.json
    SETUP.md          # checklist to set up this bot
  <slug>/             # add more campaigns by adding a directory
    config.json
```

## Adding a new campaign

1. **Create** `campaigns/<slug>/config.json` (e.g. `campaigns/canopy/config.json`). Use `schema.json` or copy an existing config.
2. **Add credentials** for that campaign (see [Credentials](#credentials)).
3. **Set `postTargets`** in the campaign config to `["x"]`, `["threads"]`, or `["x","threads"]`.
4. **Run** the bot with `CAMPAIGN=<slug>` (and `BOT_CREDENTIALS_JSON` if using the JSON secret). CI uses a matrix over all campaigns in `campaigns/`.

No code changes required — the engine reads `config.json` and uses the slug for state and credentials.

## Config (`config.json`)

| Field | Required | Description |
|-------|----------|-------------|
| `slug` | no | Id; defaults to directory name. |
| `name` | yes | Display name (e.g. "Postgame AI", "Canopy Co"). |
| `brandName` | yes | Brand text in posts (e.g. "postgame AI"). |
| `brandWebsite` | yes | Domain (e.g. "getpostgame.ai"). |
| `clickTargetUrl` | yes | Where post links go (e.g. https://getpostgame.ai). |
| `postTargets` | no | `["x"]`, `["threads"]`, or `["x","threads"]`. Default `["x"]`. |
| `dataSource` | no | `"sports"` \| `"news"` \| `"angles_only"`. Default `"sports"` (postgame-style). |
| `trackingBaseUrl` | no | Base URL for click tracking (e.g. https://track.getpostgame.ai). |

Other env-only options (API keys, news config, etc.) stay in env or in the credentials blob for that campaign.

## Credentials

Each campaign needs its own X (and optionally Threads) credentials so each bot posts from the right account.

### Option A: Single JSON secret (good for tens of bots)

Store one GitHub (or other) secret, e.g. `BOT_CREDENTIALS_JSON`, as a JSON object keyed by campaign slug:

```json
{
  "postgame": {
    "X_APP_KEY": "...",
    "X_APP_SECRET": "...",
    "X_ACCESS_TOKEN": "...",
    "X_ACCESS_SECRET": "...",
    "OPENAI_API_KEY": "...",
    "API_SPORTS_KEY": "...",
    "NEWS_API_KEY": "..."
  },
  "canopy": {
    "X_APP_KEY": "...",
    "X_APP_SECRET": "...",
    "X_ACCESS_TOKEN": "...",
    "X_ACCESS_SECRET": "...",
    "OPENAI_API_KEY": "...",
    "THREADS_ACCESS_TOKEN": "..."
  }
}
```

At run time, set `CAMPAIGN=canopy` and `BOT_CREDENTIALS_JSON=<the whole JSON>`. The bootstrap code will pick `canopy` and set `process.env` from that object, including `THREADS_ACCESS_TOKEN` when the campaign uses Threads.

### Option B: Vault (recommended for 100+ bots)

Use Doppler, Infisical, or similar: one config per campaign (e.g. `project/x-bot`, config `canopy`). In CI, run with that config so only that campaign’s secrets are in env:

```yaml
- run: doppler run --project x-bot --config ${{ matrix.campaign }} -- npm run bot:post
```

No `BOT_CREDENTIALS_JSON` needed; each job gets only its campaign’s credentials.

## State and analytics

- **State directory:** `state/<slug>/` (e.g. `state/postgame/`, `state/canopy/`).
- **Files:** campaign-managed bots persist one analytics store file per run (default: `tweet-analytics.json`) plus `generation-log.jsonl`, etc., under that directory.
- Dual-platform campaigns store both `tweetId` and `threadsPostId` in the same campaign analytics store for that run.
- CI should persist and push only the analytics file for the campaign that ran (e.g. `state/${{ matrix.campaign }}/${ANALYTICS_STORE_FILENAME}`).

## Scheduling (CI)

Use one workflow with a **matrix** over campaigns so one run can post for many bots (e.g. 6am and 6pm ET for each):

- **Discover campaigns:** List `campaigns/*/` (or a `registry.json`) and pass the list into the matrix.
- **Per job:** Set `CAMPAIGN=${{ matrix.campaign }}`, provide credentials (JSON secret or vault), let the campaign config decide `postTargets`, run the bot once, then commit only `state/${{ matrix.campaign }}/...`.

See `.github/workflows/` for the shared matrix workflow.

### Per-Campaign Scheduling

By default, all campaign-managed bots share the same cron schedule defined in `post-daily-campaigns.yml`. This is the default scaling path for new campaigns.

If a campaign eventually needs a different schedule, treat that as an exception and add it later. Do not create a dedicated workflow just to enable Threads for a new campaign.
