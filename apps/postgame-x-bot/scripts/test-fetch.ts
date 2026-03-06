/**
 * Test fetchData (uses network: ESPN, optionally API-Sports).
 */
import { fetchSportsData } from "../src/fetchData.js";

async function main() {
  console.log("--- fetchData (NBA) ---");
  const data = await fetchSportsData("nba");
  if (!data) {
    console.log("  ✗ No data returned");
    process.exit(1);
  }
  console.log("  ✓ sport:", data.sport);
  console.log("  ✓ source:", data.source);
  console.log("  ✓ date:", data.date);
  console.log("  ✓ games count:", data.games?.length ?? 0);
  console.log("  ✓ summary:", (data.summary ?? "").slice(0, 60) + "...");
  console.log("\n--- fetchData (NFL) ---");
  const nfl = await fetchSportsData("nfl");
  if (nfl) {
    console.log("  ✓ sport:", nfl.sport, "source:", nfl.source, "games:", nfl.games?.length ?? 0);
  } else {
    console.log("  ✓ no NFL data (ok if no games today)");
  }
  console.log("\n--- fetchData (Soccer/MLS) ---");
  const soccer = await fetchSportsData("soccer");
  if (soccer) {
    console.log("  ✓ sport:", soccer.sport, "source:", soccer.source, "games:", soccer.games?.length ?? 0);
  } else {
    console.log("  ✓ no soccer data (ok if no games today)");
  }
  console.log("\n--- getSportForRun (rotation) ---");
  const { getSportForRun } = await import("../src/config.js");
  console.log("  ✓ today's sport:", getSportForRun());
  console.log("\n--- done ---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
