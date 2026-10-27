import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readWorkbook } from "./importer.js";
import { openStore } from "./store.js";

export function createApp({
  dataDir = "./data",
  password = "",
  production = false,
  geocodingKey = "",
  trustProxy = false,
  fetcher = fetch,
} = {}) {
  if (production && password.length < 12)
    throw new Error(
      "Set SALES_MAP_PASSWORD to at least 12 characters before publishing.",
    );
  const app = express(),
    store = openStore(dataDir),
    sessions = new Map();
  if (trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https://*.tile.openstreetmap.org"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "upgrade-insecure-requests": production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("X-SalesMap-Request") !== "1")
        return res
          .status(403)
          .json({ error: "Missing request verification header." });
      const origin = req.get("Origin");
      if (origin && new URL(origin).host !== req.get("host"))
        return res.status(403).json({ error: "Cross-site request rejected." });
    }
    next();
  });
  const cookieToken = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("salesmap_session="))
      ?.slice(17);
  const identity = (req) => {
    if (!password) return { role: "admin", email: "Local administrator" };
    const token = cookieToken(req),
      session = sessions.get(token);
    if (
      session &&
      session.expires > Date.now() &&
      (session.role === "admin" ||
        store.db
          .prepare("SELECT email FROM users WHERE email=?")
          .get(session.email))
    )
      return session;
    if (token) sessions.delete(token);
    return null;
  };
  function signIn(res, email, role) {
    const token = randomBytes(32).toString("hex");
    for (const [k, v] of sessions)
      if (v.expires < Date.now()) sessions.delete(k);
    sessions.set(token, {
      email,
      role,
      expires: Date.now() + 12 * 60 * 60 * 1000,
    });
    res.cookie("salesmap_session", token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: 12 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ ok: true });
  }
  app.get("/api/session", (req, res) =>
    res.json({
      authenticated: !!identity(req),
      user: identity(req),
      authRequired: !!password,
    }),
  );
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 15,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const adminHash = scryptSync(password, "salesmap-password-check", 32);
  app.post("/api/login", loginLimit, (req, res) => {
    const input = req.body?.password,
      email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
    if (typeof input !== "string" || input.length > 1024)
      return res.status(401).json({ error: "Incorrect email or password." });
    const user = email
      ? store.db.prepare("SELECT * FROM users WHERE email=?").get(email)
      : null;
    const hash = user ? Buffer.from(user.hash, "hex") : adminHash;
    const valid = timingSafeEqual(
      scryptSync(input, user?.salt || "salesmap-password-check", 32),
      hash,
    );
    if (!valid || (email && !user))
      return res.status(401).json({ error: "Incorrect email or password." });
    signIn(res, user?.email || "Administrator", user ? "viewer" : "admin");
  });
  app.post("/api/accept-invite", loginLimit, (req, res) => {
    const token = String(req.body?.token || ""),
      newPassword = req.body?.password;
    if (
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 1024
    )
      return res
        .status(400)
        .json({ error: "Use a password of at least 12 characters." });
    const hash = createHash("sha256").update(token).digest("hex");
    const invite = store.db
      .prepare("SELECT * FROM invitations WHERE token_hash=? AND expires>?")
      .get(hash, Date.now());
    if (!invite)
      return res.status(400).json({
        error:
          "This invitation is invalid or has expired. Ask your administrator for a new link.",
      });
    if (
      store.db
        .prepare("SELECT email FROM users WHERE email=?")
        .get(invite.email)
    )
      return res.status(409).json({
        error:
          "This account is already registered. Sign in with your password.",
      });
    const salt = randomBytes(16).toString("hex");
    store.db
      .prepare("INSERT INTO users(email,hash,salt) VALUES(?,?,?)")
      .run(
        invite.email,
        scryptSync(newPassword, salt, 32).toString("hex"),
        salt,
      );
    store.db.prepare("DELETE FROM invitations WHERE email=?").run(invite.email);
    signIn(res, invite.email, "viewer");
  });
  app.post("/api/logout", (req, res) => {
    sessions.delete(cookieToken(req));
    res.clearCookie("salesmap_session");
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) => {
    req.user = identity(req);
    if (!req.user)
      return res.status(401).json({ error: "Sign in to view account data." });
    if (!["GET", "HEAD"].includes(req.method) && req.user.role !== "admin")
      return res
        .status(403)
        .json({ error: "Only administrators can change data." });
    next();
  });
  const admin = (req, res, next) =>
    req.user.role === "admin"
      ? next()
      : res.status(403).json({ error: "Administrator access required." });
  app.get("/api/team", admin, (_req, res) =>
    res.json({
      users: store.db.prepare("SELECT email FROM users ORDER BY email").all(),
      invitations: store.db
        .prepare("SELECT id,email,expires FROM invitations WHERE expires>?")
        .all(Date.now()),
    }),
  );
  app.post("/api/team/invite", admin, (req, res) => {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return res.status(400).json({ error: "Enter a valid email address." });
    if (store.db.prepare("SELECT email FROM users WHERE email=?").get(email))
      return res
        .status(409)
        .json({ error: "This colleague already has access." });
    const token = randomBytes(32).toString("hex"),
      id = randomBytes(12).toString("hex");
    store.db.prepare("DELETE FROM invitations WHERE email=?").run(email);
    store.db
      .prepare(
        "INSERT INTO invitations(id,email,token_hash,expires) VALUES(?,?,?,?)",
      )
      .run(
        id,
        email,
        createHash("sha256").update(token).digest("hex"),
        Date.now() + 7 * 24 * 60 * 60 * 1000,
      );
    res.json({ token, email });
  });
  app.delete("/api/team/users/:email", admin, (req, res) => {
    store.db.prepare("DELETE FROM users WHERE email=?").run(req.params.email);
    for (const [token, session] of sessions)
      if (session.email === req.params.email) sessions.delete(token);
    store.db
      .prepare("DELETE FROM invitations WHERE email=?")
      .run(req.params.email);
    res.json({ ok: true });
  });
  app.delete("/api/team/invitations/:id", admin, (req, res) => {
    store.db.prepare("DELETE FROM invitations WHERE id=?").run(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/accounts", (_req, res) =>
    res.json({
      accounts: store.all(),
      geocodingAvailable: !!geocodingKey,
      authEnabled: !!password,
    }),
  );
  app.post("/api/import", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx"))
        return res
          .status(400)
          .json({ error: "Select an Excel .xlsx workbook." });
      let parsed;
      try {
        parsed = await readWorkbook(req.file.buffer);
      } catch {
        return res.status(400).json({
          error:
            "Could not import workbook. Check it is a valid .xlsx file with Company Name in the first row.",
        });
      }
      res.json({ ...store.upsert(parsed.records), skipped: parsed.skipped });
    } catch (error) {
      next(error);
    }
  });
  app.patch("/api/accounts/:id/location", (req, res) => {
    const record = store.get(req.params.id);
    if (!record) return res.status(404).json({ error: "Account not found." });
    const { latitude, longitude } = req.body || {};
    if (latitude === null && longitude === null) {
      Object.assign(record, {
        latitude: null,
        longitude: null,
        locationSource: null,
        locationLabel: "",
      });
    } else {
      if (
        typeof latitude !== "number" ||
        typeof longitude !== "number" ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180
      )
        return res.status(400).json({
          error:
            "Enter valid latitude (-90 to 90) and longitude (-180 to 180).",
        });
      Object.assign(record, {
        latitude,
        longitude,
        locationSource: "Reviewed location",
        locationLabel: String(req.body.label || "Manually placed").slice(
          0,
          500,
        ),
      });
      if (req.body.country)
        record.country = String(req.body.country).slice(0, 100);
    }
    store.put(record);
    res.json(record);
  });
  app.post(
    "/api/accounts/:id/geocode",
    rateLimit({ windowMs: 60 * 1000, limit: 30 }),
    async (req, res, next) => {
      try {
        if (!geocodingKey)
          return res.status(409).json({
            error:
              "Global address search needs an OPENCAGE_API_KEY on the server. You can also enter coordinates manually.",
          });
        const record = store.get(req.params.id);
        if (!record)
          return res.status(404).json({ error: "Account not found." });
        const country = String(req.body.country || record.country || "").trim();
        if (!country)
          return res.status(400).json({
            error:
              "Choose a country to avoid matching the wrong city or postcode.",
          });
        const query = [record.street, record.city, record.postcode, country]
          .filter(Boolean)
          .join(", ");
        if (!record.street && !record.city && !record.postcode)
          return res.status(400).json({
            error:
              "No address information is available. Enter coordinates manually.",
          });
        const url = new URL("https://api.opencagedata.com/geocode/v1/json");
        url.search = new URLSearchParams({
          q: query,
          key: geocodingKey,
          limit: "5",
          no_annotations: "1",
          no_record: "1",
        });
        const upstream = await fetcher(url, {
          signal: AbortSignal.timeout(15000),
        });
        if (!upstream.ok)
          return res.status(502).json({
            error: `Address provider returned ${upstream.status}. Check your API key and quota.`,
          });
        const result = await upstream.json();
        res.json({
          candidates: (result.results || []).map((r) => ({
            latitude: r.geometry.lat,
            longitude: r.geometry.lng,
            label: r.formatted,
            confidence: r.confidence,
          })),
          country,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  } else
    app.get("/", (_req, res) =>
      res
        .status(503)
        .send(
          "Run npm run build, or use npm run dev:client during development.",
        ),
    );
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError)
      return res
        .status(400)
        .json({ error: "Upload a single .xlsx file no larger than 10 MB." });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({ error: "Invalid JSON request." });
    console.error("Request failed:", error.name);
    res
      .status(500)
      .json({ error: "The request could not be completed. Please retry." });
  });
  return { app, store };
}
