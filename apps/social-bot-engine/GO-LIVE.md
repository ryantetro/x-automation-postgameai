# Go live: postgame X bot

Steps to run the bot on a schedule and post to X (Twitter).

**You do not need Vercel (or any other host).** This bot runs on **GitHub Actions**: when the schedule hits (6am & 6pm ET), GitHub runs the script, it posts one tweet, and the job ends. There is no long‑running server — nothing to "deploy" or keep running 24/7.

---

## 1. Get X (Twitter) API access

- Go to [developer.twitter.com](https://developer.twitter.com) and create a project + app (or use an existing app).
- Ensure the app has **Read and Write** permissions (needed to post tweets).
- In the app’s **Keys and tokens** you need:
  - **API Key and Secret** → use as `X_CONSUMER_KEY` and `X_CONSUMER_SECRET`
  - **Access Token and Secret** (generate if needed) → use as `X_ACCESS_TOKEN` and `X_ACCESS_TOKEN_SECRET`

---

## 2. Get an OpenAI API key

- [platform.openai.com](https://platform.openai.com) → API keys → create a key.
- The bot uses it to generate tweet text. Store as `OPENAI_API_KEY`.

---

## 3. Put the code on GitHub

The bot runs on **GitHub Actions**, so the code must be in a GitHub repo.

**Option A — Bot as its own repo (simplest)**  
- Create a new repo on GitHub (e.g. `postgame-x-bot`).  
- From your machine, inside the `apps/postgame-x-bot` folder:
  ```bash
  cd apps/postgame-x-bot
  git init
  git add .
  git commit -m "Initial commit: postgame X bot"
  git remote add origin https://github.com/YOUR_ORG/postgame-x-bot.git
  git branch -M main
  git push -u origin main
  ```
  The workflow at `apps/postgame-x-bot/.github/workflows/post-daily.yml` will run from the repo root.

**Option B — Bot inside this workspace (x-automation)**  
- Create a repo for the whole workspace (e.g. `x-automation`).  
- From the workspace root:
  ```bash
  cd /path/to/x-automation
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/YOUR_ORG/x-automation.git
  git branch -M main
  git push -u origin main
  ```
  Then use the workflow at **`x-automation/.github/workflows/post-daily.yml`** (see step 4 below). That workflow runs the bot from the `apps/postgame-x-bot` subfolder.

---

## 4. Add GitHub Actions secrets and variables

In the GitHub repo: **Settings → Secrets and variables → Actions**.

**Secrets (required for posting)**  
Add these as **Repository secrets** (not variables):

| Secret name             | Value                          |
|-------------------------|---------------------------------|
| `X_CONSUMER_KEY`        | Your X app API key              |
| `X_CONSUMER_SECRET`     | Your X app API secret           |
| `X_ACCESS_TOKEN`        | Your X access token             |
| `X_ACCESS_TOKEN_SECRET`  | Your X access token secret      |
| `OPENAI_API_KEY`        | Your OpenAI API key             |

**Optional secret**  
- `API_SPORTS_KEY` — if you use API-Sports for live scores (otherwise ESPN fallback is used).

**Variables (optional)**  
Under **Variables** you can set:

- `TARGET_SPORT` — `auto` (default, rotates NBA/NFL/MLB/soccer by day), or `nba`, `nfl`, `mlb`, `soccer`.
- Posting: in CI (GitHub Actions) the bot always posts. Locally it always dry-runs unless you set `POST_ENABLED=true`.

---

## 5. Use the right workflow (if bot is inside a monorepo)

- If the **repo root is the bot** (you pushed only `apps/postgame-x-bot`):  
  The workflow in `apps/postgame-x-bot/.github/workflows/post-daily.yml` is used automatically. Skip to step 6.

- If the **repo root is the workspace** (e.g. `x-automation`) and the bot is in `apps/postgame-x-bot/`:  
  GitHub only runs workflows under the repo root’s `.github/workflows/`. So you need a workflow at the **root** that runs the bot in `apps/postgame-x-bot`. There is a root workflow at `x-automation/.github/workflows/post-daily.yml` that does this; if you don’t have it, copy the one from `apps/postgame-x-bot/.github/workflows/` into the root `.github/workflows/` and add `working-directory: apps/postgame-x-bot` to the steps that run `npm ci` and `npx tsx src/main.ts`.

---

## 6. Enable Actions and do a test run

- In the repo: **Actions** tab → select the workflow **“Post to X (6am & 6pm ET)”**.
- Use **Run workflow** (manual run) to trigger it once.
- Check the run logs: it should install deps, run the bot, and post one tweet (CI always posts).

---

## 7. Schedule

When everything works:

- The workflow is scheduled for **6am and 6pm ET** (11:00 and 23:00 UTC).
- It will post twice per day. Sport is chosen by day when `TARGET_SPORT=auto`.

---

## Quick checklist

- [ ] X app has Read and Write permission  
- [ ] All 5 X + OpenAI secrets added in GitHub (Settings → Secrets and variables → Actions)  
- [ ] Repo pushed (done if you used this workspace)  
- [ ] One successful manual run from the Actions tab (Run workflow)  
- [ ] Manual run from Actions tab succeeds (CI posts by default)  

**No Vercel or other deployment needed** — GitHub Actions runs the bot on schedule.

---

## Threads token automation

If you want Threads posting and Threads insights to keep working automatically, do this once:

1. Generate a fresh short-lived Threads token in Meta Graph API Explorer.
2. Exchange it for a long-lived token locally:
   ```bash
   THREADS_APP_SECRET=your_threads_app_secret \
   THREADS_SHORT_LIVED_ACCESS_TOKEN=your_short_lived_threads_token \
   npm run bot:threads:token:exchange
   ```
3. Copy the returned long-lived token into:
   - local `.env.local` as `THREADS_ACCESS_TOKEN`
   - the right campaign block inside GitHub Actions secret `BOT_CREDENTIALS_JSON`
4. Create one more GitHub Actions secret:
   - `THREADS_SECRET_ADMIN_TOKEN`
   - this should be a fine-grained GitHub PAT for this repo with repository `Secrets: Read and write`
5. Push the workflow at [refresh-threads-token.yml](../../.github/workflows/refresh-threads-token.yml).

After that, GitHub Actions will refresh every campaign `THREADS_ACCESS_TOKEN` found inside `BOT_CREDENTIALS_JSON` every Monday and overwrite the shared secret automatically.
