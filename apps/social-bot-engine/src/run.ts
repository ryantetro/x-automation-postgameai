/**
 * Entry point that runs campaign bootstrap (config + credentials) before the bot.
 * Use this when running with CAMPAIGN=<slug> and/or BOT_CREDENTIALS_JSON.
 */
import { bootstrap } from "./bootstrap.js";

bootstrap();

await import("./main.js");
