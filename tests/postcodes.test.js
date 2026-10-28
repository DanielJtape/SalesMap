import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../server/store.js";
import { normalizeRecord } from "../server/importer.js";
import { postcodeLookup, ukPostcode } from "../server/postcodes.js";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "salesmap-postcodes-"));
  const store = openStore(dir);
  return {
    store,
    close() {
      store.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const record = (company, postcode, country = "") =>
  normalizeRecord({ company, postcode, country });
const point = (
  query,
  postcode = "SW1A 1AA",
  latitude = 51.501,
  longitude = -0.141,
) => ({ query, result: { postcode, latitude, longitude } });

test("postcode eligibility handles spacing and explicit countries without altering existing coordinates", () => {
  assert.equal(ukPostcode(record("UK", "sw1a 1aa")), "SW1A1AA");
  assert.equal(ukPostcode(record("UK", "SW1A1AA", "France")), null);
  assert.equal(ukPostcode(record("UK", "75001")), null);
  assert.equal(
    ukPostcode({ ...record("Known", "SW1A1AA"), latitude: 51 }),
    null,
  );
});
test("bulk lookup deduplicates requests, sends only postcodes, labels approximate pins and leaves unmatched records unlocated", async () => {
  const f = setup();
  try {
    const a = record("First", "SW1A 1AA"),
      b = record("Second", "SW1A1AA"),
      c = record("Unknown", "M1 1AA"),
      d = record("Foreign", "SW1A1AA", "France"),
      e = {
        ...record("Reviewed", "SW1A1AA"),
        latitude: 52,
        longitude: -1,
        locationSource: "Reviewed location",
      };
    f.store.upsert([a, b, c, d, e]);
    let calls = 0;
    const job = postcodeLookup({
      store: f.store,
      delayMs: 0,
      fetcher: async (url, options) => {
        calls++;
        assert.equal(url, "https://api.postcodes.io/postcodes");
        const sent = JSON.parse(options.body);
        assert.deepEqual(Object.keys(sent), ["postcodes"]);
        assert.deepEqual(sent.postcodes.sort(), ["M11AA", "SW1A1AA"]);
        return Response.json({
          result: [point("SW1A1AA"), { query: "M11AA", result: null }],
        });
      },
    });
    await job.start();
    await job.wait();
    assert.equal(calls, 1);
    assert.equal(job.status().status, "completed");
    assert.equal(job.status().locatedAccounts, 2);
    assert.equal(job.status().unmatchedAccounts, 1);
    assert.equal(f.store.get(a.id).locationSource, "UK postcode centroid");
    assert.match(
      f.store.get(a.id).locationLabel,
      /not verified business premises/,
    );
    assert.equal(f.store.get(c.id).latitude, null);
    assert.equal(f.store.get(d.id).latitude, null);
    assert.equal(f.store.get(e.id).latitude, 52);
  } finally {
    f.close();
  }
});
test("a concurrent manual correction or address change is preserved", async () => {
  const f = setup();
  try {
    const a = record("Corrected", "SW1A1AA"),
      b = record("Moved", "SW1A1AA");
    f.store.upsert([a, b]);
    let resolve;
    const pending = new Promise((r) => (resolve = r)),
      job = postcodeLookup({
        store: f.store,
        delayMs: 0,
        fetcher: () => pending,
      });
    await job.start();
    assert.equal(await job.start(), false);
    f.store.put({
      ...a,
      latitude: 52,
      longitude: -1,
      locationSource: "Reviewed location",
    });
    f.store.put({ ...b, postcode: "M1 1AA" });
    resolve(Response.json({ result: [point("SW1A1AA")] }));
    await job.wait();
    assert.equal(job.status().locatedAccounts, 0);
    assert.equal(f.store.get(a.id).latitude, 52);
    assert.equal(f.store.get(b.id).latitude, null);
  } finally {
    f.close();
  }
});
test("mismatched service results and out-of-range coordinates never become pins", async () => {
  const f = setup();
  try {
    const a = record("Mismatch", "SW1A1AA"),
      b = record("Bad coordinates", "M11AA");
    f.store.upsert([a, b]);
    const job = postcodeLookup({
      store: f.store,
      delayMs: 0,
      fetcher: async () =>
        Response.json({
          result: [
            point("SW1A1AA", "M1 1AA"),
            point("M11AA", "M1 1AA", -33, 151),
          ],
        }),
    });
    await job.start();
    await job.wait();
    assert.equal(job.status().locatedAccounts, 0);
    assert.equal(job.status().unmatchedAccounts, 2);
  } finally {
    f.close();
  }
});
test("cancellation does not save an in-flight result and provider failure is recoverable", async () => {
  const f = setup();
  try {
    const a = record("Cancel", "SW1A1AA");
    f.store.upsert([a]);
    let resolve;
    const job = postcodeLookup({
      store: f.store,
      fetcher: () => new Promise((r) => (resolve = r)),
    });
    await job.start();
    job.cancel();
    resolve(Response.json({ result: [point("SW1A1AA")] }));
    await job.wait();
    assert.equal(job.status().status, "cancelled");
    assert.equal(f.store.get(a.id).latitude, null);
    const failed = postcodeLookup({
      store: f.store,
      fetcher: async () => new Response("", { status: 429 }),
    });
    await failed.start();
    await failed.wait();
    assert.equal(failed.status().status, "failed");
    assert.match(failed.status().error, /429/);
    assert.equal(f.store.get(a.id).latitude, null);
  } finally {
    f.close();
  }
});
test("a new lookup skips already located accounts and repeated imports preserve postcode coordinates", async () => {
  const f = setup();
  try {
    const a = record("Repeated", "SW1A1AA");
    f.store.upsert([a]);
    let calls = 0;
    const job = postcodeLookup({
      store: f.store,
      fetcher: async () => {
        calls++;
        return Response.json({ result: [point("SW1A1AA")] });
      },
    });
    await job.start();
    await job.wait();
    f.store.upsert([a]);
    assert.equal(f.store.get(a.id).latitude, 51.501);
    await job.start();
    await job.wait();
    assert.equal(calls, 1);
    assert.equal(job.status().eligibleAccounts, 0);
  } finally {
    f.close();
  }
});

test("large workbooks are split into provider batches of at most 100 postcodes", async () => {
  const f = setup();
  try {
    const letters = "ABDEFGHJLNPQRSTUWXYZ";
    const accounts = Array.from({ length: 101 }, (_, i) =>
      record("Batch " + i, `M1 ${i % 10}${letters[Math.floor(i / 10)]}A`),
    );
    f.store.upsert(accounts);
    const sizes = [];
    const job = postcodeLookup({
      store: f.store,
      delayMs: 0,
      fetcher: async (_url, options) => {
        const codes = JSON.parse(options.body).postcodes;
        sizes.push(codes.length);
        return Response.json({
          result: codes.map((code) => point(code, code)),
        });
      },
    });
    await job.start();
    await job.wait();
    assert.equal(job.status().status, "completed");
    assert.deepEqual(sizes, [100, 1]);
    assert.equal(job.status().processedPostcodes, 101);
    assert.equal(job.status().locatedAccounts, 101);
  } finally {
    f.close();
  }
});
