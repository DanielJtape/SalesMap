import { readFile } from "node:fs/promises";
import { readWorkbook } from "./importer.js";
import { openStore } from "./store.js";
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run import -- /path/to/workbook.xlsx");
const parsed = await readWorkbook(await readFile(file));
const store = process.env.DATABASE_URL
  ? await (
      await import("./postgres-store.js")
    ).openPostgresStore(process.env.DATABASE_URL)
  : openStore(process.env.DATA_DIR || "./data");
console.log({
  ...(await store.upsert(parsed.records)),
  skipped: parsed.skipped,
});
await store.db.close();
