/**
 * Lists campaign slugs (directories under campaigns/ that have config.json).
 * Outputs a JSON array to stdout for use in CI matrix.
 */
import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(__dirname, "..", "..", "..");
const CAMPAIGNS_DIR = resolve(WORKSPACE_ROOT, "campaigns");

const slugs = readdirSync(CAMPAIGNS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(CAMPAIGNS_DIR, d.name, "config.json")))
  .map((d) => d.name)
  .sort();

console.log(JSON.stringify(slugs));
