# DBP super app · Supabase database scripts

Every change to the database is a numbered script in this folder. Run them **in number order, once each**, in Supabase › SQL Editor › New query › paste › Run.

| Script | What it does | Run on Supabase? |
|---|---|---|
| `001_dbp_app_schema.sql` | First set-up: all 40 tables, company details, 2026–27 insurances and their reminders, CAR limit check, security (signed-in users only) | ✅ Run 20 Nov 2026 |
| `002_car_limit_no_duplicates.sql` | CAR limit check only adds one notification per job (001 added one on every save) | ✅ Run 20 Nov 2026 |
| `003_grant_signed_in_access.sql` | Gives signed-in users access to the tables (fixes "permission denied"); signed-out visitors still blocked | ✅ Run 20 Nov 2026 |
| `004_variation_date.sql` | Adds the VO date (date raised) shown on the VO sheet and summary | ✅ Run 20 Nov 2026 |
| `005_admins_and_templates.sql` | Admin logins (Richard first); only admins change templates; wording templates table; insurance reminders follow each cover's dates | ✅ Run 20 Nov 2026 |
| `006_quotations.sql` | Quotation details for the waterproofing-quote layout: client, prepared by, site, opening line, scope and qualification groups, validity note, line headings, appendices, T&Cs on/off, editable add-on clauses | ✅ Run 20 Nov 2026 |
| `007_estimating_quotations.sql` | Quotations without a job (Estimating: small works, new enquiries), with their own project name and EST numbering | ⬜ Not yet run |

## Rules
- **Never re-run a script that has already been run.** 001 builds the tables from scratch and will fail (or duplicate data) on a database that already has them.
- **Changes come as a new script** (`002_…`, `003_…`) that alters what's there, so nothing already in the app is lost. Claude adds each new script here and a row to the table above.
- Before running, check the table above to see which number you're up to.
- Only the Project URL and publishable (anon) key are ever shared for the build. Never paste the secret (service-role) key or the database password into a chat.
