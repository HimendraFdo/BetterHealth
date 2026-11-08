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
// version; the server uses PostgresTokenStore.
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
