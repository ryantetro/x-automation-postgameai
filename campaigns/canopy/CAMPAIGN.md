# Campaign: Vicious Shade Supply Co.

**Slug:** `canopy`
**Status:** In development
**Platforms:** X (Twitter)
**Data Source:** `angles_only` (no sports data; rotates through personality-first content angles)

---

## Business

Vicious Shade Supply Co. sells premium custom canopies, pop-up banners, feather flags, step-and-repeat walls, and custom banners for businesses, event planners, and teams. The products are built for outdoor events, trade shows, vendor markets, race events, and festivals.

**Website:** [viciousshade.com](https://www.viciousshade.com)

## Goal

Build an organic brand account people follow because it feels plugged into vendor life, event culture, booth taste, and local Utah happenings.

The account should feel like:
- a sharp booth critic
- a real vendor-world personality
- a local event insider
- a brand with taste, not a company begging for quotes

Direct selling is not the main goal. The main goal is attention, recognition, and personality. The products should show up as proof along the way.

## Content Strategy

### Voice
- Real, direct, a little opinionated
- Feels like vendor-world group chat energy, not brand copy
- Locally aware when useful, especially around Utah events and event season
- Funny sometimes, but never try-hard
- Proud of good setups and willing to call out bad ones

### Customer Profile Source

Audience assumptions for this campaign live in `campaigns/canopy/customer-profile.json`.

That file stores the current ideal-customer profile for:
- job titles and decision makers
- most likely company types
- company-size mix
- motivations and buying triggers
- common bundles and buying window

The posting bot pulls that data into the canopy prompt so the account writes with the right buyer worldview in mind, even when the post itself is culture-first instead of sales-first.

### Content Pillars (5, rotated daily)

Angles are loaded from `campaigns/canopy/content-pillars.json` when present. Each pillar has a name, post ideas, example post, and target audiences. The bot rotates through pillars by day and injects 2–3 post ideas plus a target audience into the prompt.

1. **Booth Identity and Setup Taste** — visual taste, first impressions, the difference between generic and intentional
2. **Vendor Life and Event Culture** — market mornings, setup chaos, weather, real event-day moments
3. **Utah Event Radar** — local events, seasonal calendars, fair and market energy, useful local awareness
4. **Booth Proof in the Wild** — product credibility shown through real use, not sales claims
5. **Hot Takes and Booth Glow-Ups** — booth opinions, contrast posts, customer setup features, shareable commentary

### Recurring Series

This campaign should behave like a repeatable media brand, not a rotating ad machine.

- **Vendor Life**: early load-in, parking lot chaos, event-day truths
- **Booth Hot Takes**: opinionated setup commentary and booth culture observations
- **Utah Event Radar**: upcoming fairs, expos, markets, and festivals worth attention
- **Booth Glow-Up**: customer features, before/after identity shifts, standout setups
- **Proof in the Wild**: wind, wear, real setup quality, small details people notice

### Content Mix

- 50-60% culture and personality
- 20-25% local and seasonal event content
- 10-15% community features and customer spotlights
- 10% or less overtly commercial content

The account should earn attention first, then remind people that Vicious Shade makes the kind of setups worth noticing.

### Post Structure
- 1-3 short sentences
- Brand tag is optional on conversational posts and should feel light when used
- Zero hashtags is fine; one is okay if it truly belongs
- No hard CTA language
- No generic marketing phrasing
- It is okay if the canopy is implied more than it is explained

### Platform Direction

- **X**: hot takes, local event observations, short vendor-life posts, booth commentary
- **Instagram**: carousels should become the main growth format
- **Carousel themes**:
  - "Types of booths at every market"
  - "What your booth setup says about your business"
  - "Best Utah events for vendors this month"
  - "Booth glow-up"
  - "White tent mistakes"
  - "Saturday market energy"

### Utah Event Content Workflow

The right way to use local events is as community value, not a disguised ad.

1. Find relevant Utah events for vendors, makers, festivals, expos, fairs, races, and community events
2. Save structured event data: title, date, city, category, source URL, flyer image if available
3. Draft one of three outputs:
   - local event radar post
   - event roundup carousel
   - booth-readiness or setup-angle post tied to that event type
4. Keep the event as the main story
5. Let Vicious Shade's taste and event expertise show up in the commentary

This should eventually run as a curated ingestion pipeline, not a blind flyer spammer.

### Image Generation
Enabled. Each post includes an AI-generated image showing canopy/banner products in either:
- **Product mock-up style** — camera specs (e.g. Canon EOS R5 50mm), studio window light, light grey seamless, fabric with visible weave and natural tension, **branding on peak and valance**
- **Lifestyle style** — camera specs (e.g. Sony A7III 35mm), natural daylight, shallow depth of field, candid event atmosphere, **branding on peak and valance**, industry-specific venues (festival, trade show, real estate open house, brewery, fitness bootcamp, farmers market, race/cycling event, step-and-repeat, local parade, nonprofit/charity booth)

Prompts avoid the “AI look” via camera/lens specificity, slight imperfections, and a shared negative prompt (“No illustration, no 3D render, no CGI…”). Scenes are keyed by the day’s content angle and mix camera angles (eye-level, three-quarter, wide from attendee POV, overhead/drone, close-up of branding).

**Reference image (optional):** In `image-prompts.json`, set `referenceImage` to a filename in `reference-images/` (e.g. `01-product-mockup-branded-canopy-white-bg.png`). The bot will send that image to the OpenAI Images Edit API with the scene prompt so the same product appears in different contexts; if the file is missing or the Edit API fails, it falls back to text-only generation.

See `reference-images/README.md` for prompt guidelines and reference photos.

## Technical Details

### How It Works
1. `CAMPAIGN=canopy` triggers `bootstrap.ts` which loads `campaigns/canopy/config.json`
2. Config sets brand name, website, data source (`angles_only`), and enables image generation
3. Angles are loaded from `campaigns/canopy/content-pillars.json` (5 pillars); each day gets one pillar by rotation
4. `main.ts` detects `DATA_SOURCE === "angles_only"` and uses the canopy generation path
5. `generatePostAnglesOnly()` uses the campaign system prompt (`campaigns/canopy/system_prompt.txt`) with the day's pillar, 2–3 post ideas, target audience, rotating context snippets, and the buyer profile from `campaigns/canopy/customer-profile.json`
6. `generateCampaignImage()` loads `campaigns/canopy/image-prompts.json` and picks a scene by angle index (11 scenes for 11 pillars)
7. Post is published to X with the image attached

### Credentials Required
| Key | Description |
|-----|-------------|
| `X_APP_KEY` | X API app key (for the Vicious Shade account) |
| `X_APP_SECRET` | X API app secret |
| `X_ACCESS_TOKEN` | X access token (generated for the posting account) |
| `X_ACCESS_SECRET` | X access token secret |
| `OPENAI_API_KEY` | OpenAI key (for text generation and image generation) |

No `API_SPORTS_KEY` or `NEWS_API_KEY` needed.

### State
- Analytics: `state/canopy/tweet-analytics.json`
- Generation log: `state/canopy/generation-log.jsonl`

### Running Locally
```bash
# Dry run (no post sent)
CAMPAIGN=canopy npm run bot:dry-run

# Generate a launch-audit batch and review the agent's planned mix
CAMPAIGN=canopy node --import tsx apps/social-bot-engine/scripts/canopy-launch-audit.ts

# Post for real
POST_ENABLED=true CAMPAIGN=canopy npm run bot:post:x
```

Credentials go in `.env.local` at the repo root, or pass via `BOT_CREDENTIALS_JSON`.

## Setup Checklist

See `SETUP.md` for the full step-by-step setup guide.
