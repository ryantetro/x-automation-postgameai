import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

const { parseCampaignCredentials, refreshCampaignThreadsTokens } = await import("./refresh-campaign-threads-tokens.ts");

let passed = 0;

function ok(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    });
}

console.log("--- campaign workflow / credential refresh ---");

await ok("campaign schema still allows x, threads, or both", () => {
  const schemaPath = resolve(WORKSPACE_ROOT, "campaigns", "schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as {
    properties?: { postTargets?: { items?: { enum?: string[] } } };
  };
  assert.deepEqual(schema.properties?.postTargets?.items?.enum, ["x", "threads"]);
});

await ok("shared campaign workflow no longer overrides postTargets globally", () => {
  const workflowPath = resolve(WORKSPACE_ROOT, ".github", "workflows", "post-daily-campaigns.yml");
  const workflow = readFileSync(workflowPath, "utf-8");
  assert.doesNotMatch(workflow, /POST_TARGETS:\s*\$\{\{\s*vars\.POST_TARGETS/i);
  assert.match(workflow, /STATE_FILE="\$\{STATE_DIR\}\/\$\{ANALYTICS_STORE_FILENAME\}"/);
});

await ok("campaign Threads refresh updates only campaigns that actually have tokens", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const token = url.searchParams.get("access_token") ?? "";
    return {
      ok: true,
      json: async () => ({
        access_token: `refreshed_${token}`,
        token_type: "bearer",
        expires_in: 7200,
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const credentials = parseCampaignCredentials(JSON.stringify({
      canopy: {
        X_APP_KEY: "x",
        THREADS_ACCESS_TOKEN: "canopy_token",
      },
      postgame: {
        X_APP_KEY: "y",
      },
    }));
    const result = await refreshCampaignThreadsTokens(credentials);
    const updated = JSON.parse(result.updatedCredentialsJson) as Record<string, Record<string, string>>;
    assert.equal(result.refreshedCampaigns.length, 1);
    assert.equal(result.refreshedCampaigns[0]?.campaign, "canopy");
    assert.equal(updated.canopy?.THREADS_ACCESS_TOKEN, "refreshed_canopy_token");
    assert.equal(updated.postgame?.THREADS_ACCESS_TOKEN, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n${passed} campaign checks passed`);
