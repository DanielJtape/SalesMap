# CRM integration boundary

Spreadsheet imports currently normalize into one account model (`server/importer.js`) and persist through `server/store.js`. A future server-side connector can call `normalizeRecord(raw, 'hubspot')` or `normalizeRecord(raw, 'netsuite')`, supply the stable CRM `externalId`, and pass normalized records to `store.upsert`. This boundary is prepared; there is no scheduled or live connector yet.

Minimum fields are company name and a stable source ID. Map lifecycle/customer status to `status`, owner to `manager`, address components plus country to their named fields, and custom tape properties to `application` and `specification`. Supply reviewed latitude/longitude when available.

HubSpot requires portal-specific private-app/OAuth access and mappings for lifecycle status, owner resolution and custom tape properties. NetSuite requires account-specific OAuth/token authentication, roles/permissions, REST or SuiteQL access and custom-field IDs. Do not assume these two CRMs use the same customer/prospect definitions.

Before implementation, agree the source of truth, CRM-to-spreadsheet identity reconciliation (to prevent duplicate accounts), sync frequency, pagination, rate limits/retries, archive/deletion behavior and preservation of reviewed locations. Add a sync ledger and source timestamps before scheduling updates. Credentials must stay server-side in the hosting secret store. Begin with a read-only one-way sync and a dry-run import report. Nothing in this project writes back to a CRM.
