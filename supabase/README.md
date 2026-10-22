# Bayani Supabase Setup

The current app stores signed-in client data in `finscope_user_data`. Its production migrations are in `migrations/` and are already applied to the connected FinScope project. They enable owner-scoped Row Level Security and a revision-checked save function.

Configure the project URL and publishable key as described in `../docs/setup.md`. Do not use a service-role or secret key in the app.

`schema.sql` and `seed.sql` are retained for the earlier assessment prototype; do not run them to set up the current product.
