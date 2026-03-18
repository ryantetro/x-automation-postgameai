# Vicious Shade Personality-First Content System

## Purpose

This campaign should stop acting like a light ad bot and start acting like a brand account with taste, point of view, and local relevance.

The test is simple:
- Would a vendor follow this account even if they were not buying this month?
- Would they send a post to another vendor because it was funny, true, or useful?

If the answer is no, the content is still too commercial.

## Brand Position

Vicious Shade is not just "a canopy company."

It should feel like:
- the booth brand that understands vendor life
- the account with the best setup opinions
- the local event brand that knows what is happening in Utah
- the people who appreciate a clean booth and quietly judge a sloppy one

## Personality

- Real
- Slightly opinionated
- Community-first
- Local when useful
- Proud of good setups
- Never corporate

## Core Series

### 1. Vendor Life
- load-in mornings
- market chaos
- wind, weather, setup drama
- the emotional reality of event season

### 2. Booth Hot Takes
- setup opinions
- what looks cheap vs what looks intentional
- tablecloth booth commentary
- screenshot-worthy takes

### 3. Utah Event Radar
- upcoming fairs, expos, markets, festivals, races
- city-specific event roundups
- seasonal "where vendors should be looking"

### 4. Booth Glow-Up
- customer features
- before and after comparisons
- stronger identity without hard selling

### 5. Proof in the Wild
- durability, frame quality, print quality, weather performance
- product shown through context instead of claims

## Carousel Strategy

Carousels should become the main Instagram growth format because they are naturally more saveable and shareable than short text posts.

Recommended recurring carousel formats:
- "Types of vendors at every market"
- "What your booth setup says about your business"
- "Best Utah events for vendors this month"
- "Booth glow-up: from generic to legit"
- "White tent mistakes"
- "Outdoor event truths nobody talks about"

Carousel rule:
- Teach, entertain, or validate first
- Product can appear in the visuals, examples, or final slide
- Avoid ending every carousel with a pitch

## Utah Event Workflow

### Goal

Use local event content to make the brand relevant and useful.

### Source types

- farmers markets
- county fairs
- maker markets
- expos
- races
- community festivals
- trade shows
- holiday markets

### Data to capture

- event title
- start and end date
- city
- venue
- event type
- indoor or outdoor
- vendor relevance
- source URL
- flyer image URL if available

### Output formats

- single "event radar" post
- weekly roundup carousel
- "if you are doing this kind of event, your booth should solve this problem" post

### Guardrails

- do not blindly repost flyers
- do not pretend every event mention needs a sales angle
- the event is the value; booth commentary is the brand layer
- human review is better than full autopilot

## Suggested Build Order

1. Fix prompt and pillar strategy
2. Create a repeatable carousel calendar
3. Add Utah event ingestion into structured JSON
4. Generate draft posts and carousels from those events
5. If the workflow becomes complex, add an MCP layer later

## MCP Recommendation

Do not start with MCP.

Start with:
- a small crawler or importer
- a normalized event store
- a drafting step for posts and carousels

Add MCP only if we want reusable tools like:
- `list_upcoming_utah_events`
- `get_event_flyer`
- `draft_utah_event_post`
- `draft_utah_event_carousel`
