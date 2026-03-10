# Campaign: Postgame AI

**Slug:** `postgame`
**Status:** Active (production)
**Platforms:** X (Twitter), Threads
**Data Source:** `sports` (live ESPN data + news articles)

---

## Business

Postgame AI is a tool that helps sports coaches turn postgame observations into organized development notes. It targets football, basketball, baseball, and soccer coaching staffs at every level.

**Website:** [getpostgame.ai](https://getpostgame.ai)

## Goal

Build an organic social presence that makes coaches feel seen. Posts should sound like a former coach turned analyst — someone who's been in the film room and knows the frustrations of postgame review. The account earns trust by describing real coaching tensions, not by selling product.

The long-term play: coaches screenshot these posts and send them to their staff group chat. That's the signal that content is working.

## Content Strategy

### Voice
- Former coach turned analyst. Hard-edged, specific, direct.
- Describe, never prescribe. Posts observe coaching tensions — they don't give advice.
- Screenshot-worthy. Every post should feel like it belongs in a staff group chat.
- Light brand touch. The product mention is one line at the end, never the point.

### Content Architecture
Posts are built from three layers, selected algorithmically each run:

**Frames** (the lens):
- The 48-Hour Window — urgency of postgame review before insights fade
- Film Room Truth — what film reveals that the box score hides
- Development Gap — where talent meets (or misses) execution
- Moment Nobody Captures — plays/possessions that vanish from memory
- Scoreboard Lie — when the final score hides the real story
- Conversation That Doesn't Happen — what coaches mean to say but don't

**Hook Structures** (the opening pattern):
- Scene-Setter — temporal or situational opening ("After the final whistle...")
- Specific Number — leads with a stat or count ("3 plays changed everything")
- Named Moment — references a specific game moment ("The timeout nobody talks about")
- Universal Truth — earned coaching observation ("Every coach has felt this")
- Insider Divide — coaches vs fans perspective gap
- Contradiction — tension between appearance and reality

**Emotion Targets:** frustration, validation, insider pride, loss, urgency, provocation, vulnerability

### News Integration
When a relevant sports headline is available, the bot uses it as the hook — not the subject. The headline is the excuse to post; the real content is the coaching truth it reveals. News is sourced via NewsAPI, filtered by sport and relevance score.

### Sport Rotation
Rotates daily: NFL, NBA, MLB, Soccer (MLS). Can be overridden with `TARGET_SPORT`.

### Post Structure
- 2 short sentences max before the brand tag
- Every post ends with: `postgame AI · getpostgame.ai`
- No hashtag spam
- No instructional tone
- No marketing copy ("helps you", "actionable insights", "seamlessly")

## Technical Details

### How It Works
1. `getSportForRun()` picks today's sport from the rotation
2. `fetchSportsData()` pulls live scores/games from ESPN
3. `fetchNewsContext()` finds a relevant headline via NewsAPI
4. `selectContentDecision()` picks frame + hook + emotion based on news moment type and recent post history
5. `generatePost()` sends the full prompt to the LLM with frame/hook/archetype guidance
6. Pre-publish checks validate hook structure, advice drift, opener variety, headline reference
7. If all checks pass, post is published to X and/or Threads
8. Analytics are recorded and used for iteration guidance on future posts

### Pre-Publish Checks
Every LLM output is validated before publishing:
- **Hook detected** — opening must match the assigned hook structure pattern
- **Advice drift** — no instructional language ("coaches need to", "record your thoughts")
- **Opener variety** — no repeated opening patterns from recent posts
- **Headline reference** — when news is used, post must reference specific terms from the headline
- **Ad tone** — no marketing copy or banned phrases
- **Length** — must fit within platform character limits

Failed checks trigger targeted followup prompts. On the final attempt, hook and headline checks are relaxed to prevent unnecessary fallbacks.

### Credentials Required
| Key | Description |
|-----|-------------|
| `X_APP_KEY` | X API app key |
| `X_APP_SECRET` | X API app secret |
| `X_ACCESS_TOKEN` | X access token |
| `X_ACCESS_SECRET` | X access token secret |
| `OPENAI_API_KEY` | OpenAI key for text generation |
| `API_SPORTS_KEY` | API-Sports key (optional; ESPN is primary) |
| `NEWS_API_KEY` | NewsAPI key for headline sourcing |
| `THREADS_ACCESS_TOKEN` | Threads/Meta access token (if posting to Threads) |

### State
- X analytics: `state/postgame/tweet-analytics.json` (or `apps/social-bot-engine/state/tweet-analytics.json` for legacy)
- Threads analytics: `state/postgame/threads-analytics.json`
- Generation log: `state/postgame/generation-log.jsonl`

### Running Locally
```bash
# Dry run
CAMPAIGN=postgame npm run bot:dry-run

# Or without campaign flag (uses defaults, which are postgame)
npm run dry-run --workspace @x-automation/social-bot-engine

# Post for real
POST_ENABLED=true CAMPAIGN=postgame npm run bot:post:x
```
