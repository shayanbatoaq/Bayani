# Client Financial Data

Data Input saves each client and reporting year via `/api/financial-data`. A saved record includes the signed trial balance, explicit schedule allocations, opening equity, and calculated schedules, BS, INCOME and EQUITY. A record is versioned; stale edits return HTTP 409 instead of overwriting another saved version.

The reporting convention is a calendar-year, pre-closing trial balance: debit amounts positive, credit amounts negative. Opening equity uses positive credit balances and negative deficits. Add year carries the previous saved year's closing equity into editable opening balances. Missing openings are shown as unavailable, not zero. Other equity movements reconcile supplied opening and closing balances; they are not inferred transactions.

The report layouts follow the schedules, BS, INCOME and EQUITY tabs of the shared Audit Report workbook. Historical client values, signatures, audit opinions and broken references are not copied. Property and equipment is presented at net book value from mapped trial-balance balances; this workflow does not infer an asset register or depreciation rollforward. Employee end-of-service balances are shown as closing balances because a trial balance alone cannot provide opening balances, provisions and payments.

Final Report selects saved client years and statement tabs. Excel exports retain formulas and cached values, with a hidden raw trial-balance sheet. Unselected statement tabs remain hidden when required by formulas. PDF exports contain only selected statement sections and years. Downloads use the latest saved version, not an unsaved page draft. Unmapped ledgers block export; unbalanced records and missing opening equity remain visibly flagged in previews and exports.

## Storage

Signed-in users' companies, financial records, bank reconciliations, audit requests, plans and logos are stored in the Supabase `finscope_user_data` table. Row Level Security restricts every row to its authenticated owner. Financial and company saves use database revisions to reject stale edits.

For local development without Supabase credentials, records continue to use an ignored `.data/financial-records` directory and a random HttpOnly, SameSite=Strict workspace cookie. Set `BAYANI_DATA_DIR` for a persistent local Node server; the old `FINSCOPE_DATA_DIR` variable remains supported for existing setups. That local workspace is browser-specific and is not a cloud account. Do not enable filesystem storage for real Vercel clients; serverless files are ephemeral.

See `setup.md` for Supabase and Vercel configuration. Local filesystem records are not automatically migrated to Supabase.

## AMA Contact

The contact destination is deliberately blank until approved. Set `AMA_CONTACT_URL` to an approved HTTPS contact page or `mailto:` address when ready. The Audit popup is dismissible and can be reopened from its contact button. It does not claim that a request was submitted or send client data automatically.
