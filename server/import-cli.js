import { readFile } from "node:fs/promises";
import { readWorkbook } from "./importer.js";
import { openStore } from "./store.js";
const file = process.argv[2];
if (!file) throw new Error("Usage: npm run import -- /path/to/workbook.xlsx");
const parsed = await readWorkbook(await readFile(file));
const store = openStore(process.env.DATA_DIR || "./data");
console.log({ ...store.upsert(parsed.records), skipped: parsed.skipped });
store.db.close();
