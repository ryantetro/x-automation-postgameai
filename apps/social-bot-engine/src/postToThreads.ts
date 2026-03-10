import { POST_ENABLED, THREADS_ACCESS_TOKEN, THREADS_GRAPH_API_VERSION } from "./config.js";

export type ThreadsPostResult = {
  success: boolean;
  error?: string;
  statusCode?: number;
  threadId?: string;
  creationId?: string;
};

interface GraphErrorPayload {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
}

interface ThreadsPublishingLimitEntry {
  quota_usage?: number;
  config?: {
    quota_total?: number;
    quota_duration?: number;
  };
}

function threadsEndpoint(path: string): string {
  return `https://graph.threads.net/${THREADS_GRAPH_API_VERSION}/${path}`;
}

async function getJson(
  path: string,
  params: URLSearchParams
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> & GraphErrorPayload }> {
  const response = await fetch(`${threadsEndpoint(path)}?${params.toString()}`, {
    method: "GET",
  });

  let json: Record<string, unknown> & GraphErrorPayload = {};
  try {
    json = (await response.json()) as Record<string, unknown> & GraphErrorPayload;
  } catch {
    json = {};
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

async function postForm(
  path: string,
  body: URLSearchParams
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> & GraphErrorPayload }> {
  const response = await fetch(threadsEndpoint(path), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  let json: Record<string, unknown> & GraphErrorPayload = {};
  try {
    json = (await response.json()) as Record<string, unknown> & GraphErrorPayload;
  } catch {
    json = {};
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

function formatThreadsError(
  payload: Record<string, unknown> & GraphErrorPayload,
  fallback: string
): string {
  const message = payload.error?.message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : fallback;
}

async function checkThreadsPublishingLimit(): Promise<ThreadsPostResult | null> {
  if (!THREADS_ACCESS_TOKEN) {
    return { success: false, error: "Missing Threads access token" };
  }

  const params = new URLSearchParams({
    fields: "quota_usage,config",
    access_token: THREADS_ACCESS_TOKEN,
  });
  const response = await getJson("me/threads_publishing_limit", params);
  if (!response.ok) {
    console.warn(
      "Threads publishing-limit preflight failed, continuing without quota check:",
      formatThreadsError(response.json, `HTTP ${response.status}`)
    );
    return null;
  }

  const rows = Array.isArray(response.json.data)
    ? (response.json.data.filter((row) => typeof row === "object" && row != null) as ThreadsPublishingLimitEntry[])
    : [];
  const current = rows[0];
  const quotaUsage = current?.quota_usage;
  const quotaTotal = current?.config?.quota_total;

  if (typeof quotaUsage === "number" && typeof quotaTotal === "number") {
    console.info(`Threads quota usage: ${quotaUsage}/${quotaTotal} posts in the last 24 hours`);
    if (quotaUsage >= quotaTotal) {
      return {
        success: false,
        statusCode: 429,
        error: `Threads publishing limit reached (${quotaUsage}/${quotaTotal} posts in the last 24 hours)`,
      };
    }
  }

  return null;
}

export async function postToThreads(text: string): Promise<ThreadsPostResult> {
  if (!POST_ENABLED) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    console.info("Dry run: would post to Threads:", preview);
    return { success: true };
  }

  if (!THREADS_ACCESS_TOKEN) {
    return { success: false, error: "Missing Threads access token" };
  }

  try {
    const quotaResult = await checkThreadsPublishingLimit();
    if (quotaResult) return quotaResult;

    const createBody = new URLSearchParams({
      media_type: "TEXT",
      text,
      access_token: THREADS_ACCESS_TOKEN,
    });
    const createResponse = await postForm("me/threads", createBody);
    if (!createResponse.ok) {
      return {
        success: false,
        statusCode: createResponse.status,
        error: formatThreadsError(createResponse.json, "Failed to create Threads post container"),
      };
    }

    const creationId = typeof createResponse.json.id === "string" ? createResponse.json.id : "";
    if (!creationId) {
      return {
        success: false,
        statusCode: createResponse.status,
        error: "Threads API did not return a creation id",
      };
    }

    const publishBody = new URLSearchParams({
      creation_id: creationId,
      access_token: THREADS_ACCESS_TOKEN,
    });
    const publishResponse = await postForm("me/threads_publish", publishBody);
    if (!publishResponse.ok) {
      return {
        success: false,
        creationId,
        statusCode: publishResponse.status,
        error: formatThreadsError(publishResponse.json, "Failed to publish Threads post"),
      };
    }

    const threadId = typeof publishResponse.json.id === "string" ? publishResponse.json.id : "";
    console.info("Posted to Threads successfully", threadId ? `(thread_id=${threadId})` : "");
    return { success: true, creationId, threadId: threadId || undefined };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("Failed to post to Threads:", err);
    return { success: false, error };
  }
}
