# Canopy bot setup

Use this checklist to get the canopy X bot running for your dad’s business (canopies, flags, outdoor promo).

---

## 1. Update campaign config

Edit **`campaigns/canopy/config.json`** with real values:

| Field | What to set |
|-------|---------------------|
| `name` | Display name (e.g. the business name). |
| `brandName` | Exact brand text that must appear in every post (e.g. "Canopy Co" or the real business name). |
| `brandWebsite` | Domain only, no https (e.g. `yourcanopy.com`). |
| `clickTargetUrl` | Full URL where post links should go (e.g. `https://yourcanopy.com` or a one-pager). |

Leave `postTargets` and `dataSource` as-is unless you want Threads too or a different content source.

---

## 2. X (Twitter) credentials for the canopy account

The bot must post **from the business X account** (not your personal or postgame account).

1. Go to [developer.twitter.com](https://developer.twitter.com) and sign in with **that** account (or create a project under the same developer account).
2. Create an app (or use an existing one) with **Read and Write** permissions.
3. In **Keys and tokens** get:
   - **API Key and Secret** → `X_APP_KEY`, `X_APP_SECRET`
   - **Access Token and Secret** (generate for the same account) → `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`

---

## 3. OpenAI API key

The bot uses OpenAI to generate post text. Use an existing key or create one at [platform.openai.com](https://platform.openai.com) → API keys. One key can be shared across bots if you prefer.

---

## 4. Run locally (dry run first)

From the repo root:

```bash
# Dry run (no real post) — uses .env.local for credentials
CAMPAIGN=canopy npm run bot:dry-run
```

**For this to work**, either:

- **Option A:** Put the canopy credentials in **`.env.local`** at the repo root when you want to run canopy:
  ```env
  # When running CAMPAIGN=canopy, these override so the bot posts as the canopy account
  X_APP_KEY=...
  X_APP_SECRET=...
  X_ACCESS_TOKEN=...
  X_ACCESS_SECRET=...
  OPENAI_API_KEY=...
  ```
  Then run: `CAMPAIGN=canopy npm run bot:dry-run`

- **Option B:** Use the shared **`BOT_CREDENTIALS_JSON`** secret (see below) and pass it when running locally (e.g. `BOT_CREDENTIALS_JSON='{"canopy":{...}}' CAMPAIGN=canopy npm run bot:dry-run`). Usually Option A is easier for local.

Check the log: you should see one generated post with your `brandName` and `brandWebsite` in it. No tweet is sent until you run with posting enabled.

---

## 5. Post for real (local)

When the dry-run output looks good:

```bash
POST_ENABLED=true CAMPAIGN=canopy npm run bot:post:x
```

This posts **one** tweet to the account whose credentials are in env (or in `BOT_CREDENTIALS_JSON` for `canopy`).

---

## 6. Schedule with GitHub Actions (all campaigns)

To run the canopy bot on the same schedule as other campaigns (e.g. 6am & 6pm ET):

1. Add the **canopy** credentials to the **`BOT_CREDENTIALS_JSON`** GitHub secret. That secret is one JSON object keyed by campaign slug, for example:
   ```json
   {
     "postgame": { "X_APP_KEY": "...", "X_APP_SECRET": "...", "X_ACCESS_TOKEN": "...", "X_ACCESS_SECRET": "...", "OPENAI_API_KEY": "...", "API_SPORTS_KEY": "...", "NEWS_API_KEY": "..." },
     "canopy": {
       "X_APP_KEY": "...",
       "X_APP_SECRET": "...",
       "X_ACCESS_TOKEN": "...",
       "X_ACCESS_SECRET": "...",
       "OPENAI_API_KEY": "..."
     }
   }
   ```
   (Canopy doesn’t need `API_SPORTS_KEY` or `NEWS_API_KEY`.)

2. The workflow **Post to X (all campaigns)** (`.github/workflows/post-daily-campaigns.yml`) discovers all campaigns under `campaigns/` and runs the bot for each. So once `canopy` is in that JSON, it will run on the same schedule and post from the canopy account.

3. State for canopy is stored in **`state/canopy/tweet-analytics.json`** and is committed by that workflow.

---

## Summary

| Step | What you do |
|------|-------------|
| 1 | Edit `campaigns/canopy/config.json` with real business name, website, and link URL. |
| 2 | Get X API keys for the **canopy business account**. |
| 3 | Have an OpenAI API key. |
| 4 | Run `CAMPAIGN=canopy npm run bot:dry-run` with those credentials in `.env.local` (or in `BOT_CREDENTIALS_JSON`). |
| 5 | Run `POST_ENABLED=true CAMPAIGN=canopy npm run bot:post:x` to post once. |
| 6 | Add `canopy` to the `BOT_CREDENTIALS_JSON` GitHub secret and rely on **Post to X (all campaigns)** for the schedule. |

If something fails (e.g. "Missing required env vars" or "Validation failed"), check that the env (or the `canopy` block in `BOT_CREDENTIALS_JSON`) has all four X keys plus `OPENAI_API_KEY`, and that `brandName` and `brandWebsite` in config match what you want in the posts (validation requires both to appear in every post).
