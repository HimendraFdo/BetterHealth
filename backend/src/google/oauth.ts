import type { GoogleConfig } from "../config.js";
import type { StoredTokens, TokenStore } from "../tokenStore.js";

export const HEALTH_SCOPE =
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Refresh a little before the real expiry so a request never starts with a
// token that dies halfway through.
const EXPIRY_MARGIN_MS = 60_000;

// The URL we send the browser to so the user can approve access.
export function buildAuthUrl(config: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: HEALTH_SCOPE,
    // "offline" asks for a refresh token, so we can sync while you're away.
    access_type: "offline",
    // Google only hands out a refresh token on the first consent. Forcing the
    // consent screen means reconnecting always gives us a fresh one.
    prompt: "consent",
    // Random value we check on the way back, so another site can't trick
    // the browser into completing a login we never started (CSRF).
    state,
  });
  return `${AUTH_URL}?${params}`;
}

// Google's token endpoint response (only the fields we use).
interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export class GoogleAuthError extends Error {}

async function postToken(
  body: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    // The token endpoint takes form encoding, not JSON.
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    // e.g. {"error":"invalid_grant"} when a refresh token was revoked or
    // expired (7 days in Testing mode).
    throw new GoogleAuthError(`Token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

// Trade the one-time code from the callback for access + refresh tokens.
export async function exchangeCode(
  config: GoogleConfig,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<StoredTokens> {
  const data = await postToken(
    {
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    },
    fetchFn,
  );
  if (!data.refresh_token) {
    throw new GoogleAuthError("Google did not return a refresh token");
  }
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

// Returns a working access token, refreshing it first if it has expired.
// Google recommends refreshing on demand like this rather than in a batch job.
export async function getAccessToken(
  config: GoogleConfig,
  store: TokenStore,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const tokens = await store.load();
  if (!tokens) return undefined;

  if (tokens.accessTokenExpiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return tokens.accessToken;
  }

  const data = await postToken(
    {
      refresh_token: tokens.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    },
    fetchFn,
  );
  await store.save({
    // Google usually omits refresh_token here; keep the one we have.
    refreshToken: data.refresh_token ?? tokens.refreshToken,
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  });
  return data.access_token;
}
