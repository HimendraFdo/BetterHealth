import { readdir, readFile } from "node:fs/promises";
import { createPool } from "./db.js";

// backend/migrations/, found relative to this file. Works from both
// src/ (tsx) and dist/ (compiled), since both are one level below backend/.
const MIGRATIONS_DIR = new URL("../migrations/", import.meta.url);

const pool = createPool();
try {
  // The runner's own bookkeeping: which files have already run.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  // Sorted by name, so 001 runs before 002. That's why the numbers are padded.
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(new URL(file, MIGRATIONS_DIR), "utf8");
    // A transaction needs every statement on the same connection,
    // so borrow one from the pool instead of using pool.query.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (err) {
      // Undo everything this file did, so it isn't left half-applied.
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release(); // give the connection back to the pool
    }
  }
  console.log("Migrations up to date");
} finally {
  await pool.end(); // close all connections so the script can exit
}