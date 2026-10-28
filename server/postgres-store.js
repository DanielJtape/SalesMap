import pg from "pg";
import { ukPostcode, compactPostcode, locatedAtPostcode } from "./postcodes.js";

// SQLite remains the local development store. Azure uses a managed PostgreSQL
// database rather than placing SQLite/WAL files on a network-mounted disk.
export async function openPostgresStore(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 15000,
  });
  pool.on("error", () =>
    console.error(
      "An idle database connection was lost. New requests will reconnect.",
    ),
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, record JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL, expires BIGINT NOT NULL);
  `);
  const prepare = (sql) => {
    let index = 0;
    const query = sql.replace(/\?/g, () => "$" + ++index);
    const rows = async (args) =>
      (await pool.query(query, args)).rows.map((row) =>
        row.expires ? { ...row, expires: Number(row.expires) } : row,
      );
    return {
      get: async (...args) => (await rows(args))[0],
      all: async (...args) => rows(args),
      run: async (...args) => pool.query(query, args),
    };
  };
  const all = async () =>
    (
      await pool.query(
        "SELECT record FROM accounts ORDER BY lower(record->>'company')",
      )
    ).rows.map((r) => r.record);
  const get = async (id) =>
    (await pool.query("SELECT record FROM accounts WHERE id=$1", [id])).rows[0]
      ?.record || null;
  const put = async (record) =>
    pool.query(
      "INSERT INTO accounts(id,record) VALUES($1,$2::jsonb) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
      [record.id, JSON.stringify(record)],
    );
  const upsert = async (records) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(647920)");
      const oldRecords = new Map(
        (
          await client.query(
            "SELECT id,record FROM accounts WHERE id=ANY($1::text[]) FOR UPDATE",
            [records.map((r) => r.id)],
          )
        ).rows.map((r) => [r.id, r.record]),
      );
      let added = 0,
        updated = 0;
      const merged = records.map((record) => {
        const old = oldRecords.get(record.id),
          next = { ...record };
        if (old) {
          updated++;
          if (next.latitude === null && old.latitude !== null) {
            for (const field of [
              "latitude",
              "longitude",
              "locationSource",
              "locationLabel",
            ])
              next[field] = old[field];
            next.country ||= old.country;
          }
        } else added++;
        return { id: next.id, record: next };
      });
      if (merged.length)
        await client.query(
          "INSERT INTO accounts(id,record) SELECT id,record FROM jsonb_to_recordset($1::jsonb) AS rows(id TEXT,record JSONB) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
          [JSON.stringify(merged)],
        );
      const total = Number(
        (await client.query("SELECT count(*) AS n FROM accounts")).rows[0].n,
      );
      await client.query("COMMIT");
      return { added, updated, total };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  const applyPostcodeLocations = async (updates) => {
    if (!updates.length) return 0;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = new Map(
        (
          await client.query(
            "SELECT id,record FROM accounts WHERE id=ANY($1::text[]) FOR UPDATE",
            [updates.map((r) => r.id)],
          )
        ).rows.map((r) => [r.id, r.record]),
      );
      const records = updates
        .filter(
          (update) =>
            current.has(update.id) &&
            ukPostcode(current.get(update.id)) ===
              compactPostcode(update.postcode),
        )
        .map((update) => ({
          id: update.id,
          record: locatedAtPostcode(current.get(update.id), update),
        }));
      if (records.length)
        await client.query(
          "UPDATE accounts SET record=items.record FROM jsonb_to_recordset($1::jsonb) AS items(id TEXT,record JSONB) WHERE accounts.id=items.id",
          [JSON.stringify(records)],
        );
      await client.query("COMMIT");
      return records.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
  return {
    db: { prepare, close: () => pool.end() },
    all,
    get,
    put,
    upsert,
    applyPostcodeLocations,
  };
}
