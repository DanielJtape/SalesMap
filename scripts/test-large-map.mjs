import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { normalizeRecord } from "../server/importer.js";
const dir = mkdtempSync(join(tmpdir(), "salesmap-large-map-"));
const { app, store } = createApp({ dataDir: dir });
const accounts = Array.from({ length: 24048 }, (_, i) =>
  normalizeRecord({
    company: "Scale Account " + String(i).padStart(5, "0"),
    status: i % 5 ? "Acc" : "Prospect",
    manager: i % 2 ? "Alex" : "Sam",
    city: "Synthetic test city",
    postcode: "TEST " + i,
    ...(i < 15370
      ? {
          latitude: 49.9 + (i % 83) * 0.1,
          longitude: -6 + Math.floor(i / 83) * 0.04,
        }
      : {}),
  }),
);
store.upsert(accounts);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(base);
    await page.getByText("24,048", { exact: true }).first().waitFor();
    await page.waitForFunction(
      () => document.querySelector(".marker-cluster,.account-marker"),
      {},
      { timeout: 30000 },
    );
    assert.equal(
      await page.locator("h1").count(),
      1,
      "The app must remain mounted after loading saved locations.",
    );
    assert.deepEqual(errors, []);
    if (attempt === 1)
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".marker-cluster")].reduce(
            (sum, el) => sum + Number(el.textContent),
            0,
          ) +
            document.querySelectorAll(".account-marker").length ===
          15370,
        {},
        { timeout: 30000 },
      );
  }
  await page.getByRole("button", { name: "Prospects", exact: true }).click();
  await page.getByRole("button", { name: "Customers", exact: true }).click();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page
    .getByRole("button", { name: "Fit all filtered pins", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Scale Account 00000", exact: true })
    .click();
  await page.getByLabel("Account details", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close account details" }).click();
  await page.getByRole("combobox").first().selectOption("Alex");
  await page.getByRole("combobox").first().selectOption("All managers");
  await page.waitForFunction(() =>
    document.querySelector(".marker-cluster,.account-marker"),
  );
  await page
    .getByRole("button", { name: "Fit all filtered pins", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".marker-cluster")].reduce(
        (sum, el) => sum + Number(el.textContent),
        0,
      ) +
        document.querySelectorAll(".account-marker").length ===
      15370,
    {},
    { timeout: 30000 },
  );
  assert.deepEqual(errors, []);
  console.log(
    "Large-map browser regression passed: 24,048 accounts, 15,370 saved pins, reload, filters, fit and account details under 4× CPU throttling.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
}
