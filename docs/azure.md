# Deploy SalesMap to your Azure subscription

## What to subscribe to

Start with **one Azure Pay-As-You-Go subscription** associated with your existing Microsoft 365/Entra tenant. Microsoft 365 administrator privileges do not automatically provide an Azure subscription or resource-deployment rights. You need Contributor rights on the target resource group (or suitable subscription permissions to create it and register providers). Do not send passwords, API keys, payment information or access tokens through chat.

The supplied resource template creates these services under that subscription:

| Resource                                      | Purpose                                                   | Initial configuration                                                     |
| --------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------- |
| App Service                                   | Private application with sign-ins                         | Linux Basic B1, one instance, HTTPS only, Node 24                         |
| Azure Database for PostgreSQL Flexible Server | Persistent contacts, reviewed coordinates and invitations | PostgreSQL 17, Burstable B1ms, 32 GiB, seven-day backups, private network |
| Azure Maps                                    | Street tiles and address lookup                           | Gen2, usage-based billing; key stays on the server                        |
| Virtual network and private DNS               | Connect the web app to the database                       | Database has no public network access                                     |

The template is `infra/azure/main.json`. Resource availability, subscription quotas and actual pricing depend on your region. Use the Azure pricing calculator and review the deployment estimate before creating resources; set a subscription budget/cost alert. A budget alert is not a hard spending cap. The app restricts Azure Maps requests to signed-in users and applies request rate limits. Geocoding 24,048 contacts may incur substantial usage; there is no automatic bulk geocoding job.

There is no separate OpenCage subscription required when Azure Maps is used. A custom domain, Microsoft 365 upgrade, Azure Container Registry and third-party hosting account are not required for this deployment.

## Create or locate the subscription

1. Sign in to https://portal.azure.com with your work Microsoft account. Select the correct directory/tenant.
2. Open **Subscriptions**. If none exists, create an Azure subscription through your organisation's billing process. Your Microsoft 365 subscription is separate from an Azure hosting subscription.
3. Ensure you can create a resource group and register Microsoft.Web, Microsoft.DBforPostgreSQL, Microsoft.Network and Microsoft.Maps in that subscription.
4. Note the subscription ID. It is an identifier, not a password. Actual authentication must happen through the Azure sign-in flow, not a token pasted into chat.

## Deploy

Use a Linux machine with Azure CLI, Node 24+, npm, Python 3, zip and this checkout. Azure Cloud Shell is an option if Node 24 is available there. Sign in:

```sh
az login
```

Run a validation/what-if first. Choose a globally unique application name:

```sh
bash scripts/deploy-azure.sh \
  --subscription YOUR_SUBSCRIPTION_ID \
  --resource-group jtape-salesmap \
  --name YOUR_UNIQUE_SALESMAP_NAME \
  --location uksouth
```

The script prompts securely for the app administrator password and generates a separate random database password. It writes them only to a permission-restricted temporary parameter file that is removed on exit. No secret values are committed or printed. It creates a resource group and registers providers, then validates the template and shows proposed changes. Those steps do not create the billable application/database/maps resources.

After reviewing the services and costs, rerun the same command with `--apply`. The script tests/builds locally, packages production dependencies, creates the Azure resources and deploys the package. The customer workbook, local database, `.env` and test data are excluded. Azure Maps keys and the TLS-verified database connection are supplied to the app through encrypted App Service settings. No map API key is sent to browsers.

**Important:** rerunning a deployment generates a new database password and applies the administrator password you enter, replacing those settings. Coordinate changes during a maintenance window. The app database contents are preserved; active application sessions end on restart. Review every what-if. Do not deploy a second instance until session storage has been moved out of process memory.

The template has not been validated against a live subscription during preparation; its Azure resource deployment, regional SKU availability, live tile/geocoding calls and public HTTPS endpoint must be validated after Azure access is available. The local PostgreSQL adapter and offline map are independently tested.

## Validate before sharing

1. Confirm the supplied HTTPS URL shows the sign-in page and `/api/accounts` returns 401 without a session. `/api/health` returns `{"ok":true}`. Check App Service logs without dumping app settings or credentials.
2. Sign in using **Administrator sign-in** and your chosen administrator password. Upload the original workbook through **Import workbook**. All 24,048 source rows should be present. Import again and confirm zero new rows.
3. Confirm Azure Maps street tiles load. In browser network tools, requests should go to the same-origin `/api/map/tiles/…` route with no provider key visible. The offline country map is retained if street tiles fail.
4. Select an account with a known address, enter its correct country, and search for candidates. Review accuracy before saving. The original workbook has no countries or coordinates, so imported accounts do not become guessed pins.
5. Create a single-use invitation for a colleague. Confirm they can view/filter but cannot import, change locations or manage users. Revoke them and confirm access ends.
6. Check PostgreSQL automated backup settings and test a restore through Azure before relying on the app. Configure budget alerts and monitor maps usage.

## Microsoft sign-in

The initial application uses the tested per-colleague invitation/password system. Having Microsoft 365 does **not** mean Microsoft single sign-on is already configured. Entra ID SSO can be added using a tenant-specific app registration, access assignments and application-role mapping. Do not enable “any Microsoft account” or grant the entire tenant access by accident. The app's invitation permissions should remain enforced when adding SSO.
