import React, {
  useState,
  useEffect,
  useMemo,
  useDeferredValue,
  useRef,
} from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  MapPin,
  Search,
  SlidersHorizontal,
  Upload,
  ArrowUpRight,
  X,
  Check,
  Compass,
  Users,
  LogOut,
  LocateFixed,
  ChevronRight,
  Building2,
  Globe2,
  Phone,
  Layers,
  RefreshCw,
  Navigation,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Copy,
  Plus,
  Trash2,
} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/manrope/latin-800.css";
import "./style.css";
import worldUrl from "./data/world.json?url";

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "X-SalesMap-Request": "1",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The request failed.");
  return result;
}
const address = (a) =>
  [a.street, a.city, a.postcode, a.country].filter(Boolean).join(", ");
const number = (n) => n.toLocaleString();
function Brand() {
  return (
    <div className="brand">
      <span className="wordmark">
        JTAPE<span>®</span>
      </span>
      <span className="brand-rule" />
      <span className="product">
        SalesMap<span>ACCOUNT INTELLIGENCE</span>
      </span>
    </div>
  );
}
function App() {
  const [session, setSession] = useState(null),
    [accounts, setAccounts] = useState([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("All"),
    [manager, setManager] = useState("All managers"),
    [location, setLocation] = useState("all"),
    [selected, setSelected] = useState(null),
    [limit, setLimit] = useState(100),
    [team, setTeam] = useState(false),
    [locate, setLocate] = useState(false),
    [geocoding, setGeocoding] = useState(false),
    [mapService, setMapService] = useState(false);
  const [inviteToken] = useState(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token) history.replaceState({}, "", window.location.pathname);
    return token;
  });
  const input = useRef(),
    search = useDeferredValue(query.toLowerCase());
  const load = async () => {
    try {
      const data = await api("/accounts");
      setAccounts(data.accounts);
      setGeocoding(data.geocodingAvailable);
      setMapService(data.mapServiceAvailable || false);
      setReady(true);
    } catch (e) {
      setError(e.message);
    }
  };
  const refreshSession = () =>
    api("/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refreshSession();
  }, []);
  useEffect(() => {
    if (session?.authenticated) load();
  }, [session?.authenticated]);
  useEffect(() => {
    setLimit(100);
  }, [query, status, manager, location]);
  const managers = useMemo(
    () => [...new Set(accounts.map((a) => a.manager))].sort(),
    [accounts],
  );
  const filtered = useMemo(
    () =>
      accounts.filter(
        (a) =>
          (status === "All" || a.status === status) &&
          (manager === "All managers" || a.manager === manager) &&
          (location === "all" ||
            (location === "mapped"
              ? a.latitude !== null
              : a.latitude === null)) &&
          (!search ||
            [
              a.company,
              a.city,
              a.postcode,
              a.street,
              a.application,
              a.specification,
            ].some((v) => v.toLowerCase().includes(search))),
      ),
    [accounts, status, manager, location, search],
  );
  const mapped = useMemo(
    () => filtered.filter((a) => a.latitude !== null),
    [filtered],
  );
  const active = accounts.find((a) => a.id === selected);
  const admin = session?.user?.role === "admin";
  const select = React.useCallback((id) => setSelected(id), []);
  const update = (record) =>
    setAccounts((list) => list.map((a) => (a.id === record.id ? record : a)));
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api("/import", { method: "POST", body });
      await load();
      setMessage(
        `Import complete · ${number(result.added)} added, ${number(result.updated)} updated${result.skipped ? `, ${result.skipped} blank rows skipped` : ""}.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      input.current.value = "";
    }
  }
  if (!session)
    return (
      <div className="loading">
        <LoaderCircle className="spin" /> Loading SalesMap…
        {error && <p>{error}</p>}
      </div>
    );
  if (!session.authenticated)
    return <Login inviteToken={inviteToken} onLogin={refreshSession} />;
  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <div className="topnav">
          <span className="live-dot" />
          Your account workspace
        </div>
        <div className="header-actions">
          {admin && (
            <>
              <button
                aria-label="Locate UK accounts"
                className="button ghost"
                onClick={() => setLocate(true)}
              >
                <MapPin size={16} />
                <span>Locate UK accounts</span>
              </button>
              <button className="button ghost" onClick={() => setTeam(true)}>
                <Users size={16} />
                Team
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => input.current.click()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Upload size={16} />
                )}
                <span>Import workbook</span>
              </button>
              <input
                ref={input}
                type="file"
                accept=".xlsx"
                hidden
                onChange={(e) => upload(e.target.files[0])}
              />
            </>
          )}
          {session.authRequired && (
            <button
              title="Sign out"
              aria-label="Sign out"
              className="icon-button"
              onClick={async () => {
                await api("/logout", { method: "POST" });
                setAccounts([]);
                setReady(false);
                refreshSession();
              }}
            >
              <LogOut size={18} />
            </button>
          )}
          <div className="avatar" title={session.user?.email}>
            {admin ? "AD" : session.user?.email?.slice(0, 2).toUpperCase()}
          </div>
        </div>
      </header>
      <div className="workspace-header">
        <div>
          <div className="eyebrow">YOUR TERRITORY, AT A GLANCE</div>
          <h1>
            Every account. A clearer picture<span>.</span>
          </h1>
          <p>
            Find your customers, discover opportunities, and plan your next
            move.
          </p>
        </div>
        <div className="workspace-tag">
          <Globe2 size={16} />
          Global account view
        </div>
      </div>
      {(error || message) && (
        <div
          role={error ? "alert" : "status"}
          className={`notice ${error ? "error" : ""}`}
        >
          {error || message}
          <button
            aria-label="Dismiss message"
            onClick={() => {
              setError("");
              setMessage("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="panel-heading">
              <h2>
                Accounts <span>{number(accounts.length)}</span>
              </h2>
              <SlidersHorizontal size={17} />
            </div>
            <label className="search-box">
              <Search size={18} />
              <input
                placeholder="Search company, city, postcode…"
                aria-label="Search accounts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              )}
            </label>
            <div className="field-label">ACCOUNT TYPE</div>
            <div className="segments">
              {["All", "Customer", "Prospect"].map((s) => (
                <button
                  className={status === s ? "active" : ""}
                  key={s}
                  onClick={() => setStatus(s)}
                >
                  {s === "All" ? "All accounts" : s + "s"}
                </button>
              ))}
            </div>
            <label className="filter-label">
              Account manager
              <select
                value={manager}
                onChange={(e) => setManager(e.target.value)}
              >
                {["All managers", ...managers].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <div className="filter-row">
              <label className="filter-label">
                Location status
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  <option value="all">All locations</option>
                  <option value="mapped">On the map</option>
                  <option value="unmapped">Needs location</option>
                </select>
              </label>
              {(status !== "All" ||
                manager !== "All managers" ||
                location !== "all" ||
                query) && (
                <button
                  className="text-button reset"
                  onClick={() => {
                    setStatus("All");
                    setManager("All managers");
                    setLocation("all");
                    setQuery("");
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
          <div className="result-heading">
            <span>{number(filtered.length)} results</span>
            <span>COMPANY A–Z</span>
          </div>
          <div className="account-list">
            {!ready ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                Loading accounts…
              </div>
            ) : !filtered.length ? (
              <div className="empty">
                <Building2 />
                <h3>
                  {accounts.length
                    ? "No matching accounts"
                    : "Your next opportunity starts here"}
                </h3>
                <p>
                  {accounts.length
                    ? "Try changing your search or filters."
                    : admin
                      ? "Import your Excel workbook to see your accounts."
                      : "Your administrator has not imported accounts yet."}
                </p>
              </div>
            ) : (
              filtered.slice(0, limit).map((a) => (
                <button
                  className={`account-card ${selected === a.id ? "selected" : ""}`}
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                >
                  <div
                    className={`company-icon ${a.status === "Prospect" ? "prospect" : ""}`}
                  >
                    <Building2 size={18} />
                  </div>
                  <div className="account-summary">
                    <h3>{a.company}</h3>
                    <div className="account-city">
                      {[a.city, a.postcode].filter(Boolean).join(" · ") ||
                        "Address not provided"}
                    </div>
                    <div className="account-meta">
                      <span className={`badge ${a.status.toLowerCase()}`}>
                        {a.status}
                      </span>
                      <span className="manager-name">{a.manager}</span>
                    </div>
                  </div>
                  <span
                    className={`pin-status ${a.latitude !== null ? "located" : ""}`}
                    title={
                      a.latitude !== null ? "On the map" : "Needs location"
                    }
                  >
                    <MapPin size={15} />
                  </span>
                </button>
              ))
            )}
            {filtered.length > limit && (
              <button
                className="load-more"
                onClick={() => setLimit(limit + 100)}
              >
                Show 100 more <ChevronRight size={15} />
              </button>
            )}
          </div>
          <div className="sidebar-footer">
            <span className="live-dot" />
            Private workspace <LockKeyhole size={12} />
          </div>
        </aside>
        <section className="map-section" aria-label="Account map">
          <MapView
            streetAvailable={mapService}
            accounts={mapped}
            selected={active}
            onSelect={select}
          />
          <div className="map-stats">
            <div>
              <span className="stat-icon teal">
                <Building2 size={18} />
              </span>
              <span>
                <strong>{number(filtered.length)}</strong>
                <small>Filtered accounts</small>
              </span>
            </div>
            <div>
              <span className="stat-icon orange">
                <MapPin size={18} />
              </span>
              <span>
                <strong>{number(mapped.length)}</strong>
                <small>On the map</small>
              </span>
            </div>
            <button
              onClick={() => setLocation("unmapped")}
              title="Show accounts needing a location"
            >
              <span className="stat-icon gray">
                <Compass size={18} />
              </span>
              <span>
                <strong>{number(filtered.length - mapped.length)}</strong>
                <small>Needs location</small>
              </span>
            </button>
          </div>
          {!mapped.length && !active && (
            <div className="map-empty">
              <div className="map-empty-icon">
                <MapPin size={28} />
              </div>
              <span className="eyebrow">A WORLD OF OPPORTUNITY</span>
              <h2>
                {accounts.length
                  ? "Your accounts, ready to place."
                  : "See the bigger picture."}
              </h2>
              <p>
                {accounts.length
                  ? "Select an account to review its address and add a location. Your workbook has no coordinates, so we’ll never guess where a pin belongs."
                  : "Import a workbook to bring your customers and prospects together on one map."}
              </p>
              {accounts.length > 0 && (
                <button
                  className="button primary"
                  onClick={() => {
                    setLocation("unmapped");
                    setSelected(filtered[0]?.id || accounts[0].id);
                  }}
                >
                  Review a location <ArrowUpRight size={16} />
                </button>
              )}
            </div>
          )}
          <div className="map-legend">
            <span>
              <i className="customer-dot" />
              Customer
            </span>
            <span>
              <i className="prospect-dot" />
              Prospect
            </span>
            <span>
              <i className="unknown-dot" />
              Unspecified
            </span>
          </div>
          <div className="map-caption">
            <Layers size={14} />
            Country overview · Street map available online
          </div>
          {active && (
            <Details
              account={active}
              admin={admin}
              available={geocoding}
              onClose={() => setSelected(null)}
              onUpdate={update}
              onError={setError}
            />
          )}
        </section>
      </main>
      <footer className="app-footer">
        <span>JTAPE SalesMap</span>
        <span>Built for better connections.</span>
        <span>
          {session.user?.role === "viewer"
            ? "Viewer access"
            : "Administrator workspace"}
        </span>
      </footer>
      {locate && (
        <PostcodeModal
          onClose={() => {
            setLocate(false);
            load();
          }}
          onChanged={load}
        />
      )}
      {team && (
        <TeamModal
          onClose={() => setTeam(false)}
          authRequired={session.authRequired}
        />
      )}
    </div>
  );
}
function MapView({ accounts, selected, onSelect, streetAvailable = false }) {
  const ref = useRef(),
    map = useRef(),
    cluster = useRef(),
    markers = useRef(new Map()),
    [fitTick, setFitTick] = useState(0),
    [tileError, setTileError] = useState(false),
    [pinProgress, setPinProgress] = useState({ loaded: 0, total: 0 }),
    [background, setBackground] = useState("overview"),
    backgroundMode = useRef("overview");
  useEffect(() => {
    map.current = L.map(ref.current, {
      zoomControl: false,
      preferCanvas: true,
      minZoom: 2,
      maxZoom: 19,
    }).setView([27, 4], 2);
    map.current.createPane("overview");
    map.current.getPane("overview").style.zIndex = "200";
    let cancelled = false;
    fetch(worldUrl)
      .then((response) => {
        if (!response.ok) throw new Error("Country map could not load");
        return response.json();
      })
      .then((world) => {
        if (cancelled || !map.current) return;
        L.geoJSON(world, {
          pane: "overview",
          interactive: false,
          style: {
            color: "#bbc9b0",
            weight: 1,
            fillColor: "#f0efe3",
            fillOpacity: 1,
          },
          attribution:
            '<a href="https://www.naturalearthdata.com/">Natural Earth</a> · Country overview',
        }).addTo(map.current);
        const labels = L.layerGroup().addTo(map.current);
        const updateLabels = () => {
          labels.clearLayers();
          for (const feature of world.features) {
            const p = feature.properties;
            if (
              p.labelLat == null ||
              p.labelLng == null ||
              p.rank > map.current.getZoom()
            )
              continue;
            const element = document.createElement("span");
            element.textContent = p.name;
            L.marker([p.labelLat, p.labelLng], {
              interactive: false,
              keyboard: false,
              pane: "overview",
              icon: L.divIcon({
                className: "country-label",
                html: element,
                iconSize: [110, 20],
                iconAnchor: [55, 10],
              }),
            }).addTo(labels);
          }
        };
        updateLabels();
        map.current.on("zoomend", updateLabels);
      })
      .catch(() => setTileError(true));
    L.control.zoom({ position: "bottomright" }).addTo(map.current);
    cluster.current = L.markerClusterGroup({
      chunkedLoading: false,
      animate: false,
      showCoverageOnHover: false,
      maxClusterRadius: 45,
    });
    map.current.addLayer(cluster.current);
    const observer = new ResizeObserver(() => map.current?.invalidateSize());
    observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      map.current.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (streetAvailable) setBackground("street");
  }, [streetAvailable]);
  useEffect(() => {
    backgroundMode.current = background;
    if (background !== "street") return;
    setTileError(false);
    let failed = false;
    const tiles = L.tileLayer(
      streetAvailable
        ? "/api/map/tiles/{z}/{x}/{y}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        attribution: streetAvailable
          ? '&copy; <a href="https://azure.microsoft.com/products/azure-maps/">Microsoft Azure Maps</a>'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      },
    );
    const fail = () => {
      if (failed) return;
      failed = true;
      if (map.current?.hasLayer(tiles)) map.current.removeLayer(tiles);
      setBackground("overview");
      setTileError(true);
      if (map.current?.getZoom() > 7)
        map.current.setZoom(6, { animate: false });
    };
    tiles
      .on("tileerror", fail)
      .on("tileload", (event) => {
        if (!event.tile.naturalWidth) fail();
      })
      .addTo(map.current);
    let copyright = "";
    const attribution = async () => {
      if (!streetAvailable || failed || !map.current) return;
      const bounds = map.current.getBounds(),
        wrap = (v) => ((((v + 180) % 360) + 360) % 360) - 180;
      const query = new URLSearchParams({
        zoom: String(Math.round(map.current.getZoom())),
        bounds: [
          wrap(bounds.getWest()),
          Math.max(-85, bounds.getSouth()),
          wrap(bounds.getEast()),
          Math.min(85, bounds.getNorth()),
        ].join(","),
      });
      try {
        const result = await api("/map/attribution?" + query);
        if (failed || !map.current || backgroundMode.current !== "street")
          return;
        const span = document.createElement("span");
        span.textContent = result.copyrights.join(" · ");
        if (copyright)
          map.current.attributionControl.removeAttribution(copyright);
        copyright = span.innerHTML;
        map.current.attributionControl.addAttribution(copyright);
      } catch {
        fail();
      }
    };
    if (streetAvailable) {
      map.current.on("moveend", attribution);
      attribution();
    }
    const timer = setTimeout(() => {
      if (tiles.isLoading()) fail();
    }, 10000);
    return () => {
      failed = true;
      clearTimeout(timer);
      if (map.current) {
        map.current.off("moveend", attribution);
        if (copyright)
          map.current.attributionControl.removeAttribution(copyright);
      }
      tiles.off();
      if (map.current?.hasLayer(tiles)) map.current.removeLayer(tiles);
    };
  }, [background, streetAvailable]);
  useEffect(() => {
    const group = cluster.current;
    group.clearLayers();
    markers.current.clear();
    let cancelled = false,
      timer;
    let offset = 0;
    const icons = new Map();
    setPinProgress({ loaded: 0, total: accounts.length });
    const addBatch = () => {
      if (cancelled || !map.current) return;
      const pins = [];
      const end = Math.min(offset + 200, accounts.length);
      for (; offset < end; offset++) {
        const a = accounts[offset];
        const color =
          a.status === "Customer"
            ? "#14796f"
            : a.status === "Prospect"
              ? "#ed8851"
              : "#77868b";
        if (!icons.has(color))
          icons.set(
            color,
            L.divIcon({
              className: "account-marker",
              html: `<span style="--pin-color:${color}"><svg viewBox="0 0 24 24" width="17" height="17" fill="white"><path d="M4 21V3h12v5h4v13h-7v-5h-2v5H4zm3-14h2V5H7v2zm5 0h2V5h-2v2zm-5 4h2V9H7v2zm5 0h2V9h-2v2zm-5 4h2v-2H7v2zm9-3h2v-2h-2v2zm0 4h2v-2h-2v2z"/></svg></span>`,
              iconSize: [34, 42],
              iconAnchor: [17, 40],
            }),
          );
        const marker = L.marker([a.latitude, a.longitude], {
          icon: icons.get(color),
          alt: a.company,
        });
        marker.bindTooltip(() => {
          const element = document.createElement("div");
          element.textContent = a.company;
          return element;
        });
        marker.on("click", () => onSelect(a.id));
        markers.current.set(a.id, marker);
        pins.push(marker);
      }
      if (cancelled) return;
      group.addLayers(pins);
      setPinProgress({ loaded: offset, total: accounts.length });
      if (offset < accounts.length) timer = setTimeout(addBatch, 16);
    };
    if (accounts.length) timer = setTimeout(addBatch, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accounts, onSelect]);
  useEffect(() => {
    if (!map.current || !accounts.length) return;
    // Cluster bounds are incomplete while pins are still loading. Derive the
    // viewport directly from coordinates so it never depends on chunk timing.
    const bounds = L.latLngBounds(
      accounts.map((a) => [a.latitude, a.longitude]),
    );
    if (bounds.isValid())
      map.current.fitBounds(bounds, {
        padding: [65, 100],
        maxZoom: backgroundMode.current === "street" ? 12 : 6,
        animate: false,
      });
  }, [accounts, fitTick]);
  useEffect(() => {
    if (selected?.latitude !== null && selected?.latitude !== undefined) {
      const marker = markers.current.get(selected.id);
      if (map.current) {
        map.current.setView(
          [selected.latitude, selected.longitude],
          backgroundMode.current === "street" ? 15 : 6,
          {
            animate: false,
          },
        );
        if (marker && map.current.hasLayer(marker)) marker.openTooltip();
      }
    }
  }, [selected]);
  return (
    <>
      <div ref={ref} className="map-canvas" />
      {pinProgress.loaded < pinProgress.total && (
        <div className="map-loading" role="status">
          <LoaderCircle className="spin" size={14} />
          Loading account pins… {number(pinProgress.loaded)} /{" "}
          {number(pinProgress.total)}
        </div>
      )}
      <div className="background-control" aria-label="Map background">
        <button
          className={background === "overview" ? "active" : ""}
          onClick={() => {
            setBackground("overview");
            if (map.current.getZoom() > 7)
              map.current.setZoom(6, { animate: false });
          }}
        >
          Country overview
        </button>
        <button
          className={background === "street" ? "active" : ""}
          onClick={() => setBackground("street")}
        >
          Street map
        </button>
      </div>
      {tileError && (
        <div className="tile-error" role="status">
          Street tiles could not load. The offline country map is available.
        </div>
      )}
      <button
        className="map-fit"
        onClick={() => setFitTick((t) => t + 1)}
        title="Fit all filtered pins"
        aria-label="Fit all filtered pins"
      >
        <LocateFixed size={20} />
      </button>
    </>
  );
}
function Details({ account: a, admin, available, onClose, onUpdate, onError }) {
  const [lat, setLat] = useState(""),
    [lng, setLng] = useState(""),
    [country, setCountry] = useState(""),
    [candidates, setCandidates] = useState(null),
    [busy, setBusy] = useState(false),
    [manual, setManual] = useState(false);
  useEffect(() => {
    setLat(a.latitude ?? "");
    setLng(a.longitude ?? "");
    setCountry(a.country);
    setCandidates(null);
    setManual(false);
  }, [a.id, a.latitude, a.longitude]);
  async function save(latitude, longitude, label) {
    setBusy(true);
    try {
      const record = await api(`/accounts/${a.id}/location`, {
        method: "PATCH",
        body: JSON.stringify({ latitude, longitude, label, country }),
      });
      onUpdate(record);
      setCandidates(null);
      setManual(false);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function geocode() {
    setBusy(true);
    try {
      const result = await api(`/accounts/${a.id}/geocode`, {
        method: "POST",
        body: JSON.stringify({ country }),
      });
      setCandidates(result.candidates);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const website = (() => {
    try {
      if (a.website.includes("@")) return null;
      const u = new URL(
        a.website.startsWith("http") ? a.website : "https://" + a.website,
      );
      return ["https:", "http:"].includes(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  })();
  return (
    <aside className="details" aria-label="Account details">
      <div className="detail-top">
        <span className="eyebrow">ACCOUNT DETAILS</span>
        <button
          className="icon-button"
          aria-label="Close account details"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="detail-content">
        <div className="detail-company-icon">
          <Building2 size={25} />
        </div>
        <h2>{a.company}</h2>
        <span className={`badge ${a.status.toLowerCase()}`}>{a.status}</span>
        <div className="detail-owner">
          <div className="small-avatar">
            {a.manager
              .split(" ")
              .map((n) => n[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <small>ACCOUNT MANAGER</small>
            <strong>{a.manager}</strong>
          </div>
        </div>
        <div className="detail-section">
          <h3>
            <MapPin size={16} />
            Address
          </h3>
          <p>{address(a) || "No address provided"}</p>
          <div className={`location-note ${a.latitude !== null ? "good" : ""}`}>
            {a.latitude !== null ? (
              <>
                <Check size={14} />
                {a.locationSource}
              </>
            ) : (
              <>
                <Compass size={14} />
                Location needs review
              </>
            )}
          </div>
          {a.latitude !== null && (
            <small className="coordinate-label">
              {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
              <br />
              {a.locationLabel}
            </small>
          )}
        </div>
        <div className="detail-section">
          <h3>Primary tape application</h3>
          <p className={!a.application ? "muted" : ""}>
            {a.application || "Not provided in the source"}
          </p>
        </div>
        <div className="detail-section">
          <h3>Required tape specification</h3>
          <p className={!a.specification ? "muted" : ""}>
            {a.specification || "Not provided in the source"}
          </p>
        </div>
        {a.phone && (
          <div className="contact-line">
            <Phone size={15} />
            <span>{a.phone}</span>
          </div>
        )}
        {a.website && (
          <div className="contact-line">
            <Globe2 size={15} />
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer">
                {a.website}
                <ArrowUpRight size={13} />
              </a>
            ) : (
              <span>{a.website}</span>
            )}
          </div>
        )}
        {admin && (
          <div className="location-editor">
            <h3>
              {a.latitude !== null
                ? "Review location"
                : "Put this account on the map"}
            </h3>
            <p>
              Confirm the country and review an address match, or enter known
              coordinates.
            </p>
            <label className="filter-label">
              Country
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. United Kingdom"
              />
            </label>
            <button
              className="button primary full"
              disabled={busy || !available || !country.trim()}
              onClick={geocode}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Search size={15} />
              )}
              Find address matches
            </button>
            {!available && (
              <p className="provider-note">
                Address search needs a mapping service configured on the server.
                Manual placement works now.
              </p>
            )}
            {available && (
              <p className="provider-note">
                Search sends this address to your configured mapping provider. A
                city or postcode match may be approximate.
              </p>
            )}
            {candidates && (
              <div className="candidates">
                {!candidates.length ? (
                  <p>No matches. Try another country or enter coordinates.</p>
                ) : (
                  <>
                    <small>CHOOSE A MATCH TO SAVE</small>
                    {candidates.map((c, i) => (
                      <button
                        key={i}
                        disabled={busy}
                        onClick={() => save(c.latitude, c.longitude, c.label)}
                      >
                        <MapPin size={16} />
                        <span>
                          {c.label}
                          <small>
                            Provider confidence {c.confidence}/10 · verify
                            before saving
                          </small>
                        </span>
                        <Plus size={15} />
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            <button className="text-button" onClick={() => setManual(!manual)}>
              {manual ? "Hide coordinates" : "Enter coordinates manually"}
              <ChevronRight size={14} />
            </button>
            {manual && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  save(Number(lat), Number(lng), "Manually placed");
                }}
              >
                <div className="coordinate-inputs">
                  <label>
                    Latitude
                    <input
                      aria-label="Latitude"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      required
                      placeholder="51.5074"
                    />
                  </label>
                  <label>
                    Longitude
                    <input
                      aria-label="Longitude"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      required
                      placeholder="-0.1278"
                    />
                  </label>
                </div>
                <button className="button primary full" disabled={busy}>
                  Save location <Check size={15} />
                </button>
              </form>
            )}
            {a.latitude !== null && (
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => save(null, null, "")}
              >
                Remove saved pin
              </button>
            )}
          </div>
        )}
      </div>
      <div className="detail-bottom">
        <LockKeyhole size={12} />
        Visible to your team only
      </div>
    </aside>
  );
}
function Login({ inviteToken, onLogin }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [admin, setAdmin] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(inviteToken ? "/accept-invite" : "/login", {
        method: "POST",
        body: JSON.stringify(
          inviteToken
            ? { token: inviteToken, password }
            : { email: admin ? "" : email, password },
        ),
      });
      onLogin();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <Brand />
      <div className="login-card">
        <div className="detail-company-icon">
          <LockKeyhole size={27} />
        </div>
        <div className="eyebrow">YOUR PRIVATE ACCOUNT WORKSPACE</div>
        <h1>{inviteToken ? "You’re invited." : "Welcome back."}</h1>
        <p>
          {inviteToken
            ? "Create a password to join the team. Your invitation can be used once."
            : "Sign in to explore your customers and your next opportunities."}
        </p>
        <form onSubmit={submit}>
          {!inviteToken && !admin && (
            <label>
              Email address
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
          )}
          <label>
            {inviteToken ? "Create password (12+ characters)" : "Password"}
            <input
              type="password"
              minLength={inviteToken ? 12 : 1}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={inviteToken ? "new-password" : "current-password"}
            />
          </label>
          {error && (
            <p role="alert" className="danger">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : inviteToken ? (
              "Join workspace"
            ) : (
              "Sign in"
            )}
            <ArrowUpRight size={16} />
          </button>
        </form>
        {!inviteToken && (
          <button className="text-button" onClick={() => setAdmin(!admin)}>
            {admin ? "Sign in as a colleague" : "Administrator sign-in"}
          </button>
        )}
        <small>
          Access is by invitation. Contact your administrator to join.
        </small>
      </div>
      <p className="login-footer">Every account. A clearer picture.</p>
    </div>
  );
}
function PostcodeModal({ onClose, onChanged }) {
  const [job, setJob] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const finished = useRef(false);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const data = await api("/locations/uk-postcodes");
        if (!active) return;
        setJob(data);
        if (
          ["completed", "cancelled", "failed"].includes(data.status) &&
          !finished.current
        ) {
          finished.current = true;
          onChanged();
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function start() {
    setBusy(true);
    setError("");
    finished.current = false;
    try {
      setJob(await api("/locations/uk-postcodes", { method: "POST" }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    try {
      setJob(await api("/locations/uk-postcodes/cancel", { method: "POST" }));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Locate UK accounts"
        className="team-modal postcode-modal"
      >
        <div className="detail-top">
          <h2>Locate UK accounts</h2>
          <button
            className="icon-button"
            aria-label="Close postcode lookup"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Find coordinates for all unmapped accounts with a valid UK postcode
          format, across all managers and filters. Uses the free postcodes.io
          service; only postcodes are sent.
        </p>
        <div className="postcode-caution">
          <MapPin size={18} />
          <p>
            Pins show approximate <strong>postcode centres</strong>, not
            verified business premises. Existing saved pins are preserved.
            Accounts without a valid match stay in Needs location.
          </p>
        </div>
        {job && job.status !== "idle" && (
          <>
            <div className="lookup-progress">
              <span>
                {job.status === "running"
                  ? "Looking up postcodes…"
                  : job.status === "completed"
                    ? "Lookup complete"
                    : job.status === "cancelled"
                      ? "Lookup stopped"
                      : "Lookup interrupted"}
              </span>
              <strong>
                {number(job.processedPostcodes)} / {number(job.uniquePostcodes)}{" "}
                postcodes
              </strong>
            </div>
            <progress
              max={job.uniquePostcodes || 1}
              value={job.processedPostcodes}
            />
            <div className="lookup-counts">
              <div>
                <strong>{number(job.locatedAccounts)}</strong>
                <span>Accounts located</span>
              </div>
              <div>
                <strong>{number(job.unmatchedAccounts)}</strong>
                <span>No match found</span>
              </div>
            </div>
            {job.error && (
              <p role="alert" className="danger">
                {job.error}
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {job?.status === "running" ? (
          <button className="button ghost full" onClick={cancel}>
            Stop lookup
          </button>
        ) : (
          <button
            className="button primary full"
            disabled={busy || !job}
            onClick={start}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <MapPin size={16} />
            )}
            Locate UK postcodes
          </button>
        )}
        <p className="provider-note">
          Usually takes a few minutes for a large workbook. Saved results
          survive restarts; an interrupted lookup can be run again. Keep this
          window open to see progress.
        </p>
      </section>
    </div>
  );
}
function TeamModal({ onClose, authRequired }) {
  const [data, setData] = useState(null),
    [email, setEmail] = useState(""),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const load = () =>
    api("/team")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function invite(e) {
    e.preventDefault();
    try {
      const result = await api("/team/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setLink(`${window.location.origin}/?invite=${result.token}`);
      setCopied(false);
      setEmail("");
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  async function revoke(path) {
    try {
      await api(path, { method: "DELETE" });
      load();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Team access"
        className="team-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="detail-top">
          <h2>Team access</h2>
          <button
            className="icon-button"
            aria-label="Close team access"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Invite colleagues to view the map. Only administrators can import
          accounts and edit locations.
        </p>
        {!authRequired && (
          <div className="notice error">
            Local development mode. Set SALES_MAP_PASSWORD on the server before
            sharing the app.
          </div>
        )}
        <form onSubmit={invite}>
          <label className="filter-label">
            Colleague’s email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </label>
          <button className="button primary">
            <Mail size={16} />
            Create invitation
          </button>
        </form>
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        {link && (
          <div className="invite-link">
            <strong>Invitation ready · expires in 7 days</strong>
            <p>
              Send this private, single-use link directly to your colleague. It
              is not emailed automatically.
            </p>
            <input aria-label="Invitation link" readOnly value={link} />
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                } catch {
                  setError("Copy the link from the field above.");
                }
              }}
            >
              <Copy size={14} />
              {copied ? "Copied" : "Copy invitation link"}
            </button>
          </div>
        )}
        <h3>Colleagues</h3>
        {data?.users.length ? (
          data.users.map((u) => (
            <div className="team-row" key={u.email}>
              <span>
                {u.email}
                <small>Viewer</small>
              </span>
              <button
                aria-label={`Revoke ${u.email}`}
                className="icon-button danger"
                onClick={() =>
                  revoke("/team/users/" + encodeURIComponent(u.email))
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        ) : (
          <p className="muted">No colleagues have joined yet.</p>
        )}
        <h3>Pending invitations</h3>
        {data?.invitations.map((i) => (
          <div className="team-row" key={i.id}>
            <span>
              {i.email}
              <small>Expires {new Date(i.expires).toLocaleDateString()}</small>
            </span>
            <button
              aria-label={`Cancel invitation for ${i.email}`}
              className="icon-button danger"
              onClick={() => revoke("/team/invitations/" + i.id)}
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <p className="provider-note">
          To reset a colleague’s password, revoke their access and send a new
          invitation.
        </p>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
