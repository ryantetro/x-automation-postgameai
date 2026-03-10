/**
 * Entry point for engagement runs. Loads campaign config, then runs the engage flow.
 */
import { bootstrap } from "./bootstrap.js";

bootstrap();

const { runEngagement } = await import("./engage.js");

runEngagement()
  .then((result) => {
    if (result.skippedReason) {
      console.info(`Engagement skipped: ${result.skippedReason}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("Engagement failed:", err);
    process.exit(1);
  });
