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
| `017_cvr_split_by_amount.sql` | CVR: a supplier's cost split across packages by £ as well as by % | ✅ Run 20 Nov 2026 |
| `018_cvr_budget_lines.sql` | CVR: keeps the office SoW's lines (each item's cost and OH&P by package) for the breakdown sheet of the CVR export; re-import the SoW afterwards | ✅ Run 20 Nov 2026 |
| `019_programme_and_cashflow.sql` | Programme import (DBP Timeline / P6 .xer: activities, sections, trades, dates) and the cashflow: the job's payment stages (Deposit, Progress, Delivery, Installation…, renamable) and each SoW section's / VO's linked activities and weighting | ✅ Run 20 Nov 2026 |
| `020_cashflow_weight_by_amount.sql` | Cashflow: a package's stages weighted by £ as well as by % | ✅ Run 20 Nov 2026 |
| `021_cashflow_trades.sql` | Cashflow by trade: the trade each package goes into (e.g. "Subbie – 9 Electrical installation" → Electrical), suggested and confirmed once per job | ✅ Run 21 Nov 2026 |
| `022_cashflow_line_trades.sql` | Cashflow: each subcontract line's trade where it's overruled (the app picks it from the line's description) | ✅ Run 21 Nov 2026 |
| `023_procurement.sql` | Procurement schedule: appointed subcontractor and order details on each package; SoW lines moved or split by £ across packages | ✅ Run 21 Nov 2026 |
| `024_procurement_names.sql` | Procurement: a package's own name (e.g. "Electrical (install)", "Tiles (supply)"); lead time now includes design | ✅ Run 21 Nov 2026 |
| `025_programme_editing.sql` | Programme (Timeline) in the app: trade colours and shutdowns per programme; links between tasks (finish-to-start, start-to-start, finish-to-finish, lag days) for moving followers and the critical path; room for progress | ✅ Run 22 Nov 2026 |
| `026_programme_timeline_features.sql` | Programme: every Timeline feature (programme start, Wk 1, client logo, section order; contractor, RAG, prerequisites, skeleton crew, baseline per task; issued revisions with history); programmes for Estimating enquiries (move to the job when won) | ✅ Run 22 Nov 2026 |
| `027_programme_original.sql` | Programme: which committed revision is the original (contract) programme, for the overlay and slip against it (e.g. for an EOT) | ✅ Run 22 Nov 2026 |
| `028_programme_critical.sql` | Programme: a task can be marked as on the critical path (ticked in the task form), as well as those the links make critical | ✅ Run 22 Nov 2026 |
| `029_eot_programme_slip.sql` | EOT: a delay event can quote one programme task's slippage against the original programme (kept as quoted) | ✅ Run 22 Nov 2026 |
| `030_sampling.sql` | Sampling tracker: quantity, programme activity and weeks before (due date follows the programme), photos and approvals uploaded (private storage area "samples"), samples due on the bell | ✅ Run 22 Nov 2026 |
| `031_sample_omitted.sql` | Sampling: an "Omitted" status (set by DBP when the client hasn't updated the schedule; not on the bell) | ✅ Run 22 Nov 2026 |
| `032_requisitions.sql` | Site: material requisitions (one list across all jobs; the buyer's questions to the requester go on their bell and the job's To do), attachments (storage "requisitions"); reminders addressed to one person show only to them | ✅ Run |
| `033_requisitions_instant.sql` | Requisitions: the bell updates instantly (Realtime on notifications); a buyer's question / requester's answer is due today so it shows straight away | ✅ Run |
| `034_operations_user_type.sql` | Operations user type (admins tick it in Settings › Users); requisitions locked: Operations / admins see all, everyone else only their own | ✅ Run |
| `035_profile_types.sql` | Profile types (project manager, commercial, site management, design, accounts, external, operations; admin as before) and the access grid admins tick in Settings › Access; no type yet = today's access | ✅ Run |
| `036_access_requests.sql` | Request access: the no-access screen sends IT a request (bell); admins mark the IT login(s) in Settings › Users; requests listed in Settings | ✅ Run |
| `037_admins_from_app.sql` | Admins can make other people admins from Settings › Users (not yourself off, never the last admin) | ✅ Run |
| `038_requisition_supplier_text.sql` | Requisitions: supplier is a typed text box, not a dropdown | ✅ Run |
| `039_off_hire_reminders.sql` | Hire: Off-hired status; the ops team get a reminder 3 days before a hire ends (bell and job To do); requester updates say "voided" | ✅ Run |
| `040_off_hire_requester.sql` | Off-hire reminders also go to whoever raised the hire | ✅ Run |
| `041_notification_emails.sql` | Notification emails: what's been emailed, each person's on / off (My details); new requisitions notify the ops team | ✅ Run |
| `042_archive_jobs.sql` | Archiving jobs: admins only; an archived job and everything filed under it is read-only; reminders keep running | ✅ Run |
| `043_access_in_database.sql` | The access grid enforced by the database for every part (needed before External logins); shared lists stay open; requisition site list via requisition_sites() | ✅ Run |
| `044_dashboard_access.sql` | Company dashboard: ticked for Project manager and Commercial in Settings › Access | ✅ Run |
| `045_minutes.sql` | Meeting minutes: meetings, attendees and points; an action with a staff owner goes on their bell (moved / closed as it changes; Done on the bell ticks it); My tasks; Job › Minutes in Settings › Access; archived jobs read-only | ✅ Run |
| `046_minutes_per_project.sql` | Minutes live in each job or estimate (run after 045): meetings for Estimating enquiries (follow Estimating access), moved to the job when won; estimate actions on the bell; My tasks and ticking done for estimates | ✅ Run |
| `047_om.sql` | O&M: tracker lines (sort, kept when a standard doc is removed), file sections per job (om_job), Job › O&M access, reminders to the job team per company and due date (bell + job TODO) | ✅ Run |
| `048_om_link_check.sql` | O&M: keeps whether each SharePoint link can be opened by anyone (green tick), checked by the check-link function | ✅ Run |
| `049_om_item_names.sql` | O&M: add your own project items to the dropdown list (offered on every job) | ✅ Run |
| `050_om_packages.sql` | O&M: items by SoW package (package_id), received = has a link (status follows the link), removing items / list entries for admins and Operations only, reminders per package | ✅ Run |
| `051_requisitions_my_sites.sql` | Requisitions for my sites: people on a job's Team see all its requisitions; only the requester or the buyer can post in the conversation | ✅ Run |
| `052_tasks.sql` | Tasks: set a task for yourself or any DBP team member (optionally on a job, with a due date); it goes on their bell and the job's TODO; done tells whoever set it | ✅ Run |
| `055_pqq_forms.sql` | Which PQQ / account form goes to whom: PQQ (subcontractor), PQQ B (sole trader), PQQ C (consultant), New Supplier account form; chosen per company, attached automatically (run after 054) | ✅ Run |
| `056_variation_files.sql` | Subcontract variations on an order: instruct (letter + Outlook draft), files filed per variation in the order folder, instructed date (run after 055) | ✅ Run |
| `057_rfis.sql` | RFIs: register, templates (people by role), replies, files, per-RFI chase frequency, chase and weekly unanswered report (run after 056; then redeploy send-emails) | ✅ Run |
| `058_rfi_project_templates.sql` | RFI templates per project: each job has its own templates naming its own people (anyone with RFI access edits them on the job); the Settings ones stay as standard starting points (run after 057) | ✅ Run |
| `059_rfis_estimating.sql` | RFIs on estimates (tenders): an RFI, template or directory entry belongs to a job or an enquiry; all move to the job when the enquiry is won; reminders name the enquiry; draft RFIs (not chased, nobody told) and issuing tender queries to the client as one Excel schedule (run after 058; then redeploy send-emails) | ✅ Run |
| `060_submittals.sql` | Submittals: per job, revisions (A, B, C…) with responses (approved / approved as noted / revise / rejected), people from the project directory, per-submittal chasing, templates per project, Monday report (run after 059; then redeploy send-emails) | ✅ Run |
| `061_external_access.sql` | Outside access to RFIs and submittals with no login: private link per item per person (hashed, expiring, revocable), email-code page, rate limits, "Copy a link" on RFI / submittal pages; deploy the new `external` function (Verify JWT off) and redeploy send-emails (run after 060) | ✅ Run |
| `062_rfi_variation.sql` | RFI to variation: raise a draft VO from an answered RFI (question and answers carried across), linked both ways (run after 061) | ✅ Run |
| `063_directory_roles.sql` | Project directory roles: a fuller list (client side, design team, management / statutory, every trade), shared and addable from the dropdown (run after 062) | ✅ Run |
| `064_progress_reports.sql` | Progress reports within jobs: numbered per job, period, sections switched on / off, narrative + pulled-in programme / RFIs / submittals / sampling / procurement / VO / EOT status, photos, appendices merged into one PDF, Word export, reminder when the next is due; then redeploy send-emails (run after 063) | ✅ Run |
| `065_service_role_grants.sql` | Lets the server (service_role) use the tables the Edge Functions read and write: fixes "permission denied for table external_links" on an outside link (run after 064) | ✅ Run |
| `066_rfi_follow_up.sql` | An RFI goes back and forth: DBP's reply to an answer re-opens it (unanswered) and tells the assignee again, outside assignees by email with their link; redeploy send-emails (run after 065) | ✅ Run, send-emails redeployed |
| `067_tender_enquiries.sql` | Tender enquiries: send a package to contractors as Outlook drafts, and the tender tracker in Estimating (status, chasing, quotes per contractor) | ✅ Run |
| `068_enquiry_contract_details.sql` | Main contract, sub-contract and project summary on an enquiry; a phone number in My details (the tender enquiry emails use them) | ✅ Run |
| `069_submittal_status_abc_rfi_court.sql` | Submittal statuses A / B / C for each document, revision names (Initial issue, Rev A, Construction issue), and a DBP reply to an answered RFI puts it back with the assignee. Run it BEFORE redeploying the external function (run after 068) | Not run yet |
| `070_snagging.sql` | Snagging: numbered snags per job (never changed or reused), photos, assignee from the project directory, status, the approver's check task, and private links for trades. Mobile-first (run after 069) | ✅ Run |
| `071_breeam.sql` | BREEAM tracker: a BREEAM tick box on the job and a tracker (status dropdown per line: not complete / in progress / completed / by others / no action required), imported from Excel (run after 070) | Run 24 Nov |
| `072_breeam_columns.sql` | BREEAM tracker columns from a real tracker: credits achieved, credit criteria, evidence required, prerequisite flag (run after 071) | Run 24 Nov |
| `073_breeam_evidence.sql` | BREEAM evidence: a record of the files filed against each BREEAM line (the files go into the synced SharePoint EXTERNAL / 08. BREEAM folder) (run after 072) | Run 24 Nov |
| (function) `tender-scope` | Drafts a scope of works from uploaded drawings in the tender enquiry generator. Deploy in Supabase › Edge Functions with **Verify JWT on**; add the secret `ANTHROPIC_API_KEY` (optional `SCOPE_MODEL`, default claude-opus-5-5) | Not deployed yet |
| (function) `snag-external` | A trades person's own snag list on a private link, no login (tick done, photo as proof). Deploy in Supabase › Edge Functions with **Verify JWT OFF** (paste supabase/functions/snag-external/index.ts). Needs 070 | Not deployed yet |
| (function) `external` redeploy | Re-paste supabase/functions/external/index.ts AFTER running 069 (whose turn an RFI is; Status A/B/C per document; revision names) | Redeploy needed |
| `053_task_details.sql` | Task details, as in Microsoft To Do (run after 052): important (star), steps, My Day, remind me on a date (bell and email that day), repeat (the next one is set up when it's done, from the page or the bell), files on a task (storage "tasks"); bell links open the task | ✅ Run |
| `054_orders_pqq.sql` | Orders (was Payment notices): order numbers 2611_FISL_001, package from the procurement schedule with delivery date, placing an order fills in the procurement schedule, appendices (any file) + a standard library in Settings, contractors' PQQ tracking (12 months, documents with expiry dates, sent log, reminders to whoever chases), DBP certifies each payment-notice line by % or £ (run after 053) | ✅ Run |

## Edge Functions (server steps)
Kept in `functions/`. Not run in the SQL Editor: deployed in Supabase › Edge Functions (see `docs/questions-for-IT.md`).

| Function | What it does | Needs | Deployed? |
|---|---|---|---|
| `read-pricing-pdf` | Reads a PDF with Claude: priced lines for quotations (`kind: pricing`), or a subcontractor's application with %, £ claimed and their totals for payment notices (`kind: application`). If not deployed / no key / no credit, the app asks for Excel instead | Secret `ANTHROPIC_API_KEY`; optional `ANTHROPIC_MODEL` | ⬜ Not yet (with IT) |
| `manage-users` | Admins (IT included) add users, reset passwords and switch logins off / on from Settings › Users. Checks the caller is an admin. Uses the server key Supabase gives Edge Functions automatically: nothing to set | None | ✅ Deployed |
| `send-emails` | Emails people their new notifications (questions, answers, updates, new requisitions, off-hire reminders, access requests, minutes actions, tasks, task reminders, PQQ and document expiries, RFI and submittal chasers) and the Monday list of unanswered RFIs and submittals from DBP's Microsoft 365 mailbox. Sends nothing until the secrets are set | `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SENDER`, `APP_URL`, `CRON_SECRET` (from IT) | ✅ Deployed (23 Nov, with chasing, outside emails and report reminders); secrets and Cron still to do with IT |
| `external` | The ONLY door for outside people (subcontractors, consultants, client) to RFIs and submittals: private link per item or email code; returns just their own item; replies / responses; file upload and download through short-lived addresses; rate-limited. Deploy with **Verify JWT OFF**. Email sign-in needs the Microsoft 365 secrets as send-emails | ✅ Deployed (23 Nov, Verify JWT off) |
| `check-link` | Opens an O&M SharePoint link with no sign-in (as the client would) to see if anyone can open it: green tick / sign-in needed / broken. Only SharePoint / OneDrive links; signed-in users only | None | ✅ Deployed |

## Rules
- **Never re-run a script that has already been run.** 001 builds the tables from scratch and will fail (or duplicate data) on a database that already has them.
- **Changes come as a new script** (`002_…`, `003_…`) that alters what's there, so nothing already in the app is lost. Claude adds each new script here and a row to the table above.
- Before running, check the table above to see which number you're up to.
- Only the Project URL and publishable (anon) key are ever shared for the build. Never paste the secret (service-role) key or the database password into a chat.

### Deploying `manage-users` (about 2 minutes, no IT needed)
1. Supabase › **Edge Functions** › **Deploy a new function** › **Via Editor**.
2. Name it exactly `manage-users`.
3. Delete the sample code, paste the whole of `functions/manage-users/index.ts`, then **Deploy function**.
4. In the app: Settings › Users › **+ Add user**.
   - If it says "Invalid JWT", open the function's **Details** in Supabase, turn **Verify JWT** off, and save. The function checks sign-in and admin itself.

### Setting up notification emails (`send-emails`)
1. Run `041_notification_emails.sql`.
2. Deploy the function as for `manage-users`: name it `send-emails` and paste `functions/send-emails/index.ts`. Turn **Verify JWT** off; the function checks callers itself.
3. Supabase › Edge Functions › **Secrets**: add the six secrets above. IT provides the Microsoft ones (questions-for-IT §2). `CRON_SECRET` is any long random text you make up.
4. Supabase › **Integrations › Cron** (enable it if asked) › **Create job**:
   - name `send-emails`, schedule every 2 minutes (`*/2 * * * *`);
   - type **Supabase Edge Function**, method POST, function `send-emails`;
   - add the header `x-cron-secret` with the same text as `CRON_SECRET`.

   This sends off-hire reminders on their day; everything else also goes straight away when it happens.
| `074_defects_job.sql` | An overarching "0 DEFECTS" job so material / hire requisitions can be raised for defect work on an old job or one before the app (run after 073) | Not run yet |
| `075_requisition_order_files.sql` | Order documents on requisitions: the buyer attaches a receipt / order confirmation, emailed to the requester when set to Ordered (run after 074; then redeploy `send-emails`) | Not run yet |
| `084_inspection_inspector.sql` | The inspector's name on the external H&S inspection log (run after 083) | Not run yet |
| `085_minutes_upgrade.sql` | Minutes: overdue-action chasing (staff bell + outside email), meeting numbers and types, apologies, links to RFIs/snags, issue record and lock, outside owners' actions (run after 084). Needs `send-emails` and `external` redeployed, and `minutes-draft` deployed (Verify JWT ON, uses the ANTHROPIC_API_KEY secret) | Run 24 Nov |
| `087_final_account.sql` | "Final account" flag on applications, so the list shows when a project is finished off (run after 086) | Run 24 Nov |
| `088_email_signature.sql` | The du Boulay email signature (Settings › Email signature) added to every email going outside the company (run after 087; then redeploy `send-emails`, `send-minutes` and `external`) | Not run yet |
| `089_suggestions.sql` | Settings › Suggestions and issues: admins log problems and ideas with photos (admins only; private `suggestions` photo area) | Not run yet |
| `086_weekly_briefing.sql` | Monday briefing: records who has had this week's friendly "your week ahead" email (run after 085; then redeploy `send-emails`) | Not run yet |
| `076_job_checklist.sql` | Project checklist on the job Overview: H&S and compliance items (F10, construction phase plan, principal designer / contractor, building control, insurances…) (run after 075) | Run 24 Nov |
| `077_standard_clauses.sql` | Standard clarifications and exclusions library, filled from the draft Schedule of Works templates (Templates › Clause library; tick them onto quotations) (run after 076) | Run 24 Nov |
| `078_project_hub.sql` | Project hub link on each job (one SharePoint link for outside people) and the queue for the automatic welcome email to anyone added to a job's project directory (run after 077; then redeploy `send-emails`, deploy `send-minutes`) | Run 24 Nov |
| `079_snag_send_back.sql` | Sending a snag back: reason, how many times, and the earlier proof photos kept as "previous" (run after 078; then redeploy `snag-external`, Verify JWT off) | Not run yet |
| `080_usage_tracking.sql` | Settings › Usage: page views by area / tab / person / day (admins read them; everyone adds their own) (run after 079) | Not run yet |
| `081_health_safety_and_access.sql` | Job › H&S (site diaries, delivery notes, H&S inspections, photos) and the new parts of the access grid: Job › Snagging, H&S, BREEAM, Progress reports, Project checklist, seeded from the parts they used to ride on (run after 080) | Not run yet |
| `082_accident_reports.sql` | Job › H&S › Accidents: the standard accident / incident report (numbered A001…, RIDDOR, corrective actions, photos; only admins can delete) (run after 081) | Not run yet |
| `083_inspection_tracker.sql` | Job › H&S › Inspections as a tracker for other parties' inspections: how often, reports logged with the file, next due, reminders and weekly chasing to the PMs (run after 082; then redeploy `send-emails`) | Not run yet |
| `090_inventory.sql` | Site › Inventory: locations (first: Workshop 6), items with stock, requests to site (IR0001…); new access item "Site › Inventory - ADMIN" for Operations (run after 089) | Run 25 Nov |
| `091_inventory_returns.sql` | Inventory: mark issued items returned (back into the stock) or lost (stay off it) (run after 090) | Run 26 Nov |
| `092_inventory_codes_archive.sql` | Inventory: every item gets a code (W6-0001…) for labelling / barcodes; a lost last item is archived and can be restored (run after 091) | Run 26 Nov |
| `094_delete_jobs.sql` | Admins can delete a job made in error (everything filed under it goes too; run after 093) | Run 26 Nov |
| `095_programme_delete_admin.sql` | Only admins can delete a programme or a saved programme revision (from History); run after 094 | Run 26 Nov |
| `096_meeting_format.sql` | Minutes: each meeting is marked internal, external, 1-to-1 or workshop (run after 095) | Run 26 Nov |
| `097_meeting_kinds_free.sql` | Minutes: new standard kinds, and jobs can add their own (run after 096) | Run 26 Nov |
| `098_enquiry_start_duration_cdp.sql` | Estimating › enquiry: proposed start date, proposed duration and CDP items, which feed into the tender emails | Run 26 Nov (via migration) |
| `099_delete_enquiries.sql` | Admins can delete an estimating enquiry made in error (not one that was won) | **Run it** |
