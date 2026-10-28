import { ukPostcode, compactPostcode, locatedAtPostcode } from "./postcodes.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, "salesmap.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, record TEXT NOT NULL);",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, hash TEXT NOT NULL, salt TEXT NOT NULL); CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL, expires INTEGER NOT NULL);",
  );
  const all = () =>
    db
      .prepare(
        "SELECT record FROM accounts ORDER BY json_extract(record,'$.company') COLLATE NOCASE",
      )
      .all()
      .map((r) => JSON.parse(r.record));
  const get = (id) => {
    const row = db.prepare("SELECT record FROM accounts WHERE id=?").get(id);
    return row ? JSON.parse(row.record) : null;
  };
  const put = (record) =>
    db
      .prepare(
        "INSERT INTO accounts(id,record) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record",
      )
      .run(record.id, JSON.stringify(record));
  function upsert(records) {
    let added = 0,
      updated = 0;
    db.exec("BEGIN");
    try {
      for (const record of records) {
        const old = get(record.id);
        if (old) {
          updated++;
          if (record.latitude === null && old.latitude !== null) {
            for (const field of [
              "latitude",
              "longitude",
              "locationSource",
              "locationLabel",
            ])
              record[field] = old[field];
            record.country ||= old.country;
          }
        } else added++;
        put(record);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return {
      added,
      updated,
      total: db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,
    };
  }
  function applyPostcodeLocations(updates) {
    let changed = 0;
    db.exec("BEGIN");
    try {
      for (const update of updates) {
        const current = get(update.id);
        if (
          !current ||
          ukPostcode(current) !== compactPostcode(update.postcode)
        )
          continue;
        put(locatedAtPostcode(current, update));
        changed++;
      }
      db.exec("COMMIT");
      return changed;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return { db, all, get, put, upsert, applyPostcodeLocations };
}
