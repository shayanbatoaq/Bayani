# Setup: sign-in, document extraction, company limit

## Sign-in (Supabase)

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is still accepted). Without them the app runs in demo mode: every sign-in option opens a browser-cookie workspace. In production, set `FINSCOPE_REQUIRE_LOGIN=true` so client data is never written to ephemeral Vercel storage.

Sign-in is passwordless:

- **Email**: Supabase email link (magic link). Name and country are stored in the user's metadata at sign-up.
- **Google, Facebook, Apple**: enable each provider in Supabase → Authentication → Providers, with the client ID and secret from Google Cloud, Meta for Developers and Apple Developer.

In Supabase → Authentication → URL Configuration, set the Site URL to the production domain and add `https://<your-domain>/auth/callback` plus `http://localhost:3000/auth/callback` to the redirect URLs. Both OAuth and email links return through `/auth/callback`, which sets the session cookie and sends the user to `/profile`.

The database schema is in `supabase/migrations/`. The production project uses the same owner-scoped migration. A signed-in account is required for persistent cloud storage; RLS prevents one account from reading another account's records.

Add the two public Supabase settings to the Vercel project's Production, Preview and Development environments, then redeploy. They use the project's URL and publishable key; do not put a service-role or secret key in any `NEXT_PUBLIC_` variable.

Social sign-up does not collect a country, so users can add it on the Profile page.

## Document extraction

Profile → New company → Upload documents reads the Trade License, MOA / Articles, VAT certificate and Corporate tax certificate.

- With `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) set, documents are sent to the model for extraction. Text-based PDFs are sent as text; scanned PDFs and images are sent as files. Override the model with `OPENAI_EXTRACT_MODEL` / `OPENROUTER_EXTRACT_MODEL` (default `gpt-4.1-mini`).
- Without a key, text-based PDFs are parsed with built-in rules. Scanned documents need the AI key, or the details are entered manually.

Extracted values always open in the form for review before saving. Uploaded files are not stored; only the file names are recorded on the company.

## Company limit

One company per subscription in the live product; each further company is a paid add-on, recorded for a profile as `extraCompanies` in `plan.json` in its data folder. Test mode allows up to 10 companies without payment: it is on in development (`npm run dev`) and can be turned on for a production build with `FINSCOPE_TEST_MODE=true` (or off in development with `FINSCOPE_TEST_MODE=false`). `FINSCOPE_COMPANY_LIMIT` overrides both. Adding beyond the limit shows the upgrade panel. Payment collection is not connected yet.

## Storage

Companies are saved in Supabase for signed-in users and in the local ignored `.data` directory during offline development. See `financial-data.md` for details.
## Invoices, bills and adjustments

- Books (clients, suppliers, invoices, credit notes, bills, payments, schedules) are kept per company: in Supabase (`finscope_user_data`, namespace `books`, bill documents in `bill-documents`) for signed-in users, otherwise in `books/<companyId>.json` under the local workspace folder. The namespaces are added by migration `20261023060000_add_books_namespaces.sql`.
- Activity log: every saved change (company, trial balance, statements uploaded, invoices, bills, payments, adjustments, VAT, corporate tax answers, audit requests) is added to namespace `activity` (or `activity.jsonl` in the local workspace folder) and shown on the Activity page. Migration `20261023180000_add_activity_log.sql` adds the namespace and a trigger that refuses edits to log rows and deletions by signed-in users. Until it is applied, changes still save but are not logged.
- Their accounting is added to each year's trial balance when records are read (rows with ids starting `books-`); they are never saved with the typed figures.
- Bill reading runs in the browser (PDF text or OCR) with document rules. With `OPENROUTER_API_KEY` or `OPENAI_API_KEY` set, an AI reading (text and, for photos, the image) fills what the rules miss. `OPENROUTER_EXTRACT_MODEL` / `OPENAI_EXTRACT_MODEL` choose the model.
- E-invoicing quote requests are saved in Supabase (namespace `asp-requests`) or locally in `asp-requests.json`; set `FINSCOPE_ASP_WEBHOOK` (or the audit webhook) to forward them.

## Currencies

- Each company has a base currency (AED, USD, GBP or EUR); the books, data input and reports are kept in it.
- Exchange rates come from the European Central Bank reference rates via `api.frankfurter.dev` (no key needed); AED and the Gulf currencies use their fixed US dollar pegs. When the service cannot be reached an approximate rate is used and marked as such. The server needs outbound HTTPS to that host.
- Reports can be shown and downloaded in another currency (IAS 21: balance sheet at the closing rate, profit and loss at the average rate, the difference in equity). Corporate tax is always computed in AED.

## Bank statements

- Statements can be added at once or over time, under any year: months are put in date order, overlapping statements of one account are joined and repeated lines counted once, and lines dated in another financial year are posted to that year (unless that year's figures were entered another way).
- Excel exports (XLSX, XLS, and the HTML or XML files some banks name .xls) and CSV are read on the device; every sheet is read.
- Statements the rules cannot read (scanned PDFs, unusual layouts) are read from their page images by AI when `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) is set; `OPENAI_STATEMENT_MODEL` chooses the model (default gpt-4.1). Every line is still checked against the running balance.
