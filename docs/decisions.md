
## Still to build (the list, kept up to date)
- **Job Overview: To do section** (Richard, 21 Nov). The box to the right of the Schedule of works on the Overview; a placeholder for now. Parked (22 Nov): it's a PM section item, to come back to.
- **Programme / Timeline:** every Timeline feature is now in the app (22 Nov, script 026). Left to do: move the live programmes across (export each one's .json from Timeline, then use Open file… on the job's Programme tab), then retire Timeline. Richard to try it on real jobs and report back.
- **Sampling, still to do:**
  - reading PDF finishes schedules (needs the PDF-reading step, with IT);
  - feeding progress report 2.2;
  - outstanding samples on meeting agendas;
  - saving the export to SharePoint (needs the SharePoint link, with IT).
- **Sampling: external sign-off portal** (assessed 22 Nov; not to be built without Richard's go-ahead).
  - How it would work: DBP ticks samples and presses Send for sign-off. That creates a secure, expiring, withdrawable link, and the email is drafted for DBP to send. The designer sees just those samples (photo, spec, locations, supplier) and chooses Approve / Approve with comments / Reject – resubmit, with a comment and their name. That lands on the sample with a record of who decided and when, plus a reminder on the bell. No designer logins.
  - What it involves: a script for the sign-off links and two locked-down database functions (no secret keys in the app); a public page outside the sign-in; the send button.
  - Two things to settle first:
    - It reverses the 19 Nov decision that DBP records the designer's decision. Should the designer's response land directly, or as "proposed" for DBP to confirm?
    - It needs the app on a public web address (with IT).
  - About one session to build.
- **Submittals and RFIs** (Richard, 22 Nov): to scope. Technical submittals (drawings, data sheets, method statements) and requests for information, tracked per job. The 19 Nov sampling scope noted SubmittalLink covers technical submissions and drawings today, so agree first whether this replaces it or links to it. Progress report 2.2 shows the submittals summary (before samples) and design queries.
- **Enquiry generator** (Richard, 22 Nov): as in his "Enquiry Generator Preview" artifact. It drafts subcontractor enquiries in Outlook and never sends them (drafts only, as for all email). Read the artifact before scoping.
- **Archiving jobs** (Richard, 22 Nov): a finished job becomes read-only and leaves the live lists. Defects and retention reminders keep running on the bell.
- **SOPs and how-to guides per module** (Richard, 22 Nov), like the programme's help page (`/help/programme`), for each module.
- **Permissions** (Richard, 22 Nov):
  - roles;
  - what each role can see and do;
  - which jobs each person sees.

  Today every signed-in user sees and edits everything, except that admins alone change templates (script 005).
  - **Profile types: built 22 Nov (scripts 034, 035).**
    - Types: **Project manager, Commercial, Site management, Design, Accounts, Operations, External**, plus **Admin** (`profiles.is_admin`, changed only in Supabase's SQL Editor). A person can have several types.
    - Admins tick each person's types in **Settings › Users and profile types**.
    - **Settings › Access** is a grid of what each type can open: Jobs, each job tab group (Programme, Commercial, Procurement, Sampling, EOT), Estimating, Contracts, Contractors, Site requisitions, and the material and hire buyer's lists. Admins see everything. Settings is admins only.
    - Starting ticks are in 035 and are Claude's suggestion, for Richard to adjust.
    - **No type yet = today's access** (everything but the buyer's lists), so nobody is locked out while types are given out.
    - A part you can't open is hidden from the menus and job tabs. Going to it by link shows a padlock and **"You don't have access to this area"** with a **Request access** button (revised 22 Nov), with an optional note on why.
    - **Requests go to IT** (036): admins tick **IT** on the admin login(s) IT uses (Settings › Users). The request goes on their bell and is listed in Settings › Access requests (Done / Decline tells the person). If nobody is ticked IT, every admin gets it. The app will ultimately be managed by IT through an admin account.
    - A page that crashes shows "This page hit a problem" with Reload / Go to Home instead of a blank screen.
    - **Managing logins from the app** (built 22 Nov; Edge Function `manage-users`): admins, IT included, can do all of this from Settings › Users.
      - **+ Add user:** name, email and profile types. The app shows a temporary password once, e.g. Dbp-7KQM-X4TP-29, with Copy and Draft email buttons.
      - **Reset password** gives a new temporary password.
      - **Switch off / on** a login. Leavers are switched off, not deleted, so their name stays on what they did. You can't switch yourself off.
      - **Last signed in** is shown for each user.
      - My details has **Change password**.
      - **Admin and IT** are buttons too (037). Making someone an admin asks you to confirm. You can't take admin off yourself, and the last admin can't be removed. IT can only be ticked on admins.
      - The server key stays inside Supabase and is never in the app.
    - **Database enforcement:** for requisitions it's the grid (your own, or all of a kind whose buyer's list you can open). The rest is screens only for now.
    - **⚠ Before External logins are handed out,** the database must also check each part (jobs, commercial, etc.).
  - **Still to come:**
    - Which jobs each person sees.
    - A requester-only view for site managers can now be a type ticked for Site requisitions only.
- **Material and hire requisition forms** (Richard, 22 Nov): requisitions raised on site for materials and plant / tool hire. The back end is global (one list across all jobs, for buying and hire), not per job. Material first; hire is the same set-up with different columns. **How it works (agreed 22 Nov, before building):**
  - **Who raises them:** about 90% DBP staff, especially site managers, who change from job to job and don't need the rest of the app. All have Microsoft accounts.
  - **Sign-in: "Sign in with Microsoft"** with their DBP account, once per phone (it remembers them, so it's effectively no sign-in after that).
    - Any DBP Microsoft account works and starts as a **Requester**, who sees only the requisition form, their own requests and the buyer's questions. Nothing else in the app.
    - No accounts to set up when site managers change. Leavers lose access when their Microsoft account is disabled. Admins can give someone more access.
    - This is the first step of Permissions.
    - Needs IT to register the app with Microsoft 365 (`docs/questions-for-IT.md` §2). Email sign-in links can stand in until then.
  - **Its own link:** `/site/requisitions/new`, to bookmark, put on the phone's home screen or put on a QR code on site. That needs the app hosted on a web address (questions-for-IT §4).
  - **Buyer's side:**
    - One list across all jobs, replacing the SharePoint "dbp Material Requisitions" list.
    - A conversation on each request: the buyer asks the requester questions and they reply.
    - Stages: New → Query raised → Answered → Ordered → Delivered (to confirm).
  - **Questions to the requester** go on their bell and on the job Overview's notifications and **To-do** box (the first real item for it). Emails stay drafts only, so the conversation happens in the app.
  - **Existing SharePoint requisitions:** start fresh. SharePoint stays as the archive.
  - **Built 22 Nov (scripts 032, 033), material first:** the sidebar's "Project management" is now **Site**, holding the forms and the back end.
    - **Form** (`/site/requisitions/new`), fields as on the SharePoint form: Site name, Element of work, Materials required (with links), Date required by (starts 3 days from today, changeable), Notes, Attachments. The requester's name and email are added automatically. A job's Overview has a "+ Material requisition" link with the site filled in.
    - **My requisitions:** the requester's own, with their status.
    - **Big buttons** for Material requisition and Hire requisition (hire marked "soon").
    - **Attachments:** a "Take photo" button opens the phone's camera straight away (iPhone and Android), next to choosing photos or files.
    - **Separate buyer's lists for material and hire** (`/site/buyer/material`, `/site/buyer/hire`), each shown to the types ticked for it in Settings › Access (Operations by default) and admins. Each lists every requisition of its kind across all jobs. Search, a site filter and status filters (Open, Awaiting answer, Ordered, Delivered, All). Status can be changed from the list.
    - **Each requisition:** its details, attachments, a questions-and-answers conversation, and the buyer's order details (supplier as typed text since 038, value, order and delivery dates; PO number removed 22 Nov).
    - **Notifications** (the database does this):
      - A buyer's message sets it to "Query raised" and puts a reminder, due today, on the requester's bell and the job Overview's To-do box.
      - The requester's reply sets it to "Answered", closes their reminder and tells the buyer.
      - "Ordered", "Delivered" and "Cancelled" tell the requester.
      - Reminders addressed to one person show only to them.
    - **Instant:** the bell updates the moment a reminder is added (Supabase Realtime, 033), with a check every minute in case the connection drops.
    - **Still to do:**
      - Hire requisitions.
      - Match the buyer's columns to the SharePoint list (the .iqy export is a link, not data: send an .xlsx or a screenshot).
      - Microsoft sign-in (IT).
      - Notifying buyers of new requisitions: needs the Operations user type. Until then, they show as "New" in the Buyer's list.
- **Modules still to come (build order):** progress reports, O&M / H&S file. (Sampling tracker built 22 Nov.)
- **To revisit after use:**
  - CVR Excel export (KOSH layout): Richard will come back with changes.
  - Cashflow: S-curve in the Excel (left out for now, 21 Nov).
- **Open questions:**
  - Logo on the CVR sheets (top right clashes with Date prepared / Tender Values).
  - Variations export colour key.
  - Payment notice contact check.
- **With IT:** see `docs/questions-for-IT.md`.

## Web app direction (19 Nov) — supersedes the Excel-macro route
- Commercial tools become a section of the DBP super app (web app, Supabase). Excel is import/export only; no macros. The restyled templates are the export layouts.
- Build order: **Variations first**, then applications, then subcontract payment notices.
- Variations decisions: jobs typed into the app (YYNN + code); statuses = Not issued, Issued, Agreed, Rejected only; new jobs only (live jobs stay in their workbooks); OHP 15% / prelims 9% defaults; OMIT + ADD sections; **budget figure disappears from the summary and the VO sheet once a firm price is in** (kept in the app).
- Outstanding checklist: Claude doc "DBP super app — outstanding items before build".

## Job folder structure — current standard (2611 Micro by the Fix, read 19 Nov)
One SharePoint site per job (`/sites/2611microbythefix`) with three libraries:
- **2611 INTERNAL**: 1. Estimating · 2. Contract · 3. Orders (`NN - Trade - Subcontractor/` with `AFP/` and `Variations/`) · 4. Valuations (`0 - Deposit/`, `N - Application N/`) · 5. Cashflow · 6. EOT · 7. Variations (`<job> - VARIATION SUMMARY AND BUILD UP.xlsm` at root, `VO N - Name/` per VO holding quotes / emails / drawings, `VARIATIONS TO PRICE/` for items not yet numbered) · 8. CVRs
- **2611 EXTERNAL**: 01. Site Folder (H&S, Reporting/Meeting Minutes, Site Photos…) · 02. Design (by consultant, contract sets) · 03. Programme · 04. Project Directory · 05. Building Control · 06. CDM · 07. Snagging · 08. BREEAM
- **2611 O&Ms**

### Where the app saves things (proposed)
| App item | Saved to |
|---|---|
| VO attachments (CAI, drawings, quotes, emails) | `2611 INTERNAL/7. Variations/VO N - Name/` |
| VO sheet export (Excel + PDF) | same VO folder; whole summary workbook at `7. Variations/` root |
| Client application | `4. Valuations/N - Application N/` |
| Subcontract payment notice | `3. Orders/NN - Trade - Subbie/AFP/`; subbie variations in its `Variations/` |
| Meeting minutes | `2611 EXTERNAL/01. Site Folder/02. Reporting/01. Meeting Minutes/` |
| Programme | `2611 EXTERNAL/03. Programme/` |
- Drawings already in `EXTERNAL/02. Design` are linked, not copied.
- Excel exports list each attachment as a hyperlink to its SharePoint copy; "send to client" = zip of VO PDF + attachments.
- Needs: Microsoft 365 admin to approve an app registration (Microsoft Graph, access limited to the job sites) so the app can write to SharePoint. Fallback: attachments stored in the app and downloaded as a zip to drop into the folder.

### Per-job setup (decided 19 Nov)
- Every new job site is created from the **TemplateTestSite-Duboulay** template, so the folder layout above is the same on every job. The app holds that layout once.
- Per job, the only setting is **which SharePoint site** (picked from a list when the job is created). On setup the app checks the standard folders exist and warns if one is missing or renamed; a per-job override is only needed then.
- Later option: the app creates the job's site from the template when a job is added.

### Drafts — VARIATIONS TO PRICE (decided 19 Nov)
- Stays a SharePoint folder, used as the drafts area (partial info / not yet priced). **Not tracked in the app**; the app handles numbered VOs only.
- **Agreed:** when creating a VO, the app offers to move the files from a matching `VARIATIONS TO PRICE/<name>/` folder into the new `VO N - Name/` folder.

### Access (decided 19 Nov)
- No role restrictions for now (small team): everyone with a login can view, create, price, set status, certify and export. One login per person; roles can be added later.

### Hosting and accounts (decided 19 Nov)
- DBP's **IT manager** hosts the app and owns the accounts (Supabase, GitHub, hosting, Microsoft 365 app approval); the user has no access to the account email. Setup parked until IT picks it up.
- **One Supabase project** for the whole super app (Variations, applications, payment notices, Timeline, Minutes).
- Variations test case: `2611 INTERNAL/7. Variations/2611 FISL - VARIATION SUMMARY AND BUILD UP.xlsm`.

## Applications module — scope (agreed 19 Nov)
Based on 2611 Micro by the Fix, Application 2 R2 (30.10.2026) — the current standard, replacing the Randolph Rd layout.
- **Export layout = 2611 format**, three sheets:
  1. **Anticipated Final Account** (front sheet): contract no./name/sum + SoW revision, payment notice no., date · Final Account (contract sum, psum adjustment, variations = budget until firm → anticipated final account) · this application: Construction (SoW £ claimed), Variations (VO £ claimed), Materials on Site → total application · practical completion, less retention (5%) · deposits · total claimed · less previous paid · amount outstanding · VAT · total outstanding · "Payment due within 14 days" · side columns for the Client assessment / previous application and movement in the month.
  2. **Priced SoW** (the job's DBP pricing document, e.g. R5) with added columns: dbp Application N % · dbp Application N £ · dbp comments · **Client Assessment N % · £** (labelled "Client", never the certifier's name such as AJR).
  3. **VO Summary** with % Claimed · £ Claimed · Comments (from the Variations module).
- **Client assessment recorded line by line** (the certifier's % against each SoW line and VO, shown as "Client Assessment" in the app and exports); their Recommendation for Payment PDF saved to `4. Valuations/N - Application N/`.
- **Revisions kept** (R1, R2…) per application; export whichever revision is sent.
- Copy errors the app removes: front sheet's previous-application column carried another job's contract sum (£1,803,957 vs £885,065) and "Nr 2" on Application 2; Rosewood payment notice Summary still headed "Zetter Hotel, Bloomsbury" / "Logik".
- Subcontract payment notices: the 2611 Rosewood and Lumen notices use the same Logik template already agreed.

## Cashflow module — scope (agreed 19 Nov)
- **Client-facing** forecast of what DBP will apply for each month (for the client's funding). No money-out / subcontractor side.
- **Driven by the programme:** each SoW section is linked to its Timeline tasks once per job (app suggests links by trade / section name); each section's value is spread across those task dates.
- **Variations:** agreed VOs included; issued VOs shown separately as at-risk; placed in the month they're expected to be done.
- **Actuals overlay:** past months show applied, certified (Client assessment) and paid from the Applications module; future months stay forecast.
- **Confirmed:** a column per month aligned to valuation dates; excl. VAT; retention line; cumulative % and S-curve chart.
- **Client copy shows certified and paid only** (Client assessment and paid). DBP's applied figure appears on the internal copy only.
- Saved to `2611 INTERNAL/5. Cashflow/`.

## Cashflow: built (20 Nov, script 019), step 1 of 2
**Programme import (Job › Cashflow, shared later with procurement and progress reports):**
- Timeline saves the programme as a P6 **.xer** (Richard, 20 Nov), and the app reads it:
  - **Sections** = WBS headings.
  - **Activities** = their ID (A1010…), name, trade (the "Trade" activity code) and dates (actual where started, else scheduled).
- Timeline's own .json can also be read.
- **MS Project:** saved as XML (File › Save As › XML Format), the summary tasks become the sections. Tasks are kept by their unique ID, since task numbers change when rows are inserted. A .mpp can't be read in the browser, so the app explains how to save it as XML (Richard asked, 20 Nov).
- Re-import on each revision. Links are kept by activity ID, and the import lists any linked activity that's gone.
- Tested on `reference/test-cases/Corsham Street - L9 - B4 - Summary.xer`: 41 activities, 6 sections, 07/09/2026–19/09/2027.

**Weighting (Richard, 20 Nov): "a section where weighting can be configured — deposit, progress, delivery, installation as a guide, with the ability to rename and add sections".**
- **Payment stages per job:** Deposit · Progress · Delivery · Installation · Completion to start with. They can be renamed, added, removed or reordered.
- **Weighted on works packages, not the SoW's sections (Richard, 20 Nov):** "weighting should be on packages grouped by works not floor, i.e. joinery, metalwork, tiling".
  - The same packages as the CVR (from the office SoW on the CVR tab), grouped the same way: Labour & materials, Subcontractors, Preliminaries, Other.
  - **"All monies must be allocated."** Each package is valued at its cost plus its share of each SoW line's OH&P (in proportion to the line's cost), so the packages make up the SoW price.
  - Priced lines with no cost in a package (Micro's VE omissions, −£29,459.81) and any **difference to the contract sum** are spread **in line with everything else** (pro rata each month).
  - Until a package is set, it's spread across the activities matching its name, else start on site to PC. **Nothing is ever left out.** Tested on Micro (office SoW) against the Corsham programme: the months come to exactly the £847,000 contract sum.
- **By trade, with optional per-line weighting (Richard, 21 Nov, script 021):** "packages are the joinery, metalwork, mirrors, stone, labour, materials from the CVR… each individual line item will have a separate weighting but we need to group by trade otherwise it would take too long".
  - The CVR's Subbie-by-section packages ("Subbie – 9 Electrical installation") each go into a trade.
    - The app suggests one. On Micro: Floor finishes → Flooring, Wall finishes → Decorating, Ceiling finishes → Dry lining, Doors & frames / Joinery fixtures → Joinery, Electrical installation → Electrical, Subbie Prelims → Preliminaries; Special items stays its own row.
    - It's confirmed or changed once per job on "Subcontract items into trades".
  - **Superseded for subcontract lines (Richard, 21 Nov, script 022):** on 2701 the SoW sections are areas ("Subbie – 4 Basement 2 based on GPAD"): "this isn't a trade, this is an area… which is not what I want". So **each subcontract line gets its trade from its description**, with a dropdown per line to overrule it (kept per job).
    - The app reads product and finish words: LED, spot, pendant, sconce, lightbox → Electrical; microcement, nosings, treads → Flooring; Bauwerk, Clayworks, Tadelakt, Armourcoat, acoustic spray → Decorating; AC, FCU, dampers → Mechanical; slab, RC, concrete → Structural; blockwork → Builderswork. Designer finish codes count too (WF → Decorating, FF → Flooring), with glass winning over a code.
    - When the line doesn't say, the section's name is used, but only if it's a trade ("Electrical installation", "Builderswork (Northvale)"). An area never decides a trade.
    - Trades on offer: the job's own CVR packages plus the usual fit-out trades. "Mechanical" goes into the job's HVAC package where it has one.
    - Tested: all 58 Micro and 21 Corsham subcontract lines get a trade; e.g. Corsham Mechanical £66,516, Strip out £108,081, Structural £86,232, Builderswork £70,442, Screed £61,446.
  - **Difference to the contract sum (Richard, 21 Nov):** "warn me but split it across the timeline, front load by 10–20% depending on job size, then split and tail off at the end".
    - A warning shows when the SoW and contract sum differ by more than 3%.
    - The difference is spread across start on site to PC: 20% in the first month at £500k or less, falling to 10% at £5m and over; the rest evenly, with the last two months at ⅔ and ⅓. E.g. a £920k job over 11 months: 19.1%, 9% × 8, 6%, 3%.
  - The weighting is set per trade. Opening a trade lists its SoW line items (each valued at its cost in that trade plus its share of OH&P). Any line can be given **its own weighting**: it's then shown under its trade, and the trade carries the rest. "Follow the trade again" undoes it.
- **Start on site and PC (found on 2701 COSH, 21 Nov):** taken from the programme's own milestones ("Start on site", "Practical Completion"), as the most up-to-date dates. Then come the job's dates, then the first and last construction activities. The forecast used to fall back to the programme's first activity, which on Corsham is design, 10 weeks before site.
- **Files never calculated in Excel are refused (found 21 Nov):** the Corsham Enabling Works SoW had 2,730 of its 2,785 formulas with no value saved, having never been opened and saved in Excel, so every total read as blank. All Excel imports (SoW, CVR budgets, iPlicit report) now say "open it in Excel, save it, then import it again". Once saved in Excel it reads correctly: 6 packages, £487,212.69, equal to its SoW total.
- **Weighting by % or £ (Richard, 20 Nov, script 020):** a toggle per package. Switching converts what's typed, and Save is only allowed once the stages come to the whole value.
- **Each package**, **agreed VO** and **issued VO (at risk, shown separately)** is linked to programme activities. The app suggests them from shared words in the names and trades:
  - M&E is read as mechanical / electrical, and HVAC / plumbing as mechanical;
  - design, pre-construction / procurement and client activities aren't suggested.
- **Each stage gets a %** (adding up to 100%) and a **when**: at the start of, spread across (by working day, Mon–Fri), or at the end of its activities (all linked, or a chosen few), or on a typed date. "Start on site to PC" is an activity of its own, using the job's dates.
- **Starting weighting until set:**
  - a package: 100% Progress spread across its (suggested) activities, else start on site to PC;
  - prelims (Richard chose "weighted to set-up and finish"): 10% at start on site, 80% spread to PC, 10% at PC.
- **Nothing is lost:** a section not yet linked, or with stages short of 100%, is listed as "not placed" with the reason. Each section's months add back to its value to the penny.
- **Forecast:**
  - calendar months (valuations at month end), excl. VAT;
  - this month, cumulative, cumulative %, retention held (job %, halved from the PC month) and payment after retention;
  - issued VOs in their own at-risk column;
  - the S-curve on screen: monthly bars and the cumulative % line.
- **Step 2 (built 21 Nov): Excel export and actuals.** No S-curve in the Excel for now (Richard, 21 Nov); it stays on screen.
  - **Actuals from Applications:** each application's latest revision gives applied (DBP's gross), certified (the client's assessment, gross) and paid. Monthly figures are the change from the application before, in the valuation month; paid goes in the month it was paid. They're shown as extra columns on the forecast and in the Excel. Months outside the forecast are listed too.
  - **Excel (Forecast › "Excel: client copy" / "Excel: internal"):** landscape, logo top right, trades down the side by works group, a column per month and a total.
    - Then: total this month, cumulative (formulas), cumulative %, retention held, payment after retention; issued VOs at risk in their own section, not in the totals; the actuals.
    - **Internal copy:** adds Applied, and shows EP, "Omissions and OH&P not tied to a package" and "Difference to the contract sum" separately.
    - **Client copy:** certified and paid only, and those three rows as one **"Allowances and adjustments"** row, so no OH&P or contingency reaches the client.
    - Tested: both recalculate in Excel with no errors and total the contract sum (Micro £847,000).

- **No programme yet: a simple one from the SoW (Richard, 21 Nov):** "if there is not one made, can you generate a simple one based on the uploaded SoW for procurement and cashflow to be made from".
  - On the Cashflow tab's Programme card, and on Procurement when there's no programme: **"Make a simple programme from the SoW…"**. You choose start on site and PC (the job's dates to start with), see it, then use it.
  - One or two activities per SoW trade, named after the trade, on a typical fit-out sequence as a share of the working days: strip out 0–15%; structure / builderswork 5–25%; M&E first fix 12–45% and second fix 62–90%; dry lining 22–60%; joinery 55–90%; flooring, tiling, stone 55–85%; decorating 65–95%; signage 85–95%; commissioning 88–97%; snags and cleans 93–100%. It also has Start on site / Practical Completion milestones; prelims, labour, materials, skips and provisions are left off.
  - Saved as the job's programme (marked as made from the SoW). Importing the real one replaces it.
  - Tested on Micro (30/11/2026–14/09/2027): 25 activities, and every trade gets a provisional on-site date (e.g. Dry lining 01/02/2027, Joinery 06/05/2027, Decorating 04/06/2027).

## Timeline and Minutes merge — parked (19 Nov)
- Parked until the developer (who holds the Minutes Firebase project) and the IT manager (Supabase hosting) are available. Fresh copies of both apps to be taken from the live sites when work starts.
- **Superseded for Timeline (21 Nov):** Richard: "I forgot we haven't implemented Timeline, I think it's time". It is now built into the app (below) rather than waiting to merge the old Timeline app. Minutes stays parked.

## Programme (Timeline) in the app: built (21 Nov, script 025), version 1
- **A Programme tab on every job, next to Overview.** It shows the job's programme as a Gantt chart. This is the same programme the cashflow and procurement already read, so an edit here flows into both straight away.
- **Starting one:** import it (DBP Timeline .json / P6 .xer / MS Project .xml), make the simple one from the SoW, or start a blank one. A blank programme has just two milestones, Start on site and Practical Completion, from the dates entered. Importing a new revision replaces the programme (as before).
- **The chart:**
  - Sections in the programme's order, their tasks under them, with codes and names in a column that stays put while the chart scrolls sideways. Month and week-commencing headings stay at the top.
  - Bars are coloured by trade; milestones are ◆. Weekends are shaded, shutdowns are hatched, and a red line marks today.
  - Zoom: days, weeks or months. The chart scrolls inside its own box, so it works on a phone (narrower name column) and a tablet as well as a laptop.
- **Editing:**
  - Drag a bar to move it. It keeps its length in working days and lands on a working day.
  - Drag a bar's right-hand end to make it longer or shorter.
  - Click a bar or its name to edit: name, section, trade, start, duration in working days (the finish is worked out), milestone, delete.
  - **+ Add task** numbers it in the programme's own style (A1420 → A1430). Click a section heading to rename it.
  - The programme's overall start and finish follow its tasks.
- **Working days** are Monday to Friday, less the programme's **shutdowns** (e.g. Christmas 24/12 to 01/01), set in the Shutdowns box. Durations and dragging skip them.
- **Trade colours:** each trade gets a colour of its own automatically (the same each time). The Trades box lets you choose your own, saved with the programme.
- **Script 025** adds the trade colours and shutdowns to the programme, the links between tasks, and room for progress. The chart works before 025 is run; saving colours, shutdowns and links needs it (the app says so).
- **Full screen** (Richard, 22 Nov): a Full screen button fills the screen with the chart. On a laptop or Android it uses the browser's own full screen; on an iPhone, which doesn't allow that for a web page, it fills the window. A task opened in full screen is edited under the chart. Esc or Exit full screen goes back.

## Timeline: bring it in, then retire it (decided 21 Nov)
- Richard wants one app, with everything updating from the latest programme. Chosen: move Timeline's features and programmes into the Programme tab, then retire Timeline. Not chosen: bolting the old app on as it is, which would keep its own database and so update nothing.
- **Source:** the code isn't held locally. But the live app (https://du-boulay-timeline.web.app/) is one readable file, built by DBP with Claude Code, so DBP owns it. A dated copy is in `reference/timeline-app-2026-11-21.html`.
- **Live programmes:** Timeline saves them in a separate Supabase project (shared with the follow-up / Minutes app). They come across by exporting each one's .json from Timeline and importing it on the job's Programme tab.
- **Importing a Timeline file** now reads its own Save layout (before, only its autosave layout), with links, trade colours and shutdowns.

## Programme: critical tick box; job heading on one line (22 Nov, script 028)
- **Critical path tick box** in the task form (new and existing tasks): the task always shows as critical (red, counted in Critical path (N), in the critical path view and on the print), as well as those the links make critical. Stored as `programme_tasks.critical` (script 028). Until 028 is run, saving leaves it out.
- **RAG status** stays: a manual flag set at progress meetings (green on track / amber at risk / red off track). It doesn't move dates. The help page says so.
- **The ＋ section button on each task row is removed.** New sections only come from + Section in the toolbar; tasks are dragged (or given a Section) to move into one.
- **Job heading (every job tab) on one line:** ← back, the **status first** (Live etc.), the job number, code and name, then PC date · contract sum · SharePoint, and a small Edit job button. On a phone it wraps: status and buttons on top, name, then the details.

## Programme: toolbar on two lines (22 Nov)
Richard: fewer buttons, icons for the obvious ones, two lines on a desktop.
- **Line 1:**
  - Icons for full page, new, undo, redo, open file (folder), print and export (down arrow).
  - Then **Tools ▾**: Shutdown, Shift, Compare, Legend, Add / change / remove client logo. A red dot shows when the programme runs over Christmas with no shutdown.
  - Then the saved badge, **Start** and **Start on site (Wk 1)**, and the client logo.
- **Line 2:** Programmes, From SoW, Commit, History; + Task, + Milestone, + Section; **D / W / 2W / M**; Link tasks, Critical path, contractor filter; Help.
- **Removed:**
  - **Project name box:** the job's name is in the page heading. The print and exports use the job's (or estimate's) name.
  - **Save file:** Export does it.
  - **Set baseline:** Commit does it.
  - **The shortcuts button:** they're in Help, and ? opens Help at them.
  - **Today button:** the today line is always on the chart, and . scrolls to it.
  - **The "auto: wk of…" note.**
- **Saved badge:** "✓ Rev A" (green), "⟳" while saving, "! Retry" if it couldn't save. The last commit's details are on hover.
- **Slip column:** always against the original programme, without needing the overlay on (it was start against the per-task baseline).
- **Print:** the printer icon opens a small menu with a **Today line** tick box (on by default). The print's today line is dashed red over the bars and section bands, dated in the ruler.
- **Help page** expanded, with a sidebar grouped under headings. It covers the toolbar button by button, the task form, the list columns, a chart key, shifting, phones, troubleshooting, a glossary and the shortcuts.

## Programme: tidy-up, help page and shortcuts (22 Nov)
- **Toolbar:** every button, box and menu is 28 px high, the height of Open file. On touch screens the app makes buttons 42 px tall, which is why Open file (not a button) was the odd one out.
- **From SoW…** in the toolbar (jobs) brings back making a simple programme from the SoW once a programme exists (it replaces it; committed revisions are kept). Before, it was only on the start page.
- **Full page** replaces full screen: it fills the browser window over the sidebar and the job's heading, rather than the browser's own full screen. The button sits where New was; New moved to where full screen was. Esc or F leaves it.
- **Thinner rows:** 30 px instead of Timeline's 48 px (16 px bars, shorter headings), so about 27 rows show where 15 did. The overlay still fits under each bar.
- **Help page** (Help opens it in a new tab; route `/help/programme`): Timeline's help page rebuilt, with everything since. That covers automatic saving, Commit and the original programme, Compare / overlay and EOT, previous programmes, estimates, the link to the cashflow and procurement, full page, Redo and the shortcuts.
- **Keyboard shortcuts:** Timeline had N, Enter, Ctrl+S, Ctrl+Z, Esc and Shift+click. Added:
  - T new task, M new milestone, L link mode, C critical path, F full page;
  - 1–4 zoom, . today, ? the shortcuts list (also the ⌨ button);
  - Ctrl+Y / Ctrl+Shift+Z redo (Redo button too), Ctrl+P print the programme, Ctrl+Enter save the task form.
  - Ctrl+S saves straight away. Single letters only work when not typing in a box.

## Programme: the original programme and the overlay (22 Nov, script 027)
Richard: "need to add some way of version history and the commit button which becomes the original programme we can come back and compare to later for an EOT etc. would be great to have an overlay feature where the new programme is shown as an overlay on the original programme to see slippage".
- **Commit** (Timeline's name again, instead of "Issue revision") locks a numbered copy: Initial issue, Rev A, Rev B…, with a note.
  - The commit dialog has a tick box: "This is the **original programme** to compare against later (e.g. for an EOT)". It's ticked automatically for the first commit.
  - Any committed revision can be made the original later (History › Make original). One at a time, kept in `programmes.contract_rev` (script 027).
- **History** is the version history:
  - Each commit with its note and date, and "Original programme" marked.
  - What changed since the one before; Overlay; Download; Restore.
  - On the working programme: changes since the last commit, and changes since the original.
- **Compare ▾** in the toolbar (or Overlay in History) draws the original, or any revision, under today's bars:
  - A grey line where each task was.
  - The slippage between its finish then and now: hatched red if later, green if earlier.
  - Tasks are matched by activity code.
- **While comparing:**
  - **The Slip column** shows each task's finish against the comparison (+7d / −2d / on time / new; the tip gives working days).
  - **The bar over the chart** gives completion then and now: Practical Completion if there's a milestone of that name, else the last task, e.g. "29/03/2027 → 05/04/2027 (+7 days, +5 working days)". It also counts how many tasks are later, earlier, on time, new and removed.
- **Print / PDF** carries the overlay (grey original under each bar, red / green slippage), with "Compared with Initial issue (original programme)" in the header: ready for an EOT submission.
- Timeline's own per-task **Set baseline** and Slip (start against baseline) still work as before when not comparing.

## Programme: Timeline's layout and every feature (22 Nov, script 026)
Richard: "take the layout of Timeline and copy every feature of it"; "within estimating we need to link it to programmes as estimates and tenders often need a programme too". His request for a "previous programme" section on the start page was cut off mid-sentence; read as **start from a previous programme**.
- **Layout as Timeline's** (checked against a screenshot of Timeline with the same sample programme):
  - The toolbar: Project, Programme starts, Start on site (Wk 1); New, Undo, Programmes, Issue revision, History, Open file, Save file; + Task, + Milestone, + Section; Day / Week / Fortnight / Month, Today; Shutdown, Shift, Set baseline, Link tasks, Critical path; contractor filter, Legend, Client logo, Print / PDF, Export, Full screen, Help.
  - Then quick add, then the task list (Task, Trade, Start, Days, RAG, Prereq, Slip; columns resizable) beside the chart.
- **Every Timeline feature, ported function by function** (`src/lib/programmeOps.ts`, `timelineExport.ts`, `timelinePrint.ts`, `timelineDiff.ts`):
  - **Tasks:** quick add (press N; follows the last task, linked to it); + Task / + Milestone.
  - **The task form:** section, trade, contractor, start, duration, milestone, skeleton crew, RAG, predecessors, prerequisite confirmed and note, baseline; Duplicate and Delete.
  - **Editing in the list:** click a start or days cell to type (dates with or without the year, e.g. 4/1); click the RAG dot to change it; drag rows to reorder (by the ⋮⋮ grip on touch screens); sort by start within sections.
  - **Sections:** collapse, rename, move up/down or drag, duplicate (repeating floors: N copies, staggered or back to back, linked), delete (heading only or with its tasks), insert a section break above a task; starter tasks for Precon and Close-out.
  - **Calendar and moving:** shutdowns with Christmas suggested when the programme runs over it; skeleton crew works through shutdowns; shift the whole programme (calendar days) or a section (working days, its followers too).
  - **Tracking:** set baseline, then slip (+7d / on track); critical path (outlined red; the button fades everything else); link mode (Shift-click for start-to-start; chains).
  - **Legend and look:** trade colours, brand colours, tone down; client logo; week numbers from Wk 1; Undo (Ctrl+Z, last 30 changes).
  - **Print:** A3 landscape, as many pages as it needs, with the DBP header and client logo, title block and week numbers; follows the contractor filter and critical path view.
  - **Export:** MS Project XML, P6 XER, Timeline .json (opens in Timeline).
- **Checked against Timeline's own code:**
  - The scheduling, MS Project export, "what changed" lines and print pages give identical output.
  - The P6 export is identical except for a bug in Timeline that's fixed here: its file gave critical activities 8 hours of float instead of 0.
  - Scheduling with skeleton crews matches Timeline in all but one case, deliberately not copied: Timeline can start an ordinary task on a shut day after a negative lag from a skeleton-crew task. Here it moves to the next working day.
- **Saving:** Timeline's Save button becomes automatic saving a moment after each change (so the cashflow and procurement always use the latest), with "Saved / Saving… / Not saved – retry" shown by the project name.
- **Issue revision** (Timeline's Commit) keeps a numbered copy (Initial issue, Rev A, Rev B…) with a note. **History** shows each revision with "What changed" (Timeline's own wording), changes since the last issue, Download and Restore (undoable).
- **Programmes** (and a section on the start page): start from another job's or estimate's programme. It's copied with its first task moved to a new start date, keeping the weeks' pattern in working days, the links, sections and trades. RAG, progress and baselines are cleared, and shutdowns left behind (Christmas is offered again).
- **Importing** a new file now keeps the programme (and its issued revisions) and replaces its tasks, instead of deleting it. A Timeline file brings everything with it: contractors, RAG, prerequisites, skeleton crew, baselines, empty sections, Wk 1, client logo.
- **Estimating:** each enquiry has a Programme box and page (Estimating › enquiry › Programme), the same editor. When the enquiry is won ("Won: set up as job"), its programme becomes the job's (unless the job already has one).
- **Phones and tablets:** the toolbar scrolls sideways; on a phone the task list shows just the name and RAG, and the chart scrolls beside it. Menus open full width.
- **Script 026** (run before using the new fields):
  - Programmes can belong to an enquiry, and have programme start, Wk 1, client logo and section order.
  - Tasks get contractor, RAG, prerequisite, skeleton crew and baseline.
  - It adds the issued revisions table.
  - Until it's run, tasks, dates, links and shutdowns still save, and the page says what's waiting on 026.

## Programme: links and the critical path (21–22 Nov, script 025)
- **Ported from Timeline's own scheduling engine**, so programmes behave the same. Checked side by side with Timeline's code on 300 random linked programmes with a Christmas shutdown: dates and critical path were identical in all 300.
- **Links:** a task follows another in one of three ways, plus a lag in working days (negative to overlap):
  - starts after it finishes (finish to start);
  - starts when it starts (start to start);
  - finishes when it finishes (finish to finish).
- **Moving followers:** a linked task starts as soon as its links allow. Changing a task moves everything that follows it, and what follows those. Links are by activity code, so they survive a new revision.
- **Adding links on the chart:** press **Link tasks**, tap the task that comes first, then the one that follows it (finish to start). The follower is then selected, so a run of tasks can be chained in a row of taps. Tap a linked pair again to unlink.
- **Links in the task editor:** **Follows** lists its links with the type and lag. **Followed by** shows what moves with it. A link that would go round in a loop isn't allowed.
- **Dragging a linked task** keeps its links, with the move added to the lag (as Timeline does when a section is shifted). Its start can't be typed while it's linked: change the lag instead.
- **Changing shutdowns:** tasks keep their length in working days, so one running into a new Christmas shutdown finishes later and its followers move. An unlinked task starting in one moves to the next working day (Timeline's rule).
- **Deleting a task** removes the links to it.
- **Critical path:** Timeline's backward pass finds the tasks that can't slip a day without pushing the finish out. **Critical path (n)** colours them red, fades the rest and shows the links between them in red. **Only critical** shows just those.
- **Imports keep links:**
  - P6 .xer (TASKPRED, lags in 8-hour days);
  - MS Project XML (PredecessorLink);
  - Timeline .json.

  Start-to-finish links (rare) are left out. Imported dates are kept as they are until something is edited.
- **Knock-on:** procurement "on site" and "order by" dates and the cashflow move with the programme, as before. So a delay now ripples into both.

## Quotations module — scope (agreed 19 Nov)
Format based on the 2611 waterproofing quotation (`7. Variations/VO 9 - Waterproofing/dbp Quotation - MICRO - Waterproofing - 30.10.2026`):
details box (project, site, prepared by, date, quotation ref, valid until) · opening line with total + VAT · 01 Scope of works · 02 Pricing schedule (item, description, qty, unit, rate, total; total excl. VAT) · 03 Qualifications & exclusions (grouped) · 04 Validity & acceptance (sign-off: name, company, position, signature, date; or accept by email) · optional appendices (e.g. specification) · T&Cs.
- **From a VO or standalone:** one click from a VO (scope from its description, pricing from its lines) or a standalone quotation for bespoke / one-off work (e.g. Norton Folgate glazing).
- **OHP and prelims built into the rates** on the client copy (prelims may still be its own line, as on the waterproofing quote). The VO build-up keeps them visible internally.
- **T&Cs:** one standard company T&Cs document attached to every quotation, with the option to add extra elements per quotation from a reusable clause library (e.g. bespoke joinery deposits, samples and approvals, natural material variation, lead times, specialist guarantees), editable per quote.
- **Acceptance** (signed copy or email) sets the linked VO to Agreed and files the acceptance in its VO folder.
- Export: Word + PDF. **Saved in the draft VO folder `7. Variations/VARIATIONS TO PRICE/<name>/` until actioned or accepted** (decided 19 Nov); on acceptance it moves with the files into `VO N - Name/`. Applies to standalone quotations too.
- **Reference format (agreed 20 Nov):** `<job no.> <job code> – QU<nnn> – <what the quote relates to>`, e.g. `2611 FISL – QU001 – Waterproofing` (numbered per job; 2611 previously used `2611FISL001`, Norton Folgate `2609 KOSH – QU001`).

### T&Cs — needs review before use
The only company T&Cs found (`Contracts/1. Templates/Draft T&C's/Draft T&C's.docx`, last edited Dec 2022) is an unfinished draft:
- Written for **du Boulay Contracts Limited**; quotations go out as du Boulay Projects Ltd.
- Open notes left in the text: Design & Build and CDP definitions ("NEED SOME DEFINITION…"), payment due date ("5th… we need to agree this"), payment notice timing ("?? day"), PI / EL insurance limits, "Does this apply to commercial fit-out??".
- Insurance cover period on the company details sheet ended 07/07/2026 — current certificates needed.
→ Finish the draft and have it legally reviewed before the app attaches it to quotations.
- [ ] **Open (to come):** Claude drafts the add-on clause library (bespoke joinery deposits / cancellation, samples & shop drawing approval, natural material variation, lead times, specialist guarantees) for the user and their solicitor to review with the main T&Cs.

## Further modules (19 Nov)
- **In scope now:** CVRs, EOTs, progress reports.
- **Not needed for now:** project directory, snagging (SubmittalLink covers them).
- **To come back to:** O&Ms and H&S file → scoped 20 Nov (see below).

### CVR — what exists today (read 19 Nov)
- Every job has `5. Commercial/CVRs/` with a monthly CVR workbook and `JC Reports/<job>_Jobcosting report.xlsx`.
- **Job costing report** = run from **iPlicit** (accounts) via its Excel add-in: per supplier code — budget from CVR, PO, invoiced, committed, unposted invoices, provisions, total costs, last reported, this period, paid to date, retention, outstanding.
- **CVR workbook** (e.g. 2617 Beefy Boys Cambridge): "Interim Cost Value Reconciliation" — tender values (order value £287,909; OH&P £30,313 = 11%); cost as at date from JC report; per supplier/subcontract: trade, order value, allowances/variations, expected final cost, included in cost from JC, still to come, previous, order cover, budget, prov sums, contingency. **Breakdown** tab = the estimate ("office" SoW) with each line's cost allocated to trade/supplier columns (budget per package, OH&P per line). **Labour** tab = weekly direct labour and accommodation reconciliation against budget.
- Note: each estimate exists as `--sow--office` (cost breakdown) and `--sow-R5-client` (client prices).

### CVR module — scope (agreed 19 Nov)
- **Costs:** import the iPlicit job costing report each month (run as now, file dropped into the app); read per supplier code: committed, invoiced, unposted, provisions, total, paid, retention. Direct iPlicit link possible later.
- **Budgets:** from the job's `--sow--office` estimate — its trade / supplier columns become each package's budget (as the CVR Breakdown tab does); OH&P per line gives the tender margin.
- **Labour:** from the iPlicit report only (no weekly labour entry in the app).
- **Value:** certified (Client assessment) to date, with applied shown alongside; variations from the VO register (allowances / variations per package), subcontract orders and payment notices for expected final cost.
- **Template = 2609 KOSH CVR (June)**, supplied by the user 19 Nov. Tabs and how the app fills them:
  1. **CVR summary**: header (contract, job no., date prepared, cost as at); tender values (order value, OH&P and %); per supplier (iPlicit code): name, order value, allowances / variations, expected final cost, included in cost from JC, still to come, cost category, JC last period / this period / movement, notes; then each cost package's remaining budget (budget less suppliers already listed against it: "see X above"); OH&P, DuB management and design shown and omitted; EP / contingency (4% of contract); totals → total cost, final account projected, possible reduction, anticipated final value, gross margin £ and % on sales; PC due, defects period, gross certified to date, retention held; programme block: start on site, original PC, original duration, PC date, weeks delay (link to EOT / Timeline).
  2. **Estimate breakdown** (office SoW): every line split into labour / EP / materials / OH&P and allocated to ~55 cost-package columns (OH&P, EP, DuB management, design, H&S consultant, expenses, project manager, site manager, labourers, consumables, skips, plant, cleaning, mastic, provisions, diamond drilling, labour, materials, drylining … lift, firestopping, signage, contingency), with revision notes (added / omitted Rev N) and return £ / % per package.
  3. **Prov Sum Schedule** and 4. **VOs** tab: same cost allocation per line, with the supplier per package (MGT, Logik, Oscar Acoustics, Jemic, Cavetto, Task, Smart Shutter, Powerhouse, Client Direct…).
  5. **Prelims**: budget (weeks × rate) vs planned resource (named people / subbies). 6. **Consumables**: itemised mess, stationery, PPE, protection budgets by supplier.
- Monthly, saved to `8. CVRs/`.
- **VO cost allocation is done in the CVR**, not when a VO is priced (Variations module unchanged).
- **Cost packages are per job**, taken from each job's office SoW columns (no fixed company-wide list).

### EOT module — scope (agreed 19 Nov)
- No existing EOT documents found on SharePoint; new design.
- **Delay events logged:** variations (each VO's programme implication days become a delay event automatically), late information (late design info / RFI responses), client and third parties (access, client's other contractors, statutory undertakers, utilities). Neutral events (e.g. weather) not included.
- **Output:** a notice of delay letter on letterhead when an event occurs, then a formal EOT claim pulling together the events, days claimed and the programme extract from Timeline (once Timeline is merged). Register of events, days claimed and days granted kept in the app.
- **Prolongation linked to loss & expense:** each EOT week priced at the job's weekly prelims (CVR Prelims tab); once agreed it flows into the application's Loss and Expense line.
- Feeds the CVR programme block (original PC, revised PC, weeks delay). Saved to `6. EOT/`.
- Contract notice periods and wording to follow each job's contract (e.g. JCT D&B 2024 on 2611) — to be checked; Claude is not giving legal advice.

### Progress reports — scope (agreed 19 Nov)
- Existing "template" (`Templates/03 CONSTRUCTION/dbp Project Progress Report - Template.docx`) is really Kong Report 1 with its content left in. **User dislikes it → new layout to be designed.**
- Content found in it: cover (project, address, report no., date, prepared by); project team; period and current week; programme status; H&S statistics (hours, operatives inducted, RIDDOR, accidents / near misses, audits) and visits; programme and progress narrative; design and sampling status; programme risk items; key forthcoming activities; RFIs; commercial; appendices (H&S audit, RFIs and submittals from SubmittalLink); site photos.
- **Frequency set per job.**
- **Claude drafts the narrative** (programme and progress, design, risk items, forthcoming activities) from the period's minutes, Timeline progress, VO and EOT registers and site photos; the PM edits and approves.
- **Commercial section (client-facing): VO summary and EOT status only** — no CVR, margin or application figures.
- **H&S statistics imported from Inndex.**
- Saved to `2611 EXTERNAL/01. Site Folder/02. Reporting/02. Progress Reports/`.

### Progress reports — layout (agreed 19 Nov, based on The Mall Progress Report 7)
Reference: `Contracts/24XX/2415LHMA - The Mall/6. Reports/1 Client Team Report/Progress report 7` (body + numbered appendices, issued as one combined PDF). The app numbers sections automatically (The Mall's Word file had missing 3.2/4.0 headings and was named "06" in the 07 folder).

**Cover + summary page** — job, client, report no., period, prepared by; status tiles (programme, H&S, VOs, EOT) and the 3–5 key issues.

| # | Section | Content | Filled from |
|---|---|---|---|
| 1 | Programme & progress | 1.1 Programme (revision, commencement, contract completion, estimated completion per area) · 1.2 Progress this period · 1.3 Photos · 1.4 Look-ahead · 1.5 Key issues | Timeline; Claude draft from minutes; PM edits |
| 2 | Design | **2.1 Submittals summary** (SubmittalLink report) · **2.2 Sampling tracker** (Sampling module) · **2.3 Design queries** (bullet-point list) | SubmittalLink; Sampling module; PM |
| 3 | Procurement | Procurement schedule — **linked to the app's own Procurement schedule module (new, to build)** | Procurement module |
| 4 | Information required | RFI summary; **RFI report appended** | SubmittalLink |
| 5 | Contract | 5.1 Status · 5.2 Insurances · 5.3 Warranties | PM / QS |
| 6 | Commercial | Instructions outstanding · EOT status. **No forecast final account and no variations list** (decided 19 Nov: not always confidential-safe to share) | EOT module; PM |
| 7 | Site-specific issues | Headings set per job by the PM (e.g. base build, client direct contractors, environmental, access) | PM |
| 8 | Health & safety | Audit score and measures; stats; **Inndex report appended** | Inndex |

- **Quality section removed.** Former sections 7 Base build, 8 Client direct contractors and 9 Environmental are replaced by one site-specific section.
- **Appendices: no fixed list** — it changes every report. The app attaches the linked reports for the sections in use (SubmittalLink submittals, sampling tracker, procurement schedule, RFI report, Inndex) and the PM adds any other PDFs (programme mark-up, photos, H&S audit, inspections, delivery list…), sets the order, and the app numbers them and merges everything into one combined PDF.
- Each section can be switched off per job; the numbering closes up.
- Commercial: **no forecast final account, no variations list, no CVR, margin or application figures** — not optional. The summary page's VO tile is replaced by an information-required tile (RFIs open).
- Output: Word (editable) + combined PDF, saved to `EXTERNAL/01. Site Folder/02. Reporting/02. Progress Reports/Progress report NN/`.

## Procurement schedule module — scope draft (19 Nov)
**Fresh design** (not a copy of the Kong or Marylebone sheets), **built from the job's office SoW**, with **variations in a separate section at the bottom**.
- Looked at for reference only: 2609 Kong `5. Commercial/2609_KOSH_Procurement Schedule_230726.xlsx` (per package: CDP, subs A/B/C, info release, tender docs, tender period, appraisal, target / latest order date, QS float, lead-in, programme week, on-site week, appointed sub, order no.; "Prg Dates" tab copied from the programme); Marylebone Hotel L5–L6 `Procurement Tracker.xlsx` (enquiry log, quote values, design / lead / on-site weeks, order-by date, payment stages, package summary); The Mall procurement appendix.
- The 2611 template site already has a placeholder for it: `3. Orders/Add Procurement Schedule Template.txt` → **saved to `3. Orders/`**.
- **Section A — contract packages, from the office SoW** (e.g. `1. Estimating/04 - Budget/Micro by The Fix--sow-R6-office.xlsx`): one row per trade column with value (dry lining, decorating, Whiterock, joinery, marble / stone, tiles, metalwork, tiling, glass, banquette, flooring, signage, plumbing, electrical, HVAC, ironmongery, lift, screed, diamond drilling…) and per named subcontractor (Subbie Name column / Sub Contract tab). PM checks the list, can merge or split rows (e.g. tile supply + tiling install), and sees which SoW lines each package covers. Same packages as the CVR.
- **Section B — variations:** issued and agreed VOs pulled from the Variations module, each with what needs ordering; PM can mark "covered by existing order" or "nothing to order".
- **Columns (draft):** ref · package · supply / install / both · CDP · budget (from SoW, internal) · appointed subcontractor (from the app's contractor list) · order value (internal) · order no. and date · design / approval weeks · lead time weeks · required on site · latest order date (= on site − lead time − design) · status · comments.
- **No enquiry / quote log** (decided 19 Nov): appointed subcontractor and order value only.
- **Status:** Not started · Enquiry out · Quotes in · Recommended · Ordered · On site · Complete. Red when the latest order date has passed without an order; amber within 2 weeks.
- **Placing an order** creates / links the `3. Orders/NN - Trade - Subcontractor/` folder (current numbering) and passes the order value to the CVR and the subcontractor to payment notices.
- **New SoW revision** (e.g. R6 → R7): re-import adds new packages and flags changed budgets; existing dates and orders kept.
- **Dates from Timeline (confirmed 19 Nov):** each package is linked once to its Timeline tasks (app suggests links by matching Timeline trade names); required on site = start of the earliest linked task; order by = on site − lead time − design / approval weeks; a programme revision moves the dates and flags anything now late. VOs link to their own task or take a typed date.
  - **Until Timeline is merged:** import the programme file exported from the current Timeline site (format already mapped: groups, trades, tasks with start, duration, predecessors) and re-import on each revision; switches to the live link after the merge.
- **Client copy (decided 19 Nov):** progress report section 3 shows **package, status and lead time only** — no subcontractor, budgets or values.
- Export: Excel (internal, full) and PDF (client copy).

## Procurement: less clunky (22 Nov)
Richard: "procurement seems clunky after use". He chose "edit in the table" and "less clutter", and said status must be a dropdown on its own, without opening all of a package's details.
- **Edit in the table:** each row has its own **Status** dropdown (coloured: amber while enquiring / quotes in / recommended, blue ordered, green on site / complete). Also editable in the row:
  - **Subcontractor** (type-ahead, can add a new one);
  - **Order value** (with ± against budget under it);
  - **Lead (wks)**;
  - **On site**: shows the programme's date in grey italics until one's typed; typing the programme's own date, or clearing it, goes back to the programme.
- **Saving:** each change saves straight away ("Saving…" by the tabs). The order date keeps following lead time and on site until one's typed, as before.
- **Details in a side panel:** clicking a package's name opens its full details from the right (name, order no. and date, from an order, programme activities, comments, SoW lines), so the table no longer jumps. 💬 by a name means it has comments (hover to read).
- **Less clutter:**
  - The SoW box is the small one.
  - The no-programme note is one line, pointing at the **Programme** tab (it wrongly said the Cashflow tab).
  - The explanation is folded under "ⓘ How it works".
  - Packages, Variations and SoW lines (move / split) are tabs in one card, with late / due soon counts beside them.

## Procurement: built (21 Nov, script 023)
**Packages (Richard, 21 Nov):** "based on SoW but group by package, not just from the pricing elements on the right-hand side under the packages, but read the line items in the SoW to determine how these should be grouped as well; like other packages have an override and a split section so a £ value can be apportioned to another package. This will be useful for, like, a bar which might have mirrors, joinery, metalwork, install etc. which might all be separate orders on some jobs."
- **From the office SoW's lines** (the job's one SoW):
  - each line's cost goes to the package column it's priced in;
  - the specific columns (Joinery, Metalwork, Electrical…) are their package;
  - the general columns (Subbie, Subbie Prelims, Labour, Materials) are read line by line from the description, with the same reading as the cashflow (e.g. strip out, structural, builderswork, mechanical).
- **Budgets are cost**, to compare with the order values. OH&P, DuB management / design and EP (contingency) aren't ordered, so they're left out.
- Tested:
  - Micro: 161 lines into 23 packages, £811,443.18 (the SoW's cost less EP).
  - Corsham: 26 lines into 10 packages, £427,377.97 (Strip out £99,530, Structural £75,642, Builderswork £61,791, Mechanical £58,347…).
- **Move / split any line** ("SoW lines into packages"): give its £ to one package or several (a bar into Mirrors, Joinery, Metalwork, Install). What's not given follows the SoW's own split, and a split can't come to more than the line. "Back to the SoW's split" undoes it. **"+ Add package"** adds one that isn't in the SoW (e.g. Mirrors) to split into.
- **Each package:**
  - supply / install, CDP, status (Not started · Enquiry out · Quotes in · Recommended · Ordered · On site · Complete);
  - the appointed subcontractor (from the contractor list) and order value / no. / date, typed or taken from an order on Payment notices; the order value is shown against the budget (+/−);
  - design / approval weeks, lead time, programme activities linked (suggested from the name), required on site (the earliest linked activity's start, or a typed date);
  - **order by** = on site − lead − design, **red** when passed without an order, **amber** within 2 weeks;
  - comments, and its SoW lines.
- **Section B, variations:** issued and agreed VOs, each with the same details plus "Covered by an existing order" / "Nothing to order".
- **Excel, lead time and provisional on-site dates (Richard, 21 Nov):** "needs to be exportable to Excel and have a lead time column, and date on site required provisionally worked out by the programme for the first date the bar starts for the relevant element".
  - **Lead time** (and design weeks) is a column on screen and in the Excel.
  - **Required on site, provisionally from the programme:** with nothing linked or typed, it's the first start of the programme activities that match the package. Activities that aren't on site are skipped (design, procurement, lead times, drawings, manufacture, approvals): Corsham's "Joinery design, procurement & lead times" starts 3 months before "Joinery & door installation".
    - It's marked "provisional" on screen and in italics in the Excel.
    - Linking the package's own activities, or typing a date, firms it up.
  - **Excel (A · Contract packages › "Excel" / "Excel: client copy"):**
    - **Internal:** package, supply / install, CDP, budget (cost), subcontractor, order value, ± budget, order no. / date, design weeks, lead time, required on site, order by, status, comments; red / amber rows; totals; section B variations; landscape, logo top right.
    - **Client copy:** package, lead time and status only (decided 19 Nov, for progress reports).
    - Tested: both open in Excel with no errors.
- **Simplified (Richard, 21 Nov, script 024):**
  - **"Package needs to be editable so I can say electrical (install) or tile (supply) or any number of other items."** Each package has its own **name**, a label only: its budget still comes from the SoW by its SoW name, shown underneath as "SoW: Electrical" where it differs. Renamed packages show their names in the lines list and split choices, and in the Excel. With that, Supply / install is taken out.
  - **"Lead time should encompass design period."** One **lead time, including design and approval**; order by = on site − lead time. Design weeks entered before are added into the lead time, so no dates change.
  - **Order date fills itself (Richard, 21 Nov):** "if a lead time and required on site date is populated, auto-populate order date".
    - Once a package has both, the order date is worked out as required on site − lead time, and follows either as it changes.
    - A date typed in stays; clearing it works it out again. An order picked from Payment notices keeps its own date.
  - **CDP taken out** (Richard, 21 Nov), from the screen and the Excel. The buttons read "Excel: internal" and "Excel: client copy".
  - **"Subcontractor dropdown needs to be a type box with a list of contractors in a dropdown when clicking into the box, which autofills when you type."** Click in for the contractor list, type to narrow it and complete the name. A name not on the list can be added there and then (as a subcontractor, with the package as its trade; the rest of its details on the Contractors page).
- **Still to do:** placing an order to link through to the CVR / payment notices and the `3. Orders` folder (needs SharePoint).

## Sampling: filling suppliers; "Supplier" (22 Nov)
- Richard: "supplier still not pulling from the schedule". The samples were imported before supplier-reading existed, and the supplier was only set on import.
- **Fill suppliers from specs (N)** button on the tracker:
  - It shows when samples with no supplier have a spec (or a spec-like description) naming one.
  - It lists them first ("FB-01 → Kvadrat …") to confirm, then matches each to the contractor list, adding new names as suppliers.
  - It never changes a supplier already chosen (the update only touches samples whose supplier is still empty). Omitted samples are left out.
- **The import** also reads the supplier from the description when there's no supplier column or spec, but only when the description is set out like a spec ("Kvadrat - Hallingdal 65") or starts with a contractor-list name. "Bar top" gives none.
- **Labels:** "Subcontractor / supplier" is just **Supplier** in the sampling tracker, side panel, filters and Excel. The import's column is "Supplier / manufacturer".

## Sampling: headings caught properly; designer's reference removed (22 Nov)
- **Headings:** heading rows still came in ("FABRIC" above FB-01) because they had something in another column (a ref, a level). A heading is now a code with no number and no description or specification, whatever else is on the row. A re-import deletes heading rows taken in before, by the same test (never touched: not requested, no supplier, no photo).
- **Designer's reference removed** (Richard) from the tracker, side panel, Excel, PDF and the import's columns. If a schedule has only a ref column, it's still used as the code.
- **Supplier from the spec:** with no dash or comma, only the first word ("Romo Linara Putty" → Romo; "Farrow & Ball" kept whole). Contractor-list names match without their Ltd / Limited / UK ending ("Stone Group Calacatta…" → Stone Group Ltd).

## Sampling: Submitted / Signed off; supplier from the schedule (22 Nov)
- **Columns:** the tracker shows **Submitted** and **Signed off** (the designer's decision date) instead of Due and Submitted.
  - The due date stays in the side panel and still drives "overdue", now a small tag by the code (the due date in its tip).
  - The Excel's "Decision" column is "Signed off"; the PDF shows Submitted and Signed off.
- **Supplier from the finishes schedule:**
  - The schedule's supplier / manufacturer / company column if it has one.
  - Otherwise the start of the spec: a name already on the contractor list if the spec starts with one; else "Manufacturer: X"; else the part before a dash, comma or bracket (up to three words, "Farrow & Ball" kept whole); else the first word.
  - A spec starting with a material or finish word (oak, crown, painted, RAL, TBC, "refer"…) gives no supplier rather than a wrong one.
  - Suppliers are matched to the contractor list by name; new names are added to it as suppliers.
  - A supplier already chosen on a sample is never overwritten. Unchanged samples with none take the schedule's on the next import.
  - The import preview shows the supplier column.
- Tested: Kvadrat Hallingdal… → Kvadrat; Farrow & Ball Estate Emulsion, … → Farrow & Ball; Manufacturer: Romo; … → Romo; Dinesen - Heartoak… → Dinesen; Mosaic Factory Barcelona… → Mosaic Factory (on the contractor list); Havwoods (or equal) → Havwoods; Crown cut oak veneer… → none.

## Sampling: heading rows in schedules (22 Nov)
- Richard's import brought in a "FABRIC" row as a sample. Designers put a category heading in the code column above each group.
- A row with words in the code column, no number, and nothing else filled in is now a **heading**. It isn't a sample, and it gives the material group to the items under it ("FABRIC" → Fabrics; one with no standard match, e.g. "SANITARYWARE", becomes its own group "Sanitaryware").
- The group order is: the schedule's category column, then the heading, then the description, then the code and specification.
- Re-importing removes heading rows an earlier import took in (no number, nothing filled in, never touched), whatever is chosen for samples dropped from the schedule.

## Sampling: Omitted status; supplier second (22 Nov, script 031)
- **Omitted** status (Richard: "so we can do it contractor side if client doesn't update"):
  - Set by DBP. It's not on the bell (the reminder only covers samples not yet submitted).
  - Greyed rows with the code struck through; its own status switch, so it can be hidden.
  - Greyed in the PDF too.
- **New revision:** the samples no longer on the schedule can be **marked Omitted** (the default), kept as they are, or deleted.
- **Supplier is the second column** (after the code) in the tracker, the Excel and the PDF. Richard: "arguably the most important after spec".

## Sampling: filters, and revisions keep status (22 Nov)
- **Bug fixed:** the status buttons printed a stray "0" for statuses with no samples.
- **Filters** (Richard: "filter buttons so we can hide things based on status and other items"):
  - **Status switches:** each status is a coloured button with its count. Click to hide it (struck through); click again to show it.
  - **Overdue only** and **Spec changed only**.
  - **Filters ▾:** tick material groups, locations / levels, suppliers ("(none)" included) and types to show only those. Nothing ticked in a list means all of it.
  - "Showing 20 of 24 · Clear filters". Filters are remembered per job on the device.
  - The **Excel and PDF export what's shown**, so filter first for part of the tracker.
- **New revisions keep status** (Richard: "it needs to remember the status of the unchanged elements"):
  - Samples are matched by code. Unchanged ones aren't touched, and changed ones keep their status (flagged if already approved).
  - A material group set by hand is now kept too (before, a changed item's group was re-guessed).
  - The import step shows "N unchanged (status kept), N new, N changed (status kept), N no longer on the schedule".
  - If the designer renames a code, it can't be matched: it shows as one removed and one new.

## Sampling: schedule import reads the file directly (22 Nov)
- Richard's first schedule import failed with "Cannot read properties…". The ExcelJS library chokes on some designers' files (pictures in cells, tables, shapes and similar).
- The import now reads just the text straight out of the file (`src/lib/xlsxText.ts`): shared strings, typed text and the values Excel saved for formulas. Pictures, shapes, comments and errors are skipped.
- Tested on Excel-made schedules with floating pictures, a shape, a comment, a merged title and a formula.

## Sampling tracker: built (22 Nov, script 030)
Job › **Sampling** tab, after Procurement. Richard chose photo and approval uploads into the app, and due dates from the programme.
- **The tracker** is grouped by material group (Fabrics, Glass & mirrors, Laminates & metal, Paints, Stone / ceramic / composite, Timber & veneers, Wall coverings, Flooring, Ironmongery & fittings, Lighting & electrical, Other).
  - Each row: code (and designer ref), description and specification, locations (one row for an item on several levels).
  - Editable in the row:
    - **Status** dropdown (coloured). Choosing Requested, Submitted or a decision fills that date if it's blank; approving clears "spec changed".
    - Supplier (type-ahead, can add a new one), type (sample / benchmark / mock-up), due and submitted dates.
  - Photo thumbnail. Red rows: due and not yet submitted. Amber: spec changed after approval.
- **Filters and search:** filter buttons with counts (All, Overdue, To request, Requested, Submitted, Approved, With comments, Rejected, Spec changed), and a search box.
- **Side panel** (click the code):
  - all the fields;
  - **due date from the programme**: pick the activity it's needed for and the weeks before it starts. The date follows the programme; it's refreshed when the tab opens, so the bell stays right. Typing a due date in the table unlinks it.
  - requested and submitted dates;
  - the designer's decision (decided by, date, comments) with the **approval email or signed label attached**;
  - **photo** (camera on a phone; shrunk to 1600 px first);
  - stored at; delete.
- **Uploads** go to a private Supabase storage area, "samples" (signed-in users only), viewed through short-lived links.
- **Importing the finishes schedule (Excel, any designer's layout):**
  - The header row is found by its words, and each column's meaning guessed (code, designer ref, category, location, description, manufacturer, product, finish, specification, quantity). You can change the sheet, header row and any column before importing.
  - Items on several rows / levels become one sample with all their locations.
  - The material group comes from the schedule's category, else the description, else the code and specification.
  - The designer, document no. and revision are taken from the file name, and can be edited.
- **New revision:** the app shows what's new, changed and no longer on the schedule.
  - Status is kept for everything; changed items take the new details, and anything already approved is flagged "spec changed" (resample, possible VO).
  - Samples dropped from the schedule are kept unless you tick to delete them. Samples added by hand are never treated as dropped.
- **Bell:** a reminder per sample with a due date that's not yet submitted (not requested, requested, or rejected), linking to the Sampling tab (database trigger, script 030).
- **Export:**
  - **Excel**, grouped by material group, with the DBP logo top right at 60 × 15 mm, and red / amber rows.
  - **PDF** for design team meetings: the samples currently shown (so filter first, e.g. Overdue), grouped, with photo thumbnails, A4 landscape.
- Tested: the Excel reader on a KKA-style schedule (title rows above the header; M-S101 on L00 and L01 → one sample; groups right), and the revision comparison (added / changed-after-approval / dropped; a hand-added sample left alone).

## Sampling module — scope (agreed 19 Nov)
Purpose: track **physical samples** per job. SubmittalLink covers technical submissions and drawings but not physical samples, so there is no overlap.
- Reference examples: The Mall `3. Design/2.01 - Architect/70 Furniture Layouts/214-KKA-CE-XX-SH-I-70-501 P02 Finishes Schedule - sample tracker.xlsx` (KKA finishes schedule per level — item code, SFF ref, description, quantity, specification (company / product / finish), image — with "Sample received" and "Sample signed off" columns added); 2611 `02. Design/12_Joinery - S&R/SP1217-S&R - Sample Submission Tracker`; 2611 AJR finishes schedules `021_90-00_B` (wall, floor, ceiling) and `021_90-01_B` (joinery & millwork), both PDF.
- **Bespoke per job:** upload the designer's finishes schedule (Excel or PDF, any designer's layout); Claude reads it into items: code, designer ref, category (fabrics, glass, laminates, paints, stone, timber…), location / level, description, specification (manufacturer, product, finish), quantity, image. The PM checks the list before it becomes the tracker.
- **DBP columns added:** responsible subcontractor / supplier (from `3. Orders`), sample type (physical sample, benchmark, mock-up), requested, due, submitted, status, designer comments, approved by, approval date, where the sample is stored, photo of the approved sample.
- **Statuses (confirmed 19 Nov):** Not requested · Requested · Submitted · Approved · Approved with comments · Rejected – resubmit.
- **Approval (confirmed 19 Nov): no designer logins.** DBP records the designer's decision and attaches the email or signed label; no designer logins.
- **Schedule revisions:** uploading a new revision (e.g. P01 → P02) shows items added, removed and changed; status is kept for unchanged items; a spec change after approval is flagged (resample, possible VO).
- **Links:** due dates can be set back from the Timeline install / order dates; feeds progress report 2.2 (shown after the submittals summary, before design queries); outstanding items can go on meeting agendas.
- **Grouped by material group** (fabrics, glass and mirrors, laminates and metal, paints, stone / ceramic / composite, timber and veneers, wall coverings…), **not by level** (decided 19 Nov). Location / level is a column; an item scheduled on several levels (e.g. M-S101 on L00 and L01) is one row with all its locations, sampled once.
- **Export:** Excel tracker grouped by material group, and PDF for design team meetings. **Saved to `EXTERNAL/02. Design/Sampling/`** (confirmed 19 Nov).

## Excel exports (decided 19 Nov)
- **Internal Excel copies keep live formulas; clients get PDF.**

## Subcontract payment notices — import test (19 Nov)
Tested with two 2611 applications supplied by the user: **Lumen Fit-Out App 2** (electrical, PO POR000986, 3-page PDF: summary, contract works with % complete, variations VA1–2) and **Mercury App 2** (mechanical / plumbing, 1-page PDF, 6 sections + variations). Both read cleanly into the App tab layout (measured works / materials on site / variations, line by line). Result workbook: `2611 Subcontract applications - import test.xlsx`.
- **Lumen:** contract works lines total the stated £144,257.97; gross to date reconciles to their £73,996.26. Issues: prelims stated 25% but £1,200 (30%) claimed (£200 over); "Security, wiring only (removed)" £4,668.48 still in the contract sum; they deduct the full £14,425.80 deposit though DBP paid £13,704.51 (PN 1), so they under-claim £721.29; column headed "App 001"; address differs from DBP PN 1 (Ashford vs Maidstone). Correct due on their figures with prelims at 25%: £56,401.94 vs their £55,870.65.
- **Mercury:** lines reconcile (£98,859.23 gross, £44,056.19 due). Issues: "contract value plus variations" excludes £7,890 variations; section % not value-weighted; V4 water mains relocation has no value; no contract number; **no Mercury order, application 1 or payment notice 1 filed** in `3. Orders/1. Mechanical - Mercury` (only quote T504), so previous £52,484.29 can't be verified.
- **Checks the app runs on every import:** each line's stated % × value vs amount claimed; line totals vs their stated totals; previous / deposit vs DBP's own last payment notice; their variations vs DBP's subcontract variation list; order value vs DBP order; contact details vs the contractor list; missing order / previous notices flagged.
- Also confirmed: the old Lumen PN 1 still carries "Zetter Hotel, Bloomsbury" / "Logik" headings (template copy error the app removes).
- **Export = the user's own payment notice workbook** (2609 Kong / Logik Payment Notice 2), not a new layout (confirmed 19 Nov: the import-test sheet was "not user friendly"). Tabs: Payment Notice (front page, previous application and movement columns) · Summary · SOW · Variations (subcontractor valuation / DuB assessment / previous / movement) · App N (the subcontractor's application line by line). SOW and Variations line 1 = "As per App N"; DuB adjustments go in as extra lines on SOW (e.g. Lumen prelims −£200). Header logo kept. Test notices built: `2611_Micro_Lumen_Payment Notice 2.xlsx` (due £56,401.94) and `2611_Micro_Mercury_Payment Notice 2.xlsx` (due £44,056.19; address, order no. and previous figures to confirm).

## Logo on every export (decided 19 Nov)
- **Every template / export** (VO sheet and summary, applications, payment notices, quotations, cashflow, CVR, EOT notices and claims, progress reports, procurement schedule, sampling tracker; Excel, Word and PDF) carries the du Boulay Projects logo **top right of every printed A4 page, at the same size and position**: 60 mm × 15 mm, 10 mm from the top and right edges.
- **Logo artwork = the current dbp logo from `dbp Letterhead - Template.docx`** (the 'dbp / du Boulay Projects' mark, SVG rendered to a high-resolution PNG), same size as on the letterhead's first page. Not the old logo that was in the Kong workbook header (corrected 20 Nov).
- Excel: logo is a **picture on the sheet** (visible on screen and in print; a page-header logo only shows in print preview and was missed), top right of row 1 of every tab, aligned to the right edge of the print area. Each tab prints at a **fixed scale** worked out from its column widths (e.g. Payment Notice 86%, Summary / SOW / Variations 52%, App 67%) and the picture is sized to cancel that scale, so it prints 60 × 15 mm on every tab. A4 portrait, 10 mm margins. Checked by rendering both test notices to PDF: logo identical size on all five pages.
- Word / PDF: same size and position in the page header (letterhead).
- **Superseded for Word / PDF (20 Nov):** documents built on the letterhead keep it **exactly as designed**: logo top left (60 × 15 mm on page 1 with the address block top right and directors / accreditations at the foot; smaller logo on later pages with "Page x of y"). The top-right 60 × 15 mm rule applies to **Excel exports only**. The app builds Word documents inside the real letterhead file, so its headers and footers are never re-drawn.
- Applied first to the two test payment notices (all five tabs).

## O&M and H&S file module — scope (agreed 20 Nov)
**What exists:** Kong 2609 (latest) `6. O&Ms Health & Safety File/`: 1. Front Page · 2. Index Page · 3. Description of Works · 4. Project Directory (xlsx) · 5. Residual Risks · 6. Building Control · 7. O&M Manuals (DBP Sub-Contractors, one folder per sub / package — 17 of 23 still empty; Client Direct Contractors; Cleaning & Maintenance; Templates `O&M template - new logo.dotx`); at root: Project Handover Document (client training / systems checklists, keys, outstanding works, snagging, warranties), Fire Risk Assessment, Construction Fire Safety Plan, RAMS by sub. Zetter adds Building Control certificates and the Reg 38 pack, BREEAM, key schedule, PC certificate. 2611's template site has a separate **`2611 O&Ms` library** (URL `After Care`) holding only `01. Front Page` and "Folders to be made for each package.txt".
- **Location:** the job's **O&Ms library** from the site template (e.g. `2611 O&Ms`), with Kong's numbered sections inside it.
- **Package folders created by the app** from the procurement schedule's appointed subcontractors (`NN - Package - Subcontractor`), replacing the "folders to be made" note; client direct contractors added by the PM.
- **Document list:** a **standard list by trade** (e.g. electrical: installation and test certificates, emergency lighting, fire alarm, as-builts, O&M manual; mechanical: commissioning and flow-rate certificates, as-builts, maintenance schedule; joinery: finishes data, care guide, warranty), **plus project-specific items the admin adds per job** (e.g. Reg 38 pack items, BREEAM evidence, client requirements).
- **Tracker:** per package and document: requested · due · received · reviewed (accepted / rejected – resubmit). Default due date = 4 weeks before PC, taken from Timeline. Chase emails drafted for the PM (draft only, never sent).
- **Sections the app generates:** front page (logo, project, address, PC date) · index (built from what's actually in the file) · description of works (Claude drafts from the SoW, PM edits) · project directory (from the contractor list and client team) · residual risks register · Project Handover Document (training / systems checklists, keys, outstanding works, warranties).
- **Output:** the SharePoint folders **plus one combined, bookmarked PDF** (front page, index, section dividers, every document) for issue to the client; logo standard applies.
- **Payments:** a subcontractor's payment notice and retention release show **"O&Ms outstanding"** with the missing items, so the QS can decide; nothing is blocked automatically.

## Company insurances (received 20 Nov)
Broker confirmation dated 30 June 2026 (ref 3053912), `Confirmation of insurances 07.2027.pdf`. **All covers run 1 July 2026 – 30 June 2027.**
| Cover | Insurer | Policy no. | Limit |
|---|---|---|---|
| Employers liability | Aviva | 100687754CSI | £10m each and every claim |
| Public liability | Aviva | 100687754CSI | £5m each and every claim (£1,000 excess) |
| Products liability | Aviva | 100687754CSI | £5m aggregate |
| Public and products excess layer | AIG UK | 0032030785 | £5m excess of £10m |
| Contractors all risks | Aviva | 100687754CSI | £2.5m maximum any one contract |
| Professional indemnity | Hiscox | PL-PSC10003452804 | £5m each and every claim (£10,000 excess) |
| Hired-in plant | Aviva | 100687754CSI | £100,000 |
- Stored in the app's company settings with the certificate PDF; attached to quotations and T&Cs. The draft T&Cs' open notes on PI / EL limits can now be filled from this.
- **CAR limit check:** a job whose contract sum is over £2.5m (CAR maximum any one contract) is flagged when it's set up, so cover can be extended before starting (e.g. The Mall at £7.7m would have triggered it).

## Notifications on the home page (decided 20 Nov)
- The app's **front page has a notifications pane marked with a bell**, with a count, **highlighted** when anything needs attention (red overdue, amber due soon).
- **Insurance reminders:** each cover's expiry (30 June 2027) appears 60, 30 and 7 days before, until a new certificate is uploaded; plus the CAR limit flag above.
- The same pane carries the app's other dated items: procurement order-by dates, samples due, O&Ms due, payment notice and valuation dates, EOT notice deadlines.
- Each item links to the thing it's about; it can be marked done or snoozed.

## Supabase (20 Nov)
- **Richard has created the Supabase project** (previously parked for the IT manager). GitHub repo, hosting and Microsoft 365 approval are still with IT.
- **Database set-up script `001_dbp_app_schema.sql`** written and tested on PostgreSQL 16 against a Supabase-style `auth` schema: 40 tables covering company settings and insurances, contractors, jobs, SoW and packages, variations and quotations (`quotation_refs` view gives "2611 FISL – QU001 – Waterproofing"), client applications, subcontract orders / applications / payment notices, cashflow, CVR, EOT, procurement (latest order date calculated), sampling, O&M, progress reports and notifications (`notifications_live` view sets overdue / due soon). Seeds the company details (no bank details) and the 2026–27 insurances, with reminders 60 / 30 / 7 days before expiry; a trigger flags any job over the £2.5m CAR limit. Row level security on every table: signed-in users only, no roles yet (`profiles.is_admin` ready for later).
- **Kept in this project under `supabase/`** (the script plus `supabase/README.md`, which lists every script in run order and whether it has been run). Later changes come as new numbered scripts (002, 003…); 001 is never re-run.
- **001 run on the live Supabase project by Richard, 20 Nov 2026.**
- To run: Supabase › SQL Editor › paste › Run, on the empty project. Share only the Project URL and publishable (anon) key for the build — never the secret / service-role key or database password.
- **002** (CAR limit check adds one notification per job, not one per save) and **003** (signed-in users granted table access; this project doesn't grant it automatically) run by Richard, 20 Nov 2026.

## Step 1 built: sign-in and front page (20 Nov)
- Project moved out of OneDrive to `C:\Users\Richard Millmand\Projects\dbp-app` (OneDrive locks build files).
- **Sign-in = email and password. Public sign-ups switched off** in Supabase; logins are added by hand in Supabase › Authentication › Users (Auto Confirm).
- Front page: jobs list + notifications pane. Reminders dated more than 14 days ahead (e.g. the 60-day insurance reminders) sit under "Show upcoming" rather than in the count. Snooze = 7 days.
- Users never see the Supabase address; the public address (e.g. `dbp-app.com`, if DBP owns it) is set up with hosting by IT.

## Phones, tablets and offline (20 Nov)
- **Every screen must work on a phone, a tablet / iPad and a laptop** — now and for every future module (house rule in `CLAUDE.md`).
- **Offline:** the app is installable (home-screen icon) and opens from the device's cache with no signal. Every screen keeps a copy of the last data it loaded and shows it offline, with an "Offline" marker in the top bar. Someone already signed in can open the app offline. Sign-out wipes the device copy.
- **Offline use (agreed 20 Nov):** **meeting minutes** can be written offline (saved to an outbox on the device, synced when the signal returns) and the **latest programme** is kept on the device so it can be viewed offline (both come with the Timeline / Minutes merge). **Everything else is view-only offline**, so offline edits to money figures can't clash.

## Subcontract payment notices: built (20 Nov)
- **Contractors** (left-hand menu): the company list (name, type, trade, address, postcode, email, phone, iPlicit code). Name and address print on payment notices. Anyone signed in can edit it.
- **Job › Payment notices:** subcontract **orders** (folder no., trade, order no. default `2611/FISL/NN`, PO ref, order value, retention %), each with **DBP's list of the subcontractor's variations** (ref, value, instructed).
- **Each application → payment notice (same number):** their lines in three blocks (contract works, materials on site, variations) entered by **pasting rows from their Excel**, **reading their PDF** (Claude, once IT switches it on) or typing; their stated gross / previous / due.
- **Their valuation counts what they actually claim**; their stated % × value is the cross-check. **DuB adjustments** are separate lines (e.g. Lumen prelims −£200) giving the DuB assessment.
- **Previously paid** defaults to the previous notice's figure after retention, to the penny (Lumen £13,704.51, Mercury £49,860.08). When the previous notice was made outside the app, its figures are entered on the first notice made in the app.
- **Checks on every application:** % × value vs £ claimed; lines vs their stated gross; their "previous" vs DBP's last notice (and the deposit-deducted-in-full case: Lumen £721.29 too low); variations vs DBP's list (missing, value differs, not instructed, no value); order value vs their contract works total; no order number; 100% claimed on items over £5,000.
- **Export = the Kong / Logik layout:** Payment Notice (portrait, with previous application and movement), Summary, SOW and Variations ("As per App N" plus DuB adjustment lines; landscape), App N (their application line by line, effective % so it reproduces their figures; "Stated 25%" noted). Logo top right on every tab. Tested: **Lumen £56,401.94 and Mercury £44,056.19** reproduced exactly, including the previous / movement columns.
- Not yet: "contact details vs the contractor list" check (needs their stated address captured); O&Ms-outstanding flag (comes with the O&M module).

## EOT: built (20 Nov)
- **Job › EOT tab:** programme summary (contract completion, days granted, revised completion, weeks delay, days claimed), **delay events** (DE01…) and **EOT claims**.
- **VOs with programme days become delay events automatically** (script 013) and follow the VO's days; late information and client / third-party events are added by hand. Neutral events (weather) aren't included, as agreed.
- **Notice period per job** (job details: "notice of delay due N days after an event", per the contract) sets each event's notice due date; **bell reminders** until the notice is marked sent.
- **Letters on the real letterhead** (Word, built inside `dbp Letterhead - Template.docx`): notice of delay per event, and claim letter with the table of events, total days and the requested completion date. Addressed to the job's **Client** (new field in job details; clients live in Contractors). Wording editable in Contracts › EOT (placeholders {{contract}}, {{event}}, {{event_date}}, {{days}}, {{completion}}, {{revised_completion}}); default wording until then. **Wording must follow each job's contract: check before sending.**
- **Days granted** are recorded per event; revised completion = contract PC + days granted (calendar days); weeks delay feeds the CVR programme block.
- **Prolongation** = weeks granted × the job's **weekly prelims** (new job field); **"Add prolongation to application"** adds it to the latest draft client application's new **Loss and expense** line (also on the application export, row 30).

## CVR: built (20 Nov, script 015)
**Found in the 2609 KOSH June CVR (template):**
- Powerhouse counted twice: £4,870 order value in D and again in Allowances / Variations, which understates the margin by £4,870. The breakdown's Return £ differs from the summary margin by exactly that.
- Overspends hidden: a package's remaining budget goes negative (Tiling supply: £6,458.54 target, Mudrak £11,788.40), so the overspend never reaches the margin.
- The JC movement column is last less this, so increases show as minus. Both period headings have the same date.
- Retention is calculated at 0% while the note says 5%. Some "See … above" notes are out of date.

**Found in the Micro office SoW (R5):**
- The OHP column is 15% even on lines priced at their own OH&P (M&E at 10%).
- VE omissions reduce the price without reducing the cost columns (23 lines, −£29,459.81).
- "Client Direct" / "Excluded" / "Omitted" / option lines carry £114,586 of cost in the cost columns.

**Decisions (Richard, 20 Nov):**
- **Overspends show and reduce the margin.** Forecast = the larger of target and cost to date, unless a forecast is typed with a note. It's flagged either way.
- **Only agreed VOs count** in the anticipated final value. Each agreed VO's cost (its build-up before OH&P and prelims) goes to a package's target, chosen in the CVR.
- **Both SoW layouts are read:**
  - Micro: only priced lines count, OH&P = price less cost line by line, and Subbie is split by SoW section.
  - Older KOSH breakdown: every package is read as it stands.
  - Both reconcile to the SoW total to the penny. The lines that don't reconcile are listed after the import.

**How it works (Job › CVR tab):**
- **Packages (budgets):** the office SoW's cost columns. Each package has a target, chosen in this order:
  1. a typed target with a note (as the Prelims tab / row 1444)
  2. the orders placed against it (order value + instructed subcontract variations, from Payment notices)
  3. EP at the job's % of the contract sum (4% by default)
  4. the SoW budget

  OH&P, DuB management and DuB design are shown and omitted.
- **Costs:** the iPlicit Jobcost Report as Excel, read by its headings. Final Total Costs = invoiced + committed + unposted + provisions, so it includes committed POs. Each supplier (code + name, since CC04 covers several) is allocated to a package once and remembered for the job. A supplier can be split by % (e.g. Mudrak: tiles and timber floor). Unallocated costs still count in the total.
- **Movement:** this month less last month's CVR, by supplier, so an increase shows as a plus. For the first CVR it uses the report's Last Reported column.
- **Value and margin:** anticipated final value = contract sum + agreed VOs + possible reduction / negotiations. Margin = AFV − total cost.
  - **Superseded (Richard, 21 Nov): "CVR should always be on the SoW plus agreed variations".**
    - AFV = **the SoW total** (the job's current SoW, else the CVR budgets' SoW total) + agreed VOs + possible reduction.
    - The contract sum typed on the job is only compared, with a warning when it differs.
    - Shown as "SoW total" on the CVR. The export's Order Value / Final account projected follow it.
    - On 2611 Micro this moves the AFV from £847,000 to £885,065.01.
- **Interim position:** gross certified and retention from the latest assessed application. The programme block (start, original PC, duration, revised PC, weeks delay) comes from the job and the EOT tab.
- **Status:** a CVR is a draft until finalised, then its figures are kept as issued.

**Tested:**
- Both SoWs import and reconcile.
- Rebuilding the KOSH June CVR (same targets, allocations and JC costs) gives targets of £757,521.24 (= K1436), JC £89,474.38, tender OH&P 12.03% and 4.57 weeks delay, all as the sheet. Total cost is £762,851.10 and the margin £184,829.06 (19.50%). That is the sheet's figures corrected for the two errors above: −£4,870 + £5,329.86.

**Groups and preliminaries (Richard, 20 Nov, script 016):**
- **Allocation dropdown:** each option shows the package – subbie, from a linked order, else the note on the package. "+ Add a package…" adds a bespoke one, with its group.
- **Packages are grouped and alphabetical within each group:** Labour & materials, Subcontractors, Preliminaries, Other (EP, provisional sums, contingency, the omitted lines). This applies to the dropdown, the CVR table, Budgets and the Excel export. The group is worked out from the name and can be changed in Budgets.
- **Prelims sections:** the office SoW lists its prelims headings unpriced under one prelims price (Micro: 10 headings, £104,500 cost). Each heading becomes a package under Preliminaries.
  - The sections draw down the lump, shown as "Preliminaries – not yet split" (its target = the prelims budget less what the sections forecast).
  - Typing a section's target makes it its own budget.
  - An overspend shows when the prelims group passes the whole prelims budget.

**Splits and prelims management (Richard, 20 Nov, script 017):**
- **A supplier's cost is split by % or by £.** A % split follows the cost each month.
- **A £ split stays fixed.** If the supplier's total changes in a later report, the difference shows as not allocated (or too much), with a warning, until the split is updated. Switching between % and £ converts what's typed.
- **Management is an item under Preliminaries, like Site Manager, not a heading of its own** (Richard corrected this, 20 Nov). DuB Management and DuB Design are grouped under Preliminaries and can be chosen in the dropdown, marked "(omitted)". Cost allocated to them still counts, so it reduces the margin.

**Excel export = the KOSH CVR, cell for cell (Richard, 20 Nov, script 018):** "identical, as it runs into the wider company CVR". Two sheets.
- **Summary ("CVR_November 26"):** laid out as "CVR_June 26", same cells, columns, fonts, fills and formulas.
  - Every iPlicit supplier: code, name, Order Value, Allowances / Variations, Expected Final, Included in cost from JC, the package in L, last month / this month / movement in M–O.
  - Then Deposit Payments and Unforeseen Costs, OH&P / DuB Management / DuB Design each shown and omitted, each package (E = −its suppliers' costs + agreed VO cost, colour-matched to them), EP / Contingency last.
  - Total Cost = G + H + I of the totals row; Final account projected = contract sum + agreed VOs; AFV, margin, certified, retention and programme as the sheet.
  - A package let as one order wholly to one supplier sits on that supplier's row (order value in D), as Logik / Oscar / Powerhouse do. Its agreed VOs go in E, not its cost, so the Powerhouse double count above doesn't happen.
  - **Column I** (blank on the KOSH sheet but already inside its Total Cost) carries what a package is over target, or a typed forecast's difference, headed "Over target". That's how overspends reach the margin (decision above).
  - A prelims section's order value is what it draws from the lump, so the lump and its sections add up to the prelims budget.
- **Breakdown ("CVR 201126", the date prepared):** laid out as "CVR 030826". Every office SoW item: section totals in A, item total in B, number in C, then lines under it with the cost by package and its OH&P, each spread into a package column. L is OH&P, M is EP, then the omitted, prelims and the rest in SoW order, with a row check at the end.
  - Underneath: SoW totals, % of total, targets (yellow), Return £ / %, and who each package is with.
  - The summary's order values link to the target row, and OH&P to the OH&P total, as on the KOSH sheet.
- **The SoW lines are now kept** (script 018, table `cvr_budget_lines`). Re-import the office SoW once to fill them for a job.
- **One import for both (Richard, 21 Nov):** importing the **office SoW on the Applications tab** also updates the CVR budgets and their lines from its cost columns. It's a tick box, on by default, and typed targets, notes, orders and allocations are kept. A client SoW (no cost columns) leaves the CVR as it is.
- **One SoW for the whole job (Richard, 21 Nov):** "the overview page should also be where you upload the SoW which filters through for valuations, cashflow and CVR, but have the ability to swap it within any tab and it updates across the board".
  - A shared **Schedule of works** card sits on the job **Overview**, and the same card is on **Applications**, **CVR** and **Cashflow**.
  - It shows what each side is using: Valuations (revision, lines, total, file) and CVR / Cashflow (total, file). It warns when the two came from different files.
  - One import reads both sides of the file:
    - the priced lines go to Valuations;
    - the cost columns go to the CVR budgets, their lines and the Cashflow, with targets, notes, orders, allocations and cashflow weightings kept.
    - A client SoW updates Valuations only. A CVR breakdown tab (KOSH layout) updates the CVR and Cashflow only.
  - The CVR tab's separate budget import is gone; its Budgets card now points to the shared card.
  - **The mismatch check compares SoW totals, not file names (21 Nov):** a client SoW and the office SoW of the same revision always have different names, so the warning fired when nothing was wrong. It now warns only when Valuations and the CVR / Cashflow / Procurement are on different SoW totals, naming both.
  - After an import the card says exactly what was updated. If the file had no cost columns (a client SoW or an application), it says the CVR, Cashflow and Procurement still use the previous office SoW, and to import the office SoW to update them.
- **Upload a CVR done in Excel (Richard, 21 Nov):** "next to New CVR have a button for upload CVR so you can upload one you've done in Excel for the old-school ways".
  - The CVR tab has **"Upload a CVR (Excel)…"**. It reads the KOSH-layout summary sheet ("Interim Cost Value Reconciliation"; the app's export has the same layout) by its labels: Cost as at, Date prepared, Order Value, Jobcost Report, Total Cost, Final account projected, Possible reduction, Anticipated Final Value, Gross margin, Gross margin %, Gross Certified. It also reads the suppliers under "Name / Company" (code, name, "Included in cost from JC").
  - After a confirm showing the figures, it's kept as a **final CVR marked "Done in Excel"** (shown in the list, not opened in the editor, removable). Its supplier costs are saved as that month's job costing report, so the next CVR made in the app shows the movement from it.
  - Tested on the 2609 KOSH June CVR: cost as at 03/07/2026, prepared 03/08/2026, JC £89,474.38 over 22 suppliers, total cost £762,391.24, AFV £947,680.16, margin £185,288.92 (19.55%).
  - A file never saved in Excel (e.g. the app's export uploaded straight back) is refused with "open it in Excel and save it".
- **Overview layout (Richard, 21 Nov):** Job details and Valuation dates on top. Below them, a small Schedule of works box on the left (revision, total, file, what uses it) and a **To do** box on the right, still to build (see "Still to build"). Then Variations and notifications.
- **Cashflow total (Richard, 21 Nov):** "needs to be based off the SoW, not the entered contract sum, when the SoW figure is higher". Where the SoW comes to more than the contract sum entered, the cashflow totals the SoW (no negative difference row; a note says so). Where the contract sum is higher, the difference is still warned about and spread, as above. The Excel shows a "Forecast total" line under the contract sum.
- **Tested:**
  - Excel recalculates both files with no errors. Total Cost, AFV and margin equal the app to the penny (KOSH with an order, VOs and a 50/50 split; Micro with a prelims section and an overspend).
  - The KOSH lines rebuild every package budget and the £947,680.16 SoW total. OH&P is £113,978.56, 1p from the sheet's £113,978.57 because lines are kept to the penny.
- **Logo:** left off these two sheets for now. Top right is where the KOSH sheet has Date prepared and Tender Values, so the 60 × 15 mm logo would cover them. Richard to confirm.

## EOT: quoting a programme task's slippage (22 Nov, script 029)
- Richard: an automatic EOT from programme slippage is wrong, because some slippage is the contractor's own or a subcontractor's. So it works the other way round.
- **Programme slippage** box on each delay event (EOT tab): choose the programme task the event affected. The list shows every task's slip against the original programme (+7d late, on time…), grouped by section.
- **Quote it:** records the task, its finish in the original and now, and the days and working days, with the date quoted (`delay_events.programme_slip`, script 029). It's kept as quoted, so later programme changes don't alter a notice already sent. If the programme moves afterwards, the box says so and offers **Update the quote**.
- **Optional buttons, never automatic:**
  - **Claim N days** / **Claim N working days** fill Days claimed.
  - **Add to recap** adds a line, which goes in the notice letter: "22/11/2026 – Programme: Joinery install now finishes 05/03/2027, 7 days (5 working days) later than in the Initial issue (original programme) (26/02/2027)".
- The events list shows the quoted task and its slip. With no programme, or nothing committed yet, the box says what's needed first.

## EOT clauses and DBP's letter style (20 Nov, script 014)
- **Clauses are typed in per job, with no defaults** (Richard: they differ on every job, and defaults promote laziness). EOT tab › **Contract clauses**: form of contract, notice of delay clause, extension of time clause, loss and expense clause. Each **delay event has its own Relevant Event clause**, blank until typed (VO events too).
- **A letter won't generate until the clauses it needs are filled in.** The app says what's missing instead. The notice also needs the event's days claimed and the job's PC date.
- **Notice of delay follows Richard's Mall Walthamstow letter (Notice of Delay No 2, 13.08.2025):** ordinal date, client and address, **Fao:** (the job's client contact, picked in the Contract clauses box), "Our ref: RM/DBP/DN/n", "Dear Sir,", **Re: - Job – Delay Notice #n**. The body comes from the wording template, with the event numbered and in bold, then what happened, the mitigation and "A short recap of events" as bullets. The period is in weeks in words where it's whole weeks. The current PC is the revised PC so far, and the new PC is the current PC plus the days claimed. It closes "Yours sincerely," with the user's name, job title and "On behalf of du Boulay Projects Limited".
- One notice per delay event, numbered by the event number. The claim letter uses the same style, with the events table before the closing line.
- **My details** (click your email in the sidebar): each user sets their full name, initials and job title for letters.

## Monthly valuation reminders (20 Nov)
- **Every live job** gets a "valuation due" reminder each month it runs (start, or today, to PC; 12 months ahead if no PC date). **Revised 20 Nov (script 011):** due **on month end** and shown only **in the last 7 days** (amber), red if month end passes without it being marked Done; earlier than that it's noise. Other reminders keep their 14-day window. Linked to the job's Applications tab; rebuilt automatically when status, start or PC date change.
- **Outlook:** until IT approves the Microsoft 365 link, each job's Overview has **"Add valuation dates to my calendar"**: an .ics file with a 09:00 appointment (15-minute alert) on each date, which Outlook / iPhone adds when opened. Stable IDs, so re-opening an updated file changes appointments rather than duplicating them. Once Microsoft Graph is approved, the app can put these in users' calendars directly.

## Layout and templates area (20 Nov)
- **Sidebar layout** (chosen to scale with the modules to come): sidebar for company-wide areas (Home, Jobs, Contractors, Templates, Settings); inside a job, **each module is a tab** (Overview, Variations, Quotations, Applications, Payment notices…). Bell in the top bar on every page with a drop-down.
- **Home = "Needs attention"** (red / amber, clickable, Done / Snooze, upcoming on request) **then a searchable jobs table** with Live / Tender / Complete / All filters, contract sum, PC date and VO count.
- **Templates area: admin logins only**, enforced by the database (`profiles.is_admin`), not a shared password (a password in the browser app can be read by any signed-in user).
- **No "Templates" area and no "Commercial" section (revised 20 Nov):** commercial work (VOs, valuations, payment notices, job quotations) lives inside each job. Left-hand menu: Home · Jobs · **Estimating** · **Contracts** (EOT) · **Site** (was Project management; requisitions, 22 Nov) · Contractors (coming soon) · **Settings** (admins only). **O&M lives inside each job** (job tab); its company-wide standard document list by trade is in Settings (admins). Everyone can read the sections; only admins can change their wording / lists. Each wording template belongs to one document (`text_templates.category`).
- **Estimating (agreed 20 Nov, revised same day):** laid out **like Jobs but simpler**: a searchable list of **enquiries** (E001, E002…; Open / Won / Lost / All) with a form for name, site address, client, contact, email, phone, date received, due date, estimator, notes and status (New enquiry › Pricing › Submitted › Won / Lost). Each enquiry has its own **quotations**, numbered per enquiry: `E001 – QU001 – <subject>`, same editor and Word layout as job quotations. **"Won: set up as job"** opens the new-job form filled in from the enquiry; on saving, the enquiry is marked Won and linked to the job, and its quotations **move into the job**, renumbered after the job's own (`2611 FISL – QU00n`). Estimating also holds the standard quotation wording and the clause library.
- **Company details and insurances are admin-only, in Settings.** Certificates and company documents stay on OneDrive (updated there regularly); the app holds the cover dates and limits for reminders and the CAR check, no file uploads.
- **Templates are used by the app:** company details, default OHP / prelims / retention, main T&Cs, add-on clause library, letter wording, O&M document lists, insurances and certificates are edited on screen and flow into every export. Excel / Word export layouts stay built into the app; layout changes come through Claude. Five templates in `reference/templates` today; the list will grow.
