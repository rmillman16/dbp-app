
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
- **Each SoW section** (from the current priced SoW, below the line left out), **agreed VO** and **issued VO (at risk, shown separately)** is linked to programme activities. The app suggests them from shared words in the names and trades, with M&E read as mechanical / electrical.
- **Each stage gets a %** (adding up to 100%) and a **when**: at the start of, spread across (by working day, Mon–Fri), or at the end of its activities (all linked, or a chosen few), or on a typed date. "Start on site to PC" is an activity of its own, using the job's dates.
- **Starting weighting until set:**
  - a linked section: 100% Progress spread across its activities;
  - prelims (Richard chose "weighted to set-up and finish"): 10% at start on site, 80% spread to PC, 10% at PC.
- **Nothing is lost:** a section not yet linked, or with stages short of 100%, is listed as "not placed" with the reason. Each section's months add back to its value to the penny.
- **Forecast:**
  - calendar months (valuations at month end), excl. VAT;
  - this month, cumulative, cumulative %, retention held (job %, halved from the PC month) and payment after retention;
  - issued VOs in their own at-risk column;
  - the S-curve on screen: monthly bars and the cumulative % line.
- **Step 2 (next):** Excel export (internal copy with DBP's applied figures, client copy with certified and paid only), the actuals overlay from Applications for past months, and the S-curve in the Excel.

## Timeline and Minutes merge — parked (19 Nov)
- Parked until the developer (who holds the Minutes Firebase project) and the IT manager (Supabase hosting) are available. Fresh copies of both apps to be taken from the live sites when work starts.

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
- **Tested:**
  - Excel recalculates both files with no errors. Total Cost, AFV and margin equal the app to the penny (KOSH with an order, VOs and a 50/50 split; Micro with a prelims section and an overspend).
  - The KOSH lines rebuild every package budget and the £947,680.16 SoW total. OH&P is £113,978.56, 1p from the sheet's £113,978.57 because lines are kept to the penny.
- **Logo:** left off these two sheets for now. Top right is where the KOSH sheet has Date prepared and Tender Values, so the 60 × 15 mm logo would cover them. Richard to confirm.

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
- **No "Templates" area and no "Commercial" section (revised 20 Nov):** commercial work (VOs, valuations, payment notices, job quotations) lives inside each job. Left-hand menu: Home · Jobs · **Estimating** · **Contracts** (EOT) · **Project management** (coming soon) · Contractors (coming soon) · **Settings** (admins only). **O&M lives inside each job** (job tab); its company-wide standard document list by trade is in Settings (admins). Everyone can read the sections; only admins can change their wording / lists. Each wording template belongs to one document (`text_templates.category`).
- **Estimating (agreed 20 Nov, revised same day):** laid out **like Jobs but simpler**: a searchable list of **enquiries** (E001, E002…; Open / Won / Lost / All) with a form for name, site address, client, contact, email, phone, date received, due date, estimator, notes and status (New enquiry › Pricing › Submitted › Won / Lost). Each enquiry has its own **quotations**, numbered per enquiry: `E001 – QU001 – <subject>`, same editor and Word layout as job quotations. **"Won: set up as job"** opens the new-job form filled in from the enquiry; on saving, the enquiry is marked Won and linked to the job, and its quotations **move into the job**, renumbered after the job's own (`2611 FISL – QU00n`). Estimating also holds the standard quotation wording and the clause library.
- **Company details and insurances are admin-only, in Settings.** Certificates and company documents stay on OneDrive (updated there regularly); the app holds the cover dates and limits for reminders and the CAR check, no file uploads.
- **Templates are used by the app:** company details, default OHP / prelims / retention, main T&Cs, add-on clause library, letter wording, O&M document lists, insurances and certificates are edited on screen and flow into every export. Excel / Word export layouts stay built into the app; layout changes come through Claude. Five templates in `reference/templates` today; the list will grow.
