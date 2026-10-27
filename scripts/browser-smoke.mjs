import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { openStore } from "../server/store.js";
import { normalizeRecord } from "../server/importer.js";
const dir = mkdtempSync(join(tmpdir(), "salesmap-browser-"));
const store = openStore(dir);
store.upsert([
  normalizeRecord({
    company: "London Paintworks",
    status: "Acc",
    manager: "Alex Smith",
    street: "1 Example Street",
    city: "London",
    postcode: "SW1A 1AA",
    application: "Automotive masking",
    specification: "120°C heat resistance",
    latitude: 51.5074,
    longitude: -0.1278,
  }),
  normalizeRecord({
    company: "Paris Prospects",
    status: "Prospect",
    manager: "Sam Jones",
    city: "Paris",
    latitude: 48.8566,
    longitude: 2.3522,
  }),
  normalizeRecord({
    company: "Unmapped Opportunity",
    status: "Prospect",
    manager: "Alex Smith",
    city: "Berlin",
  }),
]);
store.db.close();
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["server/index.js"], {
  env: {
    ...process.env,
    DATA_DIR: dir,
    PORT: String(port),
    SALES_MAP_PASSWORD: "browser-test-admin-password",
    NODE_ENV: "development",
  },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.stack);
  });
  await page.goto(base);
  await page.getByRole("button", { name: "Administrator sign-in" }).click();
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-admin-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "London Paintworks", exact: true })
    .waitFor();
  await page.locator(".country-label").first().waitFor();
  const landPixels = await page
    .locator(".leaflet-overview-pane canvas")
    .evaluate((canvas) => {
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          data[i] === 240 &&
          data[i + 1] === 239 &&
          data[i + 2] === 227 &&
          data[i + 3] > 0
        )
          n++;
      return n;
    });
  assert.ok(
    landPixels > 1000,
    "The map must render real country outlines, not a blank background.",
  );
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.getByRole("button", { name: "Street map", exact: true }).click();
  await page
    .getByText(
      "Street tiles could not load. The offline country map is available.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.locator(".background-control button.active").innerText(),
    "Country overview",
  );
  await page.locator(".account-marker").first().click();
  await page.getByLabel("Account details", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close account details" }).click();
  await page.getByRole("button", { name: "Prospects", exact: true }).click();
  assert.equal(await page.locator(".account-card").count(), 2);
  await page.getByRole("combobox").first().selectOption("Alex Smith");
  assert.equal(await page.locator(".account-card").count(), 1);
  await page.getByRole("button", { name: /Unmapped Opportunity/ }).click();
  await page
    .getByRole("button", { name: "Enter coordinates manually" })
    .click();
  await page.getByLabel("Latitude", { exact: true }).fill("52.52");
  await page.getByLabel("Longitude", { exact: true }).fill("13.405");
  await page.getByRole("button", { name: "Save location" }).click();
  await page.getByText("Reviewed location", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close account details" }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: /London Paintworks/ }).click();
  await page.getByText("Automotive masking", { exact: true }).waitFor();
  await page.getByText("120°C heat resistance", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Close account details" }).click();
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByLabel("Colleague’s email").fill("viewer@example.com");
  await page.getByRole("button", { name: "Create invitation" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  await viewerPage.goto(link);
  await viewerPage
    .getByLabel("Create password (12+ characters)")
    .fill("viewer-test-password");
  await viewerPage.getByRole("button", { name: "Join workspace" }).click();
  await viewerPage
    .getByRole("heading", { name: "London Paintworks", exact: true })
    .waitFor();
  assert.equal(
    await viewerPage.getByRole("button", { name: "Import workbook" }).count(),
    0,
  );
  await viewerPage.getByRole("button", { name: /London Paintworks/ }).click();
  assert.equal(
    await viewerPage
      .getByRole("button", { name: "Enter coordinates manually" })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Close team access" }).click();
  await page.screenshot({ path: "/tmp/salesmap-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/salesmap-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: sign-in, filters, account details, saved pins, invitations, viewer permissions, and mobile layout.",
  );
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = new Promise((r) => child.once("exit", r));
    child.kill();
    await stopped;
  }
  rmSync(dir, { recursive: true, force: true });
}
