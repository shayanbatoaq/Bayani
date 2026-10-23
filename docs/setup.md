# Setup: sign-in, document extraction, company limit

## Sign-in (Supabase)

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Without them the app runs in demo mode: every sign-in option opens the workspace and data is stored against a browser cookie.

Sign-in is passwordless:

- **Email**: Supabase email link (magic link). Name and country are stored in the user's metadata at sign-up.
- **Google, Facebook, Apple**: enable each provider in Supabase → Authentication → Providers, with the client ID and secret from Google Cloud, Meta for Developers and Apple Developer.

In Supabase → Authentication → URL Configuration, add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local work) to the redirect URLs. Both OAuth and email links return through `/auth/callback`, which sets the session cookie and sends the user to `/profile`.

Social sign-up does not collect a country, so users can add it on the Profile page.

## Document extraction

Profile → New company → Upload documents reads the Trade License, MOA / Articles, VAT certificate and Corporate tax certificate.

- With `OPENAI_API_KEY` (or `OPENROUTER_API_KEY`) set, documents are sent to the model for extraction. Text-based PDFs are sent as text; scanned PDFs and images are sent as files. Override the model with `OPENAI_EXTRACT_MODEL` / `OPENROUTER_EXTRACT_MODEL` (default `gpt-4.1-mini`).
- Without a key, text-based PDFs are parsed with built-in rules. Scanned documents need the AI key, or the details are entered manually.

Extracted values always open in the form for review before saving. Uploaded files are not stored; only the file names are recorded on the company.

## Company limit

One company per subscription in the live product; each further company is a paid add-on, recorded for a profile as `extraCompanies` in `plan.json` in its data folder. Test mode allows up to 10 companies without payment: it is on in development (`npm run dev`) and can be turned on for a production build with `FINSCOPE_TEST_MODE=true` (or off in development with `FINSCOPE_TEST_MODE=false`). `FINSCOPE_COMPANY_LIMIT` overrides both. Adding beyond the limit shows the upgrade panel. Payment collection is not connected yet.

## Storage

Companies are saved beside the financial records under `.data/financial-records/<owner>/companies/`. See `financial-data.md` for storage and persistence requirements.

## Invoices, bills and adjustments

- Books (clients, suppliers, invoices, credit notes, bills, payments, schedules) are kept per company in `books/<companyId>.json` under the workspace folder; bill documents in `books/attachments/<companyId>/`.
- Their accounting is added to each year's trial balance when records are read (rows with ids starting `books-`); they are never saved with the typed figures.
- Bill reading runs in the browser (PDF text or OCR) with document rules. With `OPENROUTER_API_KEY` or `OPENAI_API_KEY` set, an AI reading (text and, for photos, the image) fills what the rules miss. `OPENROUTER_EXTRACT_MODEL` / `OPENAI_EXTRACT_MODEL` choose the model.
- E-invoicing quote requests are saved in `asp-requests.json`; set `FINSCOPE_ASP_WEBHOOK` (or the audit webhook) to forward them.
