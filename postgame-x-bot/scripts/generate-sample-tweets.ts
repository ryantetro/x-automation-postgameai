/**
 * Generate 10 sample tweets (2–3 per sport) and print them. No posting.
 * Uses different angles per tweet so samples stay unique.
 * Usage: npx tsx scripts/generate-sample-tweets.ts
 */
import { getAngleForDate } from "../src/config.js";
import { fetchSportsData } from "../src/fetchData.js";
import { generatePost, fillFallbackTemplate } from "../src/generatePost.js";
import { isValidTweet } from "../src/validate.js";

const SPORTS = ["nba", "nfl", "mlb", "soccer"] as const;
const NUM_TWEETS = 10;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function minimalFallback(sport: string) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    sport,
    source: "none",
    date: today,
    games: [],
    summary: "No games today.",
    top_game: {},
  };
}

async function main() {
  console.log("Fetching data for all sports...\n");
  const dataBySport: Record<string, Awaited<ReturnType<typeof fetchSportsData>>> = {};
  for (const sport of SPORTS) {
    const data = await fetchSportsData(sport);
    dataBySport[sport] = data ?? minimalFallback(sport);
  }

  console.log("Generating 10 tweets...\n");
  console.log("--- Sample tweets ---\n");

  for (let i = 0; i < NUM_TWEETS; i++) {
    const sport = SPORTS[i % SPORTS.length];
    const fetched = dataBySport[sport]!;
    const date = new Date(Date.now() + i * ONE_DAY_MS);
    const angle = getAngleForDate(date);
    let text = await generatePost(fetched, 2, {
      angle,
      date: date.toISOString().slice(0, 10),
    });
    if (!text || !isValidTweet(text)) {
      text = fillFallbackTemplate(sport, fetched);
    }
    const len = text.length;
    console.log(`${i + 1}. [${sport.toUpperCase()}] (${len}/280) angle: ${angle.slice(0, 40)}...`);
    console.log(`${text}\n`);
  }

  console.log("--- Done ---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
