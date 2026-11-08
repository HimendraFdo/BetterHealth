import { buildApp } from "./app.js";
import { loadGoogleConfig } from "./config.js";
import { FileTokenStore } from "./tokenStore.js";

// Config comes from environment variables so the same code runs on your
// laptop, the VPS, and the NUC with different settings.
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

const google = loadGoogleConfig();
const app = buildApp({
  google,
  tokenStore: new FileTokenStore(process.env.TOKEN_FILE ?? ".data/google-tokens.json"),
});

if (!google) {
  app.log.warn("GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI not set; Google routes are disabled");
}

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
