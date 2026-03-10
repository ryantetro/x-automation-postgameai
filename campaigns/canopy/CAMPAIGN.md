# Campaign: Vicious Shade Supply Co.

**Slug:** `canopy`
**Status:** In development
**Platforms:** X (Twitter)
**Data Source:** `angles_only` (no sports data; rotates through industry-specific content angles)

---

## Business

Vicious Shade Supply Co. sells premium custom canopies, pop-up banners, feather flags, step-and-repeat walls, and custom banners for businesses, event planners, and teams. The products are built for outdoor events, trade shows, vendor markets, race events, and festivals.

**Website:** [viciousshade.com](https://www.viciousshade.com)

## Goal

Build an organic X presence that positions Vicious Shade as the go-to source for durable, professional event branding. Posts should attract event planners, small business owners, sports teams, and anyone who needs outdoor branding that holds up and stands out.

The account should feel like a knowledgeable industry insider — someone who's been on the lot and knows what works — not a generic brand account pushing product.

## Content Strategy

### Voice
- Direct and practical. Say what people in the events/outdoor branding industry already know.
- Specific. Reference real situations: trade show setup, rain and wind, lead times, rush orders, game day tents.
- Earned authority. Sound like experience, not a marketing team.
- Light touch. One or two tight sentences. No lists, no "tips," no hard CTAs.
- Lead-gen framing: create interest and recognition, not ads. No hard CTAs like "reach out" or "get a quote."

### Content Pillars (11, rotated daily)

Angles are loaded from `campaigns/canopy/content-pillars.json` when present. Each pillar has a name, post ideas, example post, and target audiences. The bot rotates through pillars by day and injects 2–3 post ideas plus a target audience into the prompt.

1. **Event Marketing Strategy** — Booth tips, foot traffic, why booths fail, booth vs brand experience
2. **Brand Visibility Psychology** — Height, 3-second rule, visible from 100 feet, step-and-repeats
3. **Before/After Brand Transformations** — Visual case studies, invisible to busiest booth
4. **Event Booth Mistakes** — Tablecloth booths fail, garage sale look, trade show mistakes
5. **Industry Playbooks** — Real estate, dealerships, festivals, sports tournaments, boat shows, gyms, nonprofits
6. **Real-World vs Digital Marketing** — Experiential marketing comeback, show up in person
7. **Event ROI Education** — Turn event traffic into leads, measure ROI
8. **Photo Moment Marketing** — Photo walls, events as content factories
9. **Build in Public** — Sublimation, durability, behind-the-scenes printing
10. **Authority Positioning** — What we've learned, future of event marketing
11. **Local Business Marketing** — Farmers markets, community events, busiest booth

Target audiences (rotated and pillar-specific): corporate events, sports teams, small business owners, farmers market vendors, parades, real estate, festivals, gyms, nonprofits, and more.

### Post Structure
- 2 short sentences max before the brand tag
- Every post ends with: `Vicious Shade Supply Co. · viciousshade.com`
- No hashtag spam (zero or one max)
- No instructional tone ("Make sure you...", "You need to...")
- No generic brand speak ("premium quality", "best in class")

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
3. Angles are loaded from `campaigns/canopy/content-pillars.json` (11 pillars); each day gets one pillar by rotation
4. `main.ts` detects `DATA_SOURCE === "angles_only"` and uses the canopy generation path
5. `generatePostAnglesOnly()` uses the campaign system prompt (`campaigns/canopy/system_prompt.txt`) with the day's pillar, 2–3 post ideas, target audience, and a rotating context snippet (seasonality, events, audiences)
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

# Post for real
POST_ENABLED=true CAMPAIGN=canopy npm run bot:post:x
```

Credentials go in `.env.local` at the repo root, or pass via `BOT_CREDENTIALS_JSON`.

## Setup Checklist

See `SETUP.md` for the full step-by-step setup guide.
