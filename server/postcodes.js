// Country formats are only candidates. Coordinates are accepted only after the
// postcode service returns that exact postcode with a valid UK-range position.
const UK_POSTCODE =
  /^(?:GIR0AA|(?:[A-PR-UWYZ][0-9][0-9A-HJKPSTUW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRVWXY]?)[0-9][ABD-HJLNP-UW-Z]{2})$/i;
export const compactPostcode = (value) =>
  String(value || "")
    .replace(/\s/g, "")
    .toUpperCase();
export const isUkCountry = (value) =>
  !value ||
  [
    "uk",
    "gb",
    "gbr",
    "united kingdom",
    "great britain",
    "england",
    "wales",
    "scotland",
    "northern ireland",
  ].includes(String(value).trim().toLowerCase());
export function ukPostcode(record) {
  const code = compactPostcode(record.postcode);
  return record.latitude === null &&
    isUkCountry(record.country) &&
    UK_POSTCODE.test(code)
    ? code
    : null;
}
export function locatedAtPostcode(record, update) {
  return {
    ...record,
    latitude: update.latitude,
    longitude: update.longitude,
    country: record.country || "United Kingdom",
    locationSource: "UK postcode centroid",
    locationLabel: `Approximate postcode centre, not verified business premises · ${update.postcode}`,
  };
}
export function postcodeLookup({ store, fetcher = fetch, delayMs = 1100 }) {
  let state = {
    status: "idle",
    eligibleAccounts: 0,
    uniquePostcodes: 0,
    processedPostcodes: 0,
    locatedAccounts: 0,
    unmatchedAccounts: 0,
    error: "",
  };
  let task = null,
    controller = null;
  const status = () => ({ ...state });
  const run = async (groups) => {
    try {
      const entries = [...groups.entries()];
      for (let start = 0; start < entries.length; start += 100) {
        if (controller.signal.aborted) break;
        const batch = entries.slice(start, start + 100),
          requested = new Map(batch);
        const response = await fetcher("https://api.postcodes.io/postcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postcodes: batch.map(([code]) => code) }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
        });
        if (!response.ok)
          throw Error(
            `The postcode service returned ${response.status}. Your saved locations are safe; try again later.`,
          );
        const data = await response.json();
        if (!Array.isArray(data.result))
          throw Error(
            "The postcode service returned an unexpected response. Try again later.",
          );
        const found = new Map();
        for (const item of data.result) {
          const code = compactPostcode(item.query),
            result = item.result;
          if (
            !requested.has(code) ||
            !result ||
            compactPostcode(result.postcode) !== code
          )
            continue;
          const { latitude, longitude } = result;
          if (
            typeof latitude !== "number" ||
            typeof longitude !== "number" ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < 49 ||
            latitude > 62 ||
            longitude < -9 ||
            longitude > 3
          )
            continue;
          found.set(code, { latitude, longitude, postcode: result.postcode });
        }
        const updates = [];
        for (const [code, ids] of batch) {
          const point = found.get(code);
          if (point) for (const id of ids) updates.push({ ...point, id });
          else state.unmatchedAccounts += ids.length;
        }
        if (controller.signal.aborted) break;
        state.locatedAccounts += await store.applyPostcodeLocations(updates);
        state.processedPostcodes += batch.length;
        if (start + 100 < entries.length && delayMs)
          await new Promise((resolve) => {
            const done = () => {
              clearTimeout(timer);
              controller.signal.removeEventListener("abort", done);
              resolve();
            };
            const timer = setTimeout(done, delayMs);
            controller.signal.addEventListener("abort", done, { once: true });
          });
      }
      state.status = controller.signal.aborted ? "cancelled" : "completed";
    } catch (error) {
      state.status = controller.signal.aborted ? "cancelled" : "failed";
      if (!controller.signal.aborted)
        state.error = error.message.startsWith("The postcode service")
          ? error.message
          : "Could not reach the postcode service. Completed locations are saved; try again later.";
    }
  };
  const start = async () => {
    if (state.status === "running") return false;
    state = {
      status: "running",
      eligibleAccounts: 0,
      uniquePostcodes: 0,
      processedPostcodes: 0,
      locatedAccounts: 0,
      unmatchedAccounts: 0,
      error: "",
    };
    controller = new AbortController();
    try {
      const groups = new Map();
      for (const record of await store.all()) {
        const code = ukPostcode(record);
        if (!code) continue;
        if (!groups.has(code)) groups.set(code, []);
        groups.get(code).push(record.id);
        state.eligibleAccounts++;
      }
      state.uniquePostcodes = groups.size;
      task = run(groups);
      return true;
    } catch (error) {
      state.status = "failed";
      state.error = "Could not read accounts for postcode lookup.";
      throw error;
    }
  };
  return { status, start, cancel: () => controller?.abort(), wait: () => task };
}
