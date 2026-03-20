export type ThreadsTokenMode = "exchange" | "refresh";

interface ThreadsTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface ThreadsTokenResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  mode: ThreadsTokenMode;
}

function buildExchangeUrl(shortLivedAccessToken: string, appSecret: string): URL {
  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedAccessToken);
  return url;
}

function buildRefreshUrl(accessToken: string): URL {
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", accessToken);
  return url;
}

async function requestThreadsToken(mode: ThreadsTokenMode, url: URL): Promise<ThreadsTokenResult> {
  const response = await fetch(url, { method: "GET" });
  const payload = (await response.json()) as ThreadsTokenResponse;

  if (!response.ok || !payload.access_token || !payload.token_type || typeof payload.expires_in !== "number") {
    const message = payload.error?.message ?? `Threads token ${mode} request failed with status ${response.status}`;
    throw new Error(message);
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    mode,
  };
}

export async function exchangeThreadsToken(shortLivedAccessToken: string, appSecret: string): Promise<ThreadsTokenResult> {
  return requestThreadsToken("exchange", buildExchangeUrl(shortLivedAccessToken, appSecret));
}

export async function refreshThreadsToken(accessToken: string): Promise<ThreadsTokenResult> {
  return requestThreadsToken("refresh", buildRefreshUrl(accessToken));
}

export function maskThreadsToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}
