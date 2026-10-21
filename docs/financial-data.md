# Client Financial Data

Data Input saves each client and reporting year via `/api/financial-data`. A saved record includes the signed trial balance, explicit schedule allocations, opening equity, and calculated schedules, BS, INCOME and EQUITY. A record is versioned; stale edits return HTTP 409 instead of overwriting another saved version.

The reporting convention is a calendar-year, pre-closing trial balance: debit amounts positive, credit amounts negative. Opening equity uses positive credit balances and negative deficits. Add year carries the previous saved year's closing equity into editable opening balances. Missing openings are shown as unavailable, not zero. Other equity movements reconcile supplied opening and closing balances; they are not inferred transactions.

The report layouts follow the schedules, BS, INCOME and EQUITY tabs of the shared Audit Report workbook. Historical client values, signatures, audit opinions and broken references are not copied. Property and equipment is presented at net book value from mapped trial-balance balances; this workflow does not infer an asset register or depreciation rollforward. Employee end-of-service balances are shown as closing balances because a trial balance alone cannot provide opening balances, provisions and payments.

Final Report selects saved client years and statement tabs. Excel exports retain formulas and cached values, with a hidden raw trial-balance sheet. Unselected statement tabs remain hidden when required by formulas. PDF exports contain only selected statement sections and years. Downloads use the latest saved version, not an unsaved page draft. Unmapped ledgers block export; unbalanced records and missing opening equity remain visibly flagged in previews and exports.

## Storage

Records are stored outside public assets under `.data/financial-records`, ignored by Git. Set `FINSCOPE_DATA_DIR` to an absolute persistent storage directory when hosting on a persistent Node server. Do not use ephemeral serverless storage for real clients.

When Supabase authentication is configured, every financial-data API request verifies the user with `auth.getUser()` and isolates files by a hash of the verified user ID. Without configured authentication, development uses a random HttpOnly, SameSite=Strict workspace cookie. This local workspace is tied to the browser's cookie and is not a cloud account. Production refuses unauthenticated storage unless `FINSCOPE_LOCAL_WORKSPACE=true` explicitly enables the local mode. No external database schema is modified by this feature.

Back up the persistent directory. Cloud/database deployment is a separate configuration step; local files are not synchronized to Supabase automatically.

## AMA Contact

The contact destination is deliberately blank until approved. Set `AMA_CONTACT_URL` to an approved HTTPS contact page or `mailto:` address when ready. The Audit popup is dismissible and can be reopened from its contact button. It does not claim that a request was submitted or send client data automatically.
