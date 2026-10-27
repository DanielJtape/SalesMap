import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const { createApp } = await import("./app.js");
const storage = process.env.DATABASE_URL
  ? await (
      await import("./postgres-store.js")
    ).openPostgresStore(process.env.DATABASE_URL)
  : null;
if (process.env.WEBSITE_SITE_NAME && !process.env.DATABASE_URL)
  throw Error(
    "Azure App Service requires DATABASE_URL; do not use SQLite on its network storage.",
  );
const { app } = createApp({
  storage,
  mapsKey: process.env.MAPS_API_KEY || "",
  dataDir: process.env.DATA_DIR || "./data",
  password: process.env.SALES_MAP_PASSWORD || "",
  production: process.env.NODE_ENV === "production",
  geocodingKey: process.env.OPENCAGE_API_KEY || "",
  trustProxy: process.env.TRUST_PROXY === "1",
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () =>
  console.log(
    `SalesMap listening on port ${port}${process.env.SALES_MAP_PASSWORD ? " (team sign-in enabled)" : " (local development; set SALES_MAP_PASSWORD before sharing)"}`,
  ),
);
