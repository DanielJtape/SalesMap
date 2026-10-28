# Private deployment

The repository contains application code and no contact data. Deployment is a separate action; nothing is published by running the local setup.

## Render (suggested first deployment)

1. In Render, create a Blueprint from this GitHub repository and its `render.yaml`. The starter service and persistent disk are paid resources; confirm the quoted price there before deploying.
2. Set `SALES_MAP_PASSWORD` to a long, unique administrator password using Render's secret settings. Never put it in GitHub source or chat. No mapping API key is required to launch: the bundled country map works without one. Add `MAPS_API_KEY` (Azure Maps) or `OPENCAGE_API_KEY` later if using online address search.
3. Confirm the build command is `npm ci --include=dev && npm run build`. The explicit development dependencies are needed for Vite even though the running app uses `NODE_ENV=production`. If the service already exists, update its Build Command in Render settings or sync its Blueprint; a Git push alone does not change an existing service setting.
4. Confirm persistent disk `/var/data`, `DATA_DIR=/var/data/salesmap`, Node 24 and `TRUST_PROXY=1`. Render terminates HTTPS; production cookies require HTTPS. Do not enable broad proxy trust on a directly exposed server.
5. Deploy; check `/api/health` returns `{"ok":true}`. Open the HTTPS app, confirm it asks you to sign in, and verify an unauthenticated `/api/accounts` request returns 401.
6. Sign in as administrator and upload the original workbook. GitHub intentionally does not contain it. Review locations or upload an enriched workbook with countries and coordinates.
7. Create individual invitations through Team. Share links directly with approved colleagues. Verify a colleague can filter/view but cannot import or edit.
8. Configure disk backups and retention. Test a restore before relying on the service. Only deploy one instance against the SQLite store.

GitHub Actions validates tests and build; it does not deploy or transfer your data. Automatic deployment is disabled in the Blueprint.

## Docker / another host

```sh
docker build -t salesmap .
docker volume create salesmap-data
# Supply secrets from your platform's secret store or a local ignored env file.
docker run --env-file .env -e NODE_ENV=production \
  -e DATA_DIR=/var/lib/salesmap -p 3000:3000 \
  -v salesmap-data:/var/lib/salesmap salesmap
```

For an existing volume, ensure the container's `node` user can write to it. Put the service behind HTTPS and restrict network access as appropriate. Set `TRUST_PROXY=1` only behind one trusted proxy that overwrites forwarded headers. Do not expose the plain HTTP example as the public endpoint. The container excludes the workbook and local database; import through the deployed UI.

## Operational limits

This is a first internal release with per-user passwords and a single administrator. Invitations are bearer links, not email verification. No automatic emails, SSO/MFA, audit trail, high availability, self-service password resets or CRM sync are implemented. Those are sensible next steps for a broader rollout. Rotate the admin secret by updating the host's environment and restarting; this also ends current sessions. Rotate provider keys through the host's secret settings.
