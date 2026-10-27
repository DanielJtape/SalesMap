import { Router } from "express";
import { rateLimit } from "express-rate-limit";

export function mapsRouter({ key, fetcher = fetch }) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60000, limit: 600 }));
  const upstream = (path, params) => {
    const url = new URL(path, "https://atlas.microsoft.com");
    url.search = new URLSearchParams(params);
    return fetcher(url, {
      headers: { "subscription-key": key },
      signal: AbortSignal.timeout(15000),
    });
  };
  router.use((_req, res, next) =>
    key
      ? next()
      : res.status(409).json({ error: "Azure Maps is not configured." }),
  );
  router.get("/tiles/:z/:x/:y", async (req, res) => {
    const values = ["z", "x", "y"].map((k) => req.params[k]);
    if (values.some((v) => !/^\d+$/.test(v)))
      return res.status(400).json({ error: "Invalid map tile." });
    const [z, x, y] = values.map(Number);
    if (z > 19 || x >= 2 ** z || y >= 2 ** z)
      return res.status(400).json({ error: "Invalid map tile." });
    const response = await upstream("/map/tile", {
      "api-version": "2024-04-01",
      tilesetId: "microsoft.base.road",
      zoom: String(z),
      x: String(x),
      y: String(y),
      tileSize: "256",
      language: "en-US",
      view: "Auto",
    });
    if (!response.ok)
      return res.status(502).json({
        error:
          "Street tiles could not load. Check the Azure Maps account and quota.",
      });
    if (!(response.headers.get("content-type") || "").includes("image/png"))
      return res.status(502).json({
        error: "The map provider returned an unexpected tile format.",
      });
    res
      .set({
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      })
      .send(Buffer.from(await response.arrayBuffer()));
  });
  router.get("/attribution", async (req, res) => {
    const zoom = Number(req.query.zoom),
      bounds = String(req.query.bounds || "")
        .split(",")
        .map(Number);
    if (
      !Number.isInteger(zoom) ||
      zoom < 0 ||
      zoom > 19 ||
      bounds.length !== 4 ||
      bounds.some((v) => !Number.isFinite(v)) ||
      Math.abs(bounds[0]) > 180 ||
      Math.abs(bounds[2]) > 180 ||
      Math.abs(bounds[1]) > 90 ||
      Math.abs(bounds[3]) > 90
    )
      return res.status(400).json({ error: "Invalid map bounds." });
    const response = await upstream("/map/attribution", {
      "api-version": "2024-04-01",
      tilesetId: "microsoft.base.road",
      zoom: String(zoom),
      bounds: bounds.join(","),
    });
    if (!response.ok)
      return res.status(502).json({ error: "Map attribution could not load." });
    const data = await response.json();
    res.json({
      copyrights: (data.copyrights || []).filter((s) => typeof s === "string"),
    });
  });
  return router;
}
export async function azureGeocode(query, key, fetcher = fetch) {
  const url = new URL("https://atlas.microsoft.com/geocode");
  url.search = new URLSearchParams({
    "api-version": "2023-06-01",
    query,
    top: "5",
  });
  const response = await fetcher(url, {
    headers: { "subscription-key": key },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    return {
      error: `Azure Maps returned ${response.status}. Check the account key and quota.`,
    };
  const data = await response.json();
  return {
    candidates: (data.features || [])
      .filter((f) => f.geometry?.type === "Point")
      .map((f) => ({
        latitude: f.geometry.coordinates[1],
        longitude: f.geometry.coordinates[0],
        label: f.properties?.address?.formattedAddress || query,
        confidence:
          { High: 9, Medium: 6, Low: 3 }[f.properties?.confidence] || 0,
      })),
  };
}
