import type pg from "pg";
import type { StoredTokens, TokenStore } from "./tokenStore.js";

// The shape of a row from the google_tokens table. Postgres column names
// are snake_case, and pg turns timestamptz columns into JS Date objects.
interface TokenRow {
  refresh_token: string;
  access_token: string;
  expires_at: Date;
  scope: string;
}

export class PostgresTokenStore implements TokenStore {
  // The pool is passed in, not created here, so the whole app shares one.
  constructor(private readonly pool: pg.Pool) {}

  async load(): Promise<StoredTokens | undefined> {
    const { rows } = await this.pool.query<TokenRow>(
      "SELECT refresh_token, access_token, expires_at, scope FROM google_tokens WHERE id = 1",
    );
    const row = rows[0];
    if (!row) return undefined; // nobody has connected yet

    // Convert the database shape into the shape the rest of the app uses.
    return {
      refreshToken: row.refresh_token,
      accessToken: row.access_token,
      accessTokenExpiresAt: row.expires_at.getTime(),
      scope: row.scope,
    };
  }

  async save(tokens: StoredTokens): Promise<void> {
    // An upsert: insert the row the first time, overwrite it after that.
    await this.pool.query(
      `INSERT INTO google_tokens (id, refresh_token, access_token, expires_at, scope, updated_at)
       VALUES (1, $1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         refresh_token = EXCLUDED.refresh_token,
         access_token  = EXCLUDED.access_token,
         expires_at    = EXCLUDED.expires_at,
         scope         = EXCLUDED.scope,
         updated_at    = now()`,
      [tokens.refreshToken, tokens.accessToken, new Date(tokens.accessTokenExpiresAt), tokens.scope],
    );
  }
}