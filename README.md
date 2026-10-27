# JTAPE SalesMap

A private, interactive account map for the JTAPE master contacts workbook. Filter customers and prospects by account manager, search addresses and companies, and click a pin or account to see the address, primary tape application and required tape specification.

Built with React, Leaflet/OpenStreetMap, Express and SQLite on Node 24. Account data stays on the server. Excel files, databases, credentials and generated builds are excluded from Git.

## Run locally

```sh
npm ci
npm run build
npm run dev
```

The server uses port 3000. Without a password it operates as a local administrator; never expose that development mode publicly. For frontend hot reload, also run `npm run dev:client` and use Vite's displayed local address. Vite proxies `/api` to the backend.

Copy `.env.example` to `.env` and set `SALES_MAP_PASSWORD` (at least 12 characters) before sharing. Do not commit that file. Production refuses to start without a suitable administrator password.

```sh
npm test
npm run build
# Optional browser smoke: install Chromium and set CHROMIUM_PATH if needed
npm run test:browser
```

The browser smoke uses isolated synthetic accounts and a temporary database, never your contact list.

## Import the workbook

As administrator, click **Import workbook**, or use:

```sh
npm run import -- "/path/to/accounts.xlsx"
```

The first worksheet with data must have column names in row one. The supplied columns are supported directly: `Acc - Prospect`, `Manager`, `Company Name`, `Street Address`, `City`, `Postcode`, `Phone Number`, `Website Domain`, `Primary Tape Application`, and `Required Tape Specification`. Optional `Country`, `Latitude`, `Longitude`, and `External ID` columns are also accepted.

`Acc` becomes Customer; `Prospect` stays Prospect. Blank managers are Unassigned. Missing tape details are shown as missing, never invented. Imports add/update records, not delete accounts absent from an upload. Known coordinates survive re-imports. Rows with the same company, address, postcode and manager are preserved separately in source order. Keep their relative order stable across imports; add persistent External IDs for reliable long-term identity. Changes to identifying fields without an External ID create a new account. Duplicate External IDs should be resolved upstream.

The supplied workbook has **24,048 rows**, including 675 additional occurrences of company/address/manager identities. It has **no coordinates or country field**. Only 708 rows have street addresses; city or postcode matches can be approximate. Initial import therefore populates the account list and location review queue, not guessed map pins.

## Place accounts on the map

Select an account. Enter a country and search with OpenCage, then choose a candidate after reviewing its address. An `OPENCAGE_API_KEY` must be configured on the server for this search; it never goes to the browser. Searching transmits that account's address to OpenCage. Provider confidence is advisory, not a precision guarantee. Alternatively enter verified latitude/longitude directly, or import an enriched workbook with coordinates.

For this 24,048-row dataset, the recommended bulk preparation is to add a country and stable External ID to each account, geocode through an appropriately licensed provider with a sufficient quota, review ambiguous matches, and import the resulting Latitude/Longitude columns. This version does not implement a bulk geocoding worker or silently resolve uncertain addresses. OpenCage quotas and service charges are separate from hosting. OpenStreetMap tiles are suitable for initial internal usage subject to their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); choose a commercial tile provider before high-volume rollout. Attribution is retained on the map.

## Invite colleagues

Sign in through **Administrator sign-in** using the server's `SALES_MAP_PASSWORD`. Open **Team**, create an invitation for a colleague's email, and send the generated private link yourself. The app does not send emails. Links expire after seven days, are single use and allow the recipient to set their own password. Share them directly: possession of the link grants access to its named account. Colleagues can view and filter; only the administrator can import data, edit locations and manage invitations. Sessions expire after 12 hours and restart on server restarts. Revoking a colleague immediately invalidates their sessions. To reset their password, revoke and reinvite them.

## Publish privately

See [deployment instructions](docs/deployment.md). A Render Blueprint and Dockerfile are included. This needs a backend with persistent storage and HTTPS; GitHub Pages alone cannot run the private database or authentication. Source publication and hosting are separate. No customer workbook is included in the Git repository or container image. Import the spreadsheet into your deployed service after sign-in.

## Future CRM connections

See [CRM integration design](docs/crm-integration.md). The shared record normalizer and storage interface support source-qualified external IDs. No HubSpot or NetSuite connection is active yet; those require an integration task, credentials, field mapping and a sync policy.

## Data and backups

The default data directory is `./data` (override `DATA_DIR`). It contains private accounts, password hashes and invitations. Back up the whole data directory with SQLite-consistent backups or stop the app before copying it; include WAL files if making a stopped filesystem backup. Restrict backups like the source spreadsheet. Run one application instance per SQLite disk. Do not deploy multiple instances with separate disks or an ephemeral filesystem.

The dependency override for ExcelJS's `uuid` uses the patched 11.x line. ExcelJS only calls its compatible v4 generator; import tests exercise this combination.
