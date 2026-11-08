import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// What we keep after the user connects their Google account.
export interface StoredTokens {
  // Long-lived: used to get new access tokens without the user present.
  refreshToken: string;
  // Short-lived (about an hour): sent with every Google Health API call.
  accessToken: string;
  // When the access token stops working, as milliseconds since 1970.
  accessTokenExpiresAt: number;
  scope: string;
}

// An interface lets the routes work with any storage. Tests use the memory
// version; Phase 2 will add a PostgreSQL version without touching the routes.
export interface TokenStore {
  load(): Promise<StoredTokens | undefined>;
  save(tokens: StoredTokens): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: StoredTokens | undefined;
  async load() {
    return this.tokens;
  }
  async save(tokens: StoredTokens) {
    this.tokens = tokens;
  }
}

// Temporary storage until Phase 2: a JSON file on disk, so the connection
// survives server restarts. The file holds a secret, so it is gitignored.
export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async load() {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredTokens;
    } catch (err) {
      // No file yet just means nobody has connected.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async save(tokens: StoredTokens) {
    await mkdir(dirname(this.path), { recursive: true });
    // mode 0o600: only the owner can read it (ignored on Windows).
    await writeFile(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }
}
