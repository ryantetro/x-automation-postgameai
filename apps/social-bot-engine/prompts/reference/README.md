# Prompt reference

Use this folder for example content that shapes the bot’s voice and prompt.

- **`example-tweets-golf-agent-pro.txt`** — Example tweets from the Golf Agent Pro bot. Use these to match tone, length, and structure when tuning the system prompt in `../system_prompt.txt`.
- **`example-tweets-coaching-tips.txt`** — Coaching-tip-first examples: lead with advice, then connect to postgame AI. Use for the current content strategy (no score recaps).
- **`industry-position.txt`** — Coach positioning, taglines, value points, and messaging angles. The system prompt is aligned with this so tweets match what postgame AI actually does (record postgame thoughts → we turn into player development, tracking, parent convos, etc.).

You can add more files (e.g. `good-tweets-postgame.txt`, `bad-examples.txt`) as you iterate. Reference them in the system prompt or copy representative lines into it.
