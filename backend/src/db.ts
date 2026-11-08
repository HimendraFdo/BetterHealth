import pg from "pg";

// Postgres type 1082 is DATE. By default pg converts it to a JS Date at
// local midnight, which time zones can shift to the previous day.
// Keep it as the plain "YYYY-MM-DD" string Postgres sends.
pg.types.setTypeParser(1082, (value) => value);

// A pool keeps a few connections open and lends them out per query,
// instead of opening a new connection for every request.
export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
    if (!connectionString) {
        throw new Error("DATABASE_URL environment variable is not set, check backend/.env.example");
    }
    return new pg.Pool({ connectionString });
}