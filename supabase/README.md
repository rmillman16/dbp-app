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
| `007_estimating_quotations.sql` | Quotations without a job (Estimating: small works, new enquiries), with their own project name and EST numbering | ✅ Run 20 Nov 2026 |
| `008_enquiries.sql` | Estimating enquiries (E001…) with client details, dates and status; quotations belong to an enquiry and are numbered per enquiry; won enquiries become jobs | ✅ Run 20 Nov 2026 |
| `009_applications.sql` | Client applications: priced SoW import (sections, FOC / Excl text, below-the-line items), psum adjustment, practical completion, VAT, Client Assessment comments | ✅ Run 20 Nov 2026 |
| `010_valuation_reminders.sql` | Monthly "valuation due" reminders on every live job, one week before month end, start to PC (rebuilt when dates change) | ✅ Run 20 Nov 2026 |
| `011_valuation_reminder_timing.sql` | Valuation reminders due on month end and shown only in the last 7 days (other reminders keep 14 days) | ✅ Run 20 Nov 2026 |
| `012_subcontracts.sql` | Subcontract payment notices: order trade, subcontractor's stated previous, previous-notice figures, notes, adjustment blocks | ✅ Run 20 Nov 2026 |
| `013_eot.sql` | EOT: VO programme days become delay events automatically; notice period per job and notice reminders on the bell; event numbers, days granted | ✅ Run 20 Nov 2026 |
| `014_eot_clauses.sql` | EOT clauses typed in per job (notice, extension of time, loss and expense; no defaults) and per delay event (Relevant Event), plus area / mitigation / recap; job's client contact; user job title; notice of delay wording in DBP's style | ✅ Run 20 Nov 2026 |
| `015_cvr.sql` | CVR: cost packages from the office SoW (target, note, OH&P / management / design omitted, EP %), iPlicit job costing import columns, suppliers allocated to packages (remembered, can be split), agreed VO costs to a package, draft / final CVRs and per-month forecasts | ✅ Run 20 Nov 2026 |
| `016_cvr_groups.sql` | CVR packages grouped (Labour & materials, Subcontractors, Preliminaries, Other); prelims sections from the SoW draw down the single prelims budget ("Preliminaries – not yet split") | ✅ Run 20 Nov 2026 |

## Edge Functions (server steps)
Kept in `functions/`. Not run in the SQL Editor: deployed in Supabase › Edge Functions (see `docs/questions-for-IT.md`).

| Function | What it does | Needs | Deployed? |
|---|---|---|---|
| `read-pricing-pdf` | Reads a PDF with Claude: priced lines for quotations (`kind: pricing`), or a subcontractor's application with %, £ claimed and their totals for payment notices (`kind: application`). If not deployed / no key / no credit, the app asks for Excel instead | Secret `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL` | ⬜ Not yet (with IT) |

## Rules
- **Never re-run a script that has already been run.** 001 builds the tables from scratch and will fail (or duplicate data) on a database that already has them.
- **Changes come as a new script** (`002_…`, `003_…`) that alters what's there, so nothing already in the app is lost. Claude adds each new script here and a row to the table above.
- Before running, check the table above to see which number you're up to.
- Only the Project URL and publishable (anon) key are ever shared for the build. Never paste the secret (service-role) key or the database password into a chat.
