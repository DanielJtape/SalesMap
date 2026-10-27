#!/usr/bin/env bash
set -euo pipefail
# Run from a Linux machine with Azure CLI, Node 24+, npm, Python 3 and zip.
# No customer data is copied. Run without --apply to validate and review changes.
apply=false
subscription=""
resource_group=""
app_name=""
location="uksouth"
while (($#)); do
  case "$1" in
    --subscription) subscription="$2"; shift 2 ;;
    --resource-group) resource_group="$2"; shift 2 ;;
    --name) app_name="$2"; shift 2 ;;
    --location) location="$2"; shift 2 ;;
    --apply) apply=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
if [[ -z "$subscription" || -z "$resource_group" || ! "$app_name" =~ ^[a-z][a-z0-9-]{2,39}$ ]]; then
  echo "Usage: bash scripts/deploy-azure.sh --subscription ID --resource-group NAME --name unique-salesmap-name [--location uksouth] [--apply]" >&2
  exit 1
fi
for tool in az node npm python3 zip; do command -v "$tool" >/dev/null || { echo "Install $tool first." >&2; exit 1; }; done
node -e "if(Number(process.versions.node.split('.')[0])<24)throw Error('Node 24 or later is required')"
cd "$(dirname "$0")/.."
az account show --output none
az account set --subscription "$subscription"
if ! az webapp list-runtimes --os linux --output tsv | grep -qi 'NODE[:|]24'; then
  echo 'This Azure region/runtime configuration must support Node 24. Verify runtime availability before deploying.' >&2
  exit 1
fi
for provider in Microsoft.Web Microsoft.DBforPostgreSQL Microsoft.Network Microsoft.Maps; do
  az provider register --namespace "$provider" --wait --output none
done
umask 077
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
read -r -s -p 'Choose an administrator password (12+ characters): ' admin_password
printf '\n'
if ((${#admin_password}<12)); then echo 'Administrator password is too short.' >&2; exit 1; fi
# A secure temporary parameter file avoids printing secrets or putting them in CLI arguments.
printf '%s' "$admin_password" > "$stage/admin-password"
unset admin_password
python3 - "$stage" "$app_name" "$location" <<'PY'
import json,sys,secrets,pathlib
root=pathlib.Path(sys.argv[1])
params={'appName':sys.argv[2],'location':sys.argv[3],'adminPassword':(root/'admin-password').read_text(),'databasePassword':secrets.token_urlsafe(36)}
(root/'parameters.json').write_text(json.dumps({'parameters':{key:{'value':value} for key,value in params.items()}}))
(root/'admin-password').unlink()
PY
az group create --name "$resource_group" --location "$location" --output none
az deployment group validate --resource-group "$resource_group" --template-file infra/azure/main.json --parameters "@$stage/parameters.json" --output none
if [[ "$apply" != true ]]; then
  az deployment group what-if --resource-group "$resource_group" --template-file infra/azure/main.json --parameters "@$stage/parameters.json" --no-pretty-print --query "changes[].{resource:resourceId,change:changeType}" --output table
  echo 'Validation complete. The resource group was created; billable services were not deployed. Review Azure pricing, then rerun with --apply.'
  exit 0
fi
npm ci --no-audit --no-fund
npm test
npm run build
mkdir "$stage/package"
cp -R server dist package.json package-lock.json "$stage/package/"
(cd "$stage/package" && npm ci --omit=dev --no-audit --no-fund && zip -qr "$stage/app.zip" .)
az deployment group create --resource-group "$resource_group" --name salesmap --template-file infra/azure/main.json --parameters "@$stage/parameters.json" --output none
az webapp deploy --resource-group "$resource_group" --name "$app_name" --src-path "$stage/app.zip" --type zip --clean true --output none
printf 'Application deployed: https://%s.azurewebsites.net\n' "$app_name"
printf 'Sign in as administrator, import the workbook, confirm tiles and address lookup, then invite colleagues.\n'
