import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createApp } from "../server/app.js";
import { normalizeRecord, readWorkbook } from "../server/importer.js";

async function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "salesmap-test-"));
  const { app, store } = createApp({ dataDir: dir, ...options });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (
    path,
    { cookie, body, method = "GET", headers = {} } = {},
  ) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SalesMap-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  return {
    store,
    base,
    request,
    close: () => {
      server.closeAllConnections();
      server.close();
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function workbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Accounts");
  sheet.addRow([
    "Acc - Prospect",
    "Manager",
    "Company Name",
    "Street Address",
    "City",
    "Postcode",
    "Primary Tape Application",
    "Required Tape Specification",
  ]);
  sheet.addRow([
    "Acc",
    "Alex",
    "Test Account",
    "1 Example St",
    "London",
    "SW1A 1AA",
    "Painting",
    "High temperature",
  ]);
  sheet.addRow([
    "Acc",
    "Alex",
    "Test Account",
    "1 Example St",
    "London",
    "SW1A 1AA",
    "Packaging",
    "Waterproof",
  ]);
  sheet.addRow([
    "Prospect",
    "",
    "<script>alert(1)</script>",
    "",
    "Paris",
    "75001",
    "",
    "",
  ]);
  return wb.xlsx.writeBuffer();
}
test("workbook mapping preserves duplicate rows, specifications and stable re-import IDs", async () => {
  const parsed = await readWorkbook(await workbook());
  assert.equal(parsed.records.length, 3);
  assert.equal(new Set(parsed.records.map((r) => r.id)).size, 3);
  assert.equal(parsed.records[0].status, "Customer");
  assert.equal(parsed.records[1].specification, "Waterproof");
  assert.equal(parsed.records[2].status, "Prospect");
  assert.equal(parsed.records[2].manager, "Unassigned");
  assert.deepEqual(
    (await readWorkbook(await workbook())).records.map((r) => r.id),
    parsed.records.map((r) => r.id),
  );
});
test("normalization rejects invalid coordinates and supports CRM external IDs", () => {
  const a = normalizeRecord(
    { company: "Test", externalId: "123", latitude: "91", longitude: "2" },
    "hubspot",
  );
  assert.equal(a.latitude, null);
  assert.equal(
    a.id,
    normalizeRecord({ company: "Renamed", externalId: "123" }, "hubspot").id,
  );
  assert.equal(
    normalizeRecord({ company: "Valid", latitude: "0", longitude: "0" })
      .longitude,
    0,
  );
});
test("import HTTP endpoint, persistent reviewed coordinates and validation", async () => {
  const f = await fixture();
  try {
    const body = new FormData();
    body.append("file", new Blob([await workbook()]), "accounts.xlsx");
    const response = await fetch(f.base + "/api/import", {
      method: "POST",
      headers: { "X-SalesMap-Request": "1" },
      body,
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).added, 3);
    const records = (await f.request("/accounts")).body.accounts;
    const id = records.find((r) => r.company === "Test Account").id;
    assert.equal(
      (
        await f.request(`/accounts/${id}/location`, {
          method: "PATCH",
          body: { latitude: 999, longitude: 0 },
        })
      ).status,
      400,
    );
    const saved = await f.request(`/accounts/${id}/location`, {
      method: "PATCH",
      body: { latitude: 51.5, longitude: -0.12, country: "United Kingdom" },
    });
    assert.equal(saved.body.latitude, 51.5);
    const parsed = await readWorkbook(await workbook());
    assert.equal(f.store.upsert(parsed.records).added, 0);
    assert.equal(f.store.get(id).latitude, 51.5);
    assert.equal(
      (
        await f.request(`/accounts/${id}/geocode`, {
          method: "POST",
          body: { country: "United Kingdom" },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.request("/accounts/missing/location", {
          method: "PATCH",
          body: { latitude: 1, longitude: 2 },
        })
      ).status,
      404,
    );
  } finally {
    f.close();
  }
});
test("private account data, single-use invitations, viewer restrictions and immediate revocation", async () => {
  const f = await fixture({ password: "a-strong-admin-password" });
  try {
    assert.equal((await f.request("/accounts")).status, 401);
    assert.equal((await f.request("/team")).status, 401);
    assert.equal(
      (
        await f.request("/login", {
          method: "POST",
          body: { password: "wrong" },
        })
      ).status,
      401,
    );
    const login = await f.request("/login", {
      method: "POST",
      body: { password: "a-strong-admin-password" },
    });
    assert.equal(login.status, 200);
    assert.ok(login.cookie);
    const admin = login.cookie;
    const invite = await f.request("/team/invite", {
      method: "POST",
      cookie: admin,
      body: { email: "colleague@example.com" },
    });
    assert.equal(invite.status, 200);
    const joined = await f.request("/accept-invite", {
      method: "POST",
      body: { token: invite.body.token, password: "my-own-safe-password" },
    });
    assert.equal(joined.status, 200);
    const viewer = joined.cookie;
    assert.equal(
      (
        await f.request("/accept-invite", {
          method: "POST",
          body: { token: invite.body.token, password: "another-safe-password" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.request("/accounts", { cookie: viewer })).status,
      200,
    );
    assert.equal((await f.request("/team", { cookie: viewer })).status, 403);
    assert.equal(
      (await f.request("/import", { method: "POST", cookie: viewer })).status,
      403,
    );
    assert.equal(
      (
        await f.request("/login", {
          method: "POST",
          body: {
            email: "colleague@example.com",
            password: "my-own-safe-password",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request("/team/users/colleague%40example.com", {
          method: "DELETE",
          cookie: admin,
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/accounts", { cookie: viewer })).status,
      401,
    );
    const replacement = await f.request("/team/invite", {
      method: "POST",
      cookie: admin,
      body: { email: "colleague@example.com" },
    });
    assert.equal(
      (
        await f.request("/accept-invite", {
          method: "POST",
          body: {
            token: replacement.body.token,
            password: "replacement-safe-password",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request("/accounts", { cookie: viewer })).status,
      401,
    );
    assert.equal(
      (await f.request("/logout", { method: "POST", cookie: admin })).status,
      200,
    );
    assert.equal((await f.request("/accounts", { cookie: admin })).status, 401);
  } finally {
    f.close();
  }
});
test("mutations reject foreign origins and missing verification headers", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request("/team/invite", {
          method: "POST",
          body: { email: "a@b.com" },
          headers: { Origin: "https://foreign.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/team/invite", {
          method: "POST",
          body: { email: "a@b.com" },
          headers: { "X-SalesMap-Request": "" },
        })
      ).status,
      403,
    );
  } finally {
    f.close();
  }
});
test("global geocoding requires country and returns candidates without silently saving a pin", async () => {
  let calls = 0;
  const f = await fixture({
    geocodingKey: "test-only",
    fetcher: async (url) => {
      calls++;
      assert.equal(url.hostname, "api.opencagedata.com");
      assert.ok(url.searchParams.get("q").includes("France"));
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              geometry: { lat: 48.85, lng: 2.35 },
              formatted: "Paris, France",
              confidence: 5,
            },
          ],
        }),
      };
    },
  });
  try {
    const a = normalizeRecord({ company: "Test", city: "Paris" });
    f.store.upsert([a]);
    assert.equal(
      (
        await f.request(`/accounts/${a.id}/geocode`, {
          method: "POST",
          body: {},
        })
      ).status,
      400,
    );
    const result = await f.request(`/accounts/${a.id}/geocode`, {
      method: "POST",
      body: { country: "France" },
    });
    assert.equal(result.body.candidates[0].latitude, 48.85);
    assert.equal(calls, 1);
    assert.equal(f.store.get(a.id).latitude, null);
  } finally {
    f.close();
  }
});
test("production refuses an unprotected deployment", () => {
  const dir = mkdtempSync(join(tmpdir(), "salesmap-guard-"));
  try {
    assert.throws(
      () => createApp({ dataDir: dir, production: true }),
      /SALES_MAP_PASSWORD/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Azure Maps stays server-side, checks tile coordinates and returns geocoding candidates", async () => {
  const calls = [];
  const f = await fixture({
    mapsKey: "test-map-key",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url.hostname, "atlas.microsoft.com");
      assert.equal(options.headers["subscription-key"], "test-map-key");
      if (url.pathname === "/map/tile")
        return new Response(Buffer.from([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" },
        });
      if (url.pathname === "/map/attribution")
        return Response.json({ copyrights: ["© Test Map Provider"] });
      return Response.json({
        features: [
          {
            geometry: { type: "Point", coordinates: [2.35, 48.85] },
            properties: {
              address: { formattedAddress: "Paris, France" },
              confidence: "High",
            },
          },
        ],
      });
    },
  });
  try {
    const a = normalizeRecord({ company: "Azure Account", city: "Paris" });
    f.store.upsert([a]);
    assert.equal((await f.request("/accounts")).body.mapServiceAvailable, true);
    const tile = await fetch(f.base + "/api/map/tiles/4/8/5");
    assert.equal(tile.status, 200);
    assert.equal(tile.headers.get("content-type"), "image/png");
    assert.equal((await f.request("/map/tiles/4/99/5")).status, 400);
    assert.equal((await f.request("/map/tiles/no/8/5")).status, 400);
    const attribution = await f.request(
      "/map/attribution?zoom=4&bounds=-5,45,10,55",
    );
    assert.deepEqual(attribution.body.copyrights, ["© Test Map Provider"]);
    const result = await f.request(`/accounts/${a.id}/geocode`, {
      method: "POST",
      body: { country: "France" },
    });
    assert.equal(result.body.candidates[0].latitude, 48.85);
    assert.equal(result.body.candidates[0].confidence, 9);
    assert.equal(f.store.get(a.id).latitude, null);
    assert.ok(calls.every((c) => !c.url.searchParams.has("subscription-key")));
  } finally {
    f.close();
  }
});

test("Azure map tiles and attribution require sign-in", async () => {
  const f = await fixture({
    password: "map-private-test-password",
    mapsKey: "test-map-key",
  });
  try {
    assert.equal((await f.request("/map/tiles/4/8/5")).status, 401);
    assert.equal(
      (await f.request("/map/attribution?zoom=4&bounds=-5,45,10,55")).status,
      401,
    );
  } finally {
    f.close();
  }
});
