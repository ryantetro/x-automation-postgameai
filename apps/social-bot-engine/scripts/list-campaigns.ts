/**
 * Lists campaign slugs (directories under campaigns/ that have config.json).
 * Outputs a JSON array to stdout for use in CI matrix.
 * Excludes slugs that are scheduled by legacy workflows (post-daily-x, post-daily-threads)
 * so we don't double-post to the same account.
 */
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..", "..", "..");
const CAMPAIGNS_DIR = resolve(WORKSPACE_ROOT, "campaigns");

/** Campaigns that use post-daily-x / post-daily-threads instead of post-daily-campaigns. */
const SCHEDULED_BY_LEGACY_WORKFLOWS = new Set(["postgame"]);

const slugs = readdirSync(CAMPAIGNS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(CAMPAIGNS_DIR, d.name, "config.json")))
  .map((d) => d.name)
  .filter((slug) => !SCHEDULED_BY_LEGACY_WORKFLOWS.has(slug))
  .sort();

console.log(JSON.stringify(slugs));
