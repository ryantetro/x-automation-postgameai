# Go live: postgame X bot

Steps to run the bot on a schedule and post to X (Twitter).

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
- From your machine, inside the `postgame-x-bot` folder:
  ```bash
  cd postgame-x-bot
  git init
  git add .
  git commit -m "Initial commit: postgame X bot"
  git remote add origin https://github.com/YOUR_ORG/postgame-x-bot.git
  git branch -M main
  git push -u origin main
  ```
  The workflow at `postgame-x-bot/.github/workflows/post-daily.yml` will run from the repo root.

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
  Then use the workflow at **`x-automation/.github/workflows/post-daily.yml`** (see step 4 below). That workflow runs the bot from the `postgame-x-bot` subfolder.

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
- `POST_ENABLED` — `true` (default) to actually post; `false` for dry runs from Actions.

---

## 5. Use the right workflow (if bot is inside a monorepo)

- If the **repo root is the bot** (you pushed only `postgame-x-bot`):  
  The workflow in `postgame-x-bot/.github/workflows/post-daily.yml` is used automatically. Skip to step 6.

- If the **repo root is the workspace** (e.g. `x-automation`) and the bot is in `postgame-x-bot/`:  
  GitHub only runs workflows under the repo root’s `.github/workflows/`. So you need a workflow at the **root** that runs the bot in `postgame-x-bot`. There is a root workflow at `x-automation/.github/workflows/post-daily.yml` that does this; if you don’t have it, copy the one from `postgame-x-bot/.github/workflows/` into the root `.github/workflows/` and add `working-directory: postgame-x-bot` to the steps that run `npm ci` and `npx tsx src/main.ts`.

---

## 6. Enable Actions and do a test run

- In the repo: **Actions** tab → select the workflow **“Post to X (6am & 6pm ET)”**.
- Use **Run workflow** (manual run) to trigger it once.
- Check the run logs: it should install deps, run the bot, and post one tweet (if `POST_ENABLED` is not set to `false`).

---

## 7. Schedule

When everything works:

- The workflow is scheduled for **6am and 6pm ET** (11:00 and 23:00 UTC).
- It will post twice per day. Sport is chosen by day when `TARGET_SPORT=auto`.

---

## Quick checklist

- [ ] X app has Read and Write permission  
- [ ] All 5 X + OpenAI secrets added in GitHub  
- [ ] Repo pushed (bot-only or workspace with root workflow)  
- [ ] One successful manual run from the Actions tab  
- [ ] `POST_ENABLED` is `true` (or unset) for live posting  
