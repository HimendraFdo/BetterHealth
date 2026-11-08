// Settings for talking to Google. They come from environment variables
// (backend/.env locally) so the client secret never lives in the code.
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  // Where Google sends the browser back after consent. Must match one of
  // the "Authorized redirect URIs" on the OAuth client exactly.
  redirectUri: string;
}

// Returns undefined when the Google settings are missing, so the server can
// still start (e.g. for /health or tests) before OAuth is configured.
export function loadGoogleConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleConfig | undefined {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return { clientId, clientSecret, redirectUri };
}
