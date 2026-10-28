import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { openPostgresStore } from "../server/postgres-store.js";
import { normalizeRecord } from "../server/importer.js";
import { createApp } from "../server/app.js";
if (!process.env.TEST_DATABASE_URL)
  throw Error("Set TEST_DATABASE_URL to an isolated PostgreSQL test database.");
const schema = "salesmap_test_" + randomBytes(8).toString("hex");
const admin = new pg.Client({
  connectionString: process.env.TEST_DATABASE_URL,
});
await admin.connect();
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set("options", "-c search_path=" + schema);
let store, server;
try {
  store = await openPostgresStore(url.toString());
  const a = normalizeRecord({
    company: "PostgreSQL Account",
    status: "Acc",
    city: "London",
    postcode: "SW1A1AA",
  });
  assert.deepEqual(await store.upsert([a]), { added: 1, updated: 0, total: 1 });
  assert.equal(
    await store.applyPostcodeLocations([
      { id: a.id, postcode: "SW1A 1AA", latitude: 51.501, longitude: -0.141 },
    ]),
    1,
  );
  assert.equal((await store.get(a.id)).locationSource, "UK postcode centroid");
  await store.put({
    ...a,
    latitude: 51.5,
    longitude: -0.12,
    locationSource: "Reviewed location",
  });
  assert.deepEqual(await store.upsert([a]), { added: 0, updated: 1, total: 1 });
  assert.equal((await store.get(a.id)).latitude, 51.5);
  assert.equal(
    await store.applyPostcodeLocations([
      { id: a.id, postcode: "SW1A 1AA", latitude: 51.501, longitude: -0.141 },
    ]),
    0,
  );
  const { app } = createApp({
    storage: store,
    password: "postgres-admin-test-password",
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { cookie, body, method = "GET" } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-SalesMap-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  assert.equal((await request("/accounts")).status, 401);
  const login = await request("/login", {
    method: "POST",
    body: { password: "postgres-admin-test-password" },
  });
  assert.equal(login.status, 200);
  const accounts = await request("/accounts", { cookie: login.cookie });
  assert.equal(accounts.body.accounts[0].company, a.company);
  const invite = await request("/team/invite", {
    method: "POST",
    cookie: login.cookie,
    body: { email: "pg-viewer@example.com" },
  });
  assert.equal(invite.status, 200);
  const joined = await request("/accept-invite", {
    method: "POST",
    body: {
      token: invite.body.token,
      password: "postgres-viewer-test-password",
    },
  });
  assert.equal(joined.status, 200);
  assert.equal(
    (await request("/accounts", { cookie: joined.cookie })).status,
    200,
  );
  assert.equal((await request("/team", { cookie: joined.cookie })).status, 403);
  await request("/team/users/pg-viewer%40example.com", {
    method: "DELETE",
    cookie: login.cookie,
  });
  assert.equal(
    (await request("/accounts", { cookie: joined.cookie })).status,
    401,
  );
  console.log(
    "PostgreSQL integration passed: imports, reimports, reviewed locations, authentication, invitations, viewer permissions and revocation.",
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await store?.db.close();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
}
