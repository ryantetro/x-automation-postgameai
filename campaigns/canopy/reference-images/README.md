# Canopy image reference (Vicious Shade style)

Reference photos for AI image prompt design and for **reference-image generation**.

- **Prompt design:** These images show the types of mock-ups and visuals the business creates; they inform the scene and suffix text in `campaigns/canopy/image-prompts.json`.
- **Reference-image generation:** When `referenceImage` is set in `image-prompts.json` (e.g. `"referenceImage": "01-product-mockup-branded-canopy-white-bg.png"`), the bot sends that file to the OpenAI Images **Edit** API along with the scene prompt, so the model can place the same product in different scenes (festival, trade show, market, etc.). If the reference file is missing or the Edit API fails, the bot falls back to **Generate** (text-only prompt).

## Product lineup (for prompt writing)

- **Custom canopies** – Branded event space; durable, eye-catching; trade shows, markets, festivals, outdoor events.
- **Pop-up banners** – Lightweight, portable; promotions, displays, quick setup at events.
- **Step & repeat walls** – Photo ops, brand exposure, sponsorship displays, professional backdrop.
- **Custom banners** – Outdoor advertising, promotions, event branding.

**Settings to show:** Trade show booth, vendor market, race event, festival, outdoor promotion.  
**Qualities:** Built for durability, designed to stand out, customized for your brand.

## Files

| File | Style | Use in prompts |
|------|--------|-----------------|
| `01-product-mockup-branded-canopy-white-bg.png` | Single branded pop-up canopy on **clean white/studio background**. Black canopy, visible metal frame, branding on roof and valance. Product catalog / e‑commerce style. | Product mock-up, clean background, no environment, focus on tent structure and branded fabric. |
| `02-product-mockup-10x20-canopy-walls-valance.png` | **10x20-style** canopy with side walls and valances, full custom branding. Clean white background. Shows frame, walls, valance branding. | Larger setup mock-up, walls and valances, professional catalog look. |
| `03-lifestyle-feather-flags-event-context.png` | **Lifestyle / in-context**: feather flags and teardrop flags at an event (e.g. golf course). Product in use, natural setting, clear sky. | Lifestyle shots, flags or canopy at real event, outdoor venue, “product in context.” |
| `04-lifestyle-feather-flags-teardrop.png` | Teardrop-shaped promotional flags on lawn, residential/mountain background, people setting up. | Feather/teardrop flags, portable setup, outdoor promo. |
| `05-lifestyle-branded-canopy-event-tables.png` | Branded canopy at outdoor event (e.g. cycling league), tables and chairs underneath, multiple canopies in scene. | Event staging, vendor row, branded tent with furniture. |
| `06-lifestyle-branded-canopy-product-display.png` | Branded canopy with product table (e.g. helmets), clean grass, tree line. | Canopy as retail/vendor hub, product display under tent. |
| `07-lifestyle-canopy-bike-event.png` | Canopy at cycling event (e.g. Bike Peddler), bikes and repair stand, active outdoor event. | Mobile shop, bike event, canopy as central hub. |
| `08-lifestyle-branded-canopy-outdoor-hills.png` | Branded canopy in arid/grassy field, hills in background. | Outdoor event in natural terrain, team/school branding. |

## Prompt guidelines (from these references)

- **Show branding:** Prompts describe a “clean professional business logo on the peak panel and valance” so generated images show customization, not blank tents.
- **Camera and realism:** Suffixes include camera/lens (e.g. Canon EOS R5 50mm, Sony A7III 35mm), natural lighting, and slight imperfections (fabric creasing near frame joints, grass wear under legs, leaves on ground) to reduce an “AI look.”
- **Anti-AI line:** A shared `negativePrompt` in `image-prompts.json` is appended to every prompt (e.g. “No illustration, no 3D render, no CGI, no oversaturated”).
- **Product mock-up:** Studio window light, light grey seamless, polyester fabric with visible weave, anodized aluminum frame. Focus on tent structure and branded fabric.
- **Lifestyle:** Natural daylight, shallow depth of field, candid event atmosphere, industry-specific venues (real estate open house, brewery tasting, fitness bootcamp, farmers market, trade show, race/cycling event, step-and-repeat).
- **Angles:** Mix eye-level medium, three-quarter view, wide shot from attendee POV, overhead/drone-style, close-up of valance and peak branding.
