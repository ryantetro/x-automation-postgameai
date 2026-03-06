/**
 * Quick tests for validate and config (no network).
 */
import { isValidTweet } from "../src/validate.js";
import { validateConfig, MAX_TWEET_LEN } from "../src/config.js";

let passed = 0;
let failed = 0;

function ok(name: string, condition: boolean) {
  if (condition) {
    console.log("  ✓", name);
    passed++;
  } else {
    console.log("  ✗", name);
    failed++;
  }
}

console.log("--- validate.ts ---");
ok("isValidTweet(null) === false", isValidTweet(null) === false);
ok("isValidTweet('') === false", isValidTweet("") === false);
ok("isValidTweet('hi') === false (no brand)", isValidTweet("hi") === false);
ok("isValidTweet(long no brand) === false", isValidTweet("x".repeat(100)) === false);
ok("isValidTweet(over 280 with brand) === false", isValidTweet("postgame.ai " + "x".repeat(270)) === false);
ok("isValidTweet(valid tweet) === true", isValidTweet("Great game! postgame AI has the breakdown — getpostgame.ai #NBA") === true);
ok("MAX_TWEET_LEN === 280", MAX_TWEET_LEN === 280);

console.log("\n--- config ---");
const missing = validateConfig({ requireOpenai: true, requireX: false, requireApiSports: false });
ok("validateConfig returns array", Array.isArray(missing));
console.log("  (missing for full run:", missing.join(", ") || "none", ")");

console.log("\n--- result ---");
console.log(passed, "passed,", failed, "failed");
process.exit(failed > 0 ? 1 : 0);
