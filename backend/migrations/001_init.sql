-- Google OAuth tokens. BetterHealth has one user, so this table holds
-- at most one row: id is always 1, and the CHECK enforces that.
CREATE TABLE google_tokens (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    refresh_token text NOT NULL,
    access_token text NOT NULL,
    expires_at timestamptz NOT NULL,
    scope text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per calender day.
CREATE TABLE daily_steps (
    date date PRIMARY KEY,
    steps integer,
    synced_at timestamptz NOT NULL DEFAULT now()
);