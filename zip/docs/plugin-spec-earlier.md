# DBP Toolkit — Claude plugin spec (draft)

Status: **design complete except items marked [ ] — ready to build once defaults are confirmed.**

## Decided
- Format: one Claude plugin, installed by everyone at du Boulay Projects (whole company).
- Connections: Microsoft 365 (Outlook, Teams, SharePoint) + DBP's own apps below.
- **Emails: draft only** — saved to the user's Outlook Drafts, never auto-sent.
- **Company name on documents: du Boulay Projects Ltd.**
- Skill list revised by user 18 Nov 2026 (below). Dropped from first draft: client quotation, quote comparison, standalone progress report.
- **DBP Timeline + DBP Minutes: files first, direct connection later.** Phase-2 connector is a job for the colleague/developer who built and maintains both apps.
- **Templates bundled into the plugin** (uploaded 18 Nov): Schedule of Works extras14 (= PRICING DOCUMENT REV 14, same template), VARIATION SUMMARY AND BUILD UP .xlsm, Letterhead .docx. Skills also check SharePoint Templates site for a newer version.
- **Reference samples bundled** (uploaded 18 Nov): Corsham Street DRAFT Programme 10.11.2026 (PDF, 12 sheets), Micro 60 Sloane Ave minutes 19.10.2026 (PDF).
- **Skills stay independent** where the user said so: variations do not feed applications automatically.

## Systems found (18 Nov)
| System | What it is | How Claude works with it |
|---|---|---|
| **DBP Timeline** — du-boulay-timeline.web.app | In-house Gantt app (Frappe Gantt + Supabase). Login per user. Programmes + revisions in the cloud; opens/saves **JSON and MS Project XML**; Print/PDF; baselines, critical path, linked tasks. Holds the **DBP contractor list (~700 subbies/suppliers)**. | Phase 1: Claude writes a programme JSON → user clicks *Open file…*; user saves a file for Claude to read. Phase 2: direct connector. |
| **DBP Minutes ("Mint")** — dbp-mint.firebaseapp.com | In-house minutes app (Firebase). Login. Meetings, attendees, points, section headings, tasks, next meeting; export PDF/Word, email, share. | Phase 1: Claude produces minutes in the Mint layout (PDF/Word); import TBC. Phase 2: direct connector. |
| **SubmittalLink** | Commercial RFI/submittal platform. No Claude connector found. | **Browser**: Claude fills in the RFI in SubmittalLink; the user presses submit. Needs the Claude desktop app open and the user signed in to SubmittalLink in the built-in browser. |

## DBP Timeline file format (read from the app's autosave, 18 Nov)
```
{ data: {
    schemaVersion: 1,
    projectName, projectStart: "YYYY-MM-DD", weekStart: null,
    clientLogo: <data URL, optional>,
    cloud: { programmeId, rev, revId, committed }   // omit for new files
    groups:   [ { id, name, collapsed } ],            // sections
    trades:   [ { name, color } ],
    shutdowns:[ { id, name, start, end } ],           // e.g. Christmas 2026: 23 Dec – 1 Jan
    tasks: [ { id, name, groupId, trade, contractor,
               start: "YYYY-MM-DD", duration: <working days>,
               milestone: bool, predecessors: [], progress: 0-100,
               rag: "green"|…, prereqConfirmed: bool, prereqNote: "",
               baselineStart: null, baselineDuration: null, skeleton: false } ] },
  savedAt: <epoch ms> }
```
- Default trades: Enabling Works / Strip-out, Groundworks & Structure, M&E, Dry-lining & Partitions, Joinery & Fit-out, Finishes & Decoration, FF&E & Equipment, Commissioning & Handover, Precon, Site works, Kitchen / Catering, Internal PM, Architectural Design, Client.
- [ ] Predecessor link format not yet seen (no linked tasks in sample) — either confirm from a file with links, or leave links for the user to add with *Link tasks*.

## Programme layout (Corsham Street sample)
- Header: `<Project>` / "CONSTRUCTION PROGRAMME · REV A · DRAFT · PRINTED <date>"; columns TASK · START · DAYS · END; ◆ milestones; A3 landscape; footer Project / Revision / Status / Printed / By / Sheet.
- Sections: Design (36 tasks) → Precon (13) → Enabling Works (12) → area/floor sections (e.g. L2 to B4 – 95 tasks; L3–L9 Rooms & Corridor – 26 tasks each, repeated per floor) → Completion.
- Precon pattern: Tender received → Initial pricing (14d) → Budgets submitted → Contract award → Long-lead orders (3d) → Orders placed (14d).
- Use as the reference for durations and sequencing.

## Minutes layout (Micro, 60 Sloane Ave sample)
- Title = project; subtitle = meeting name; line: date · Attendees; "Also referenced (not in attendance)".
- Dash-bullet points; owners named per point ("Owner: …"); URGENT flag.
- **TASK SUMMARY** grouped by person.
- Footer: "Comments or corrections… If we don't hear back within 72 hours, the notes will be taken as agreed."

## Template notes (from uploaded files)
**Schedule of Works extras14** — sheets: Schedule of Works (sections; trade split columns; OHP via `margin`, firm/budget switch), Clarifications, VE, Provisional Sums, **Sub Contract** (trade → subcontractor list), **Day Work Rates** (Director £500, PM £400, QS £390, Site Manager £360, Joiner £300 … all +20%).

**VARIATION SUMMARY AND BUILD UP (.xlsm, macros)** — Summary sheet (VO No., Name, Date, Budget, Firm, Instructed, CAI number, Notes; Not issued / Issued / Agreed / Rejected); per-VO sheet (description, budget, item/qty/unit/rate/total incl. OMIT; **OHP @ 15%**; **Prelims @ 9%**).
⚠ Uploaded copy contains Mall Walthamstow sample VOs 1–4 — build a clean copy.

**Letterhead** — logo in header; footer lists directors (DCH du Boulay, LR Brownlie, AJ Killeen, CS Gregory, KM Bialek).

## SharePoint (18 Nov)
- Templates site: 01 GENERAL STATIONERY (letterhead), 02 COMMERCIAL (variation workbook, pricing doc REV 14), 03 CONSTRUCTION (progress report, New Project Form V2), 04 HEALTH & SAFETY.
- Valuations to copy: 2603 JORA – 11 Randolph Rd / 5. Commercial / Valuations / Client Valuations / Valuation No. 6, 7.
- Variation issued format: 2606 FOT5 – Fortnum & Mason T5 / 5. Commercial / Variations / VO09.
- Cashflow examples: Kong (1047), Salone – Vigo Street, Lenny's 2615.
- Enquiries: `<job>/1. Estimating/02 - Subcon/01 - Enquiries` (.msg per trade).
- Job sites /sites/24XX, /25XX, /26XX; folder `<YYNN> <CODE> - <name>`; subfolders 1. Estimating, 3. Orders, 5. Commercial…
- Address on older templates: Studio 7, Royal Victoria Patriotic Building, John Archer Way, London SW18 3SX · 020 8877 0266 (confirm).

## Phase 2 — ask for the developer
- [ ] Mint: add an import (e.g. open JSON) so Claude-drafted minutes can be loaded
- [ ] Both apps: small connector/API so Claude can read and write directly

## Foundation: DBP house style (always on)
- [x] Letterhead bundled; entity du Boulay Projects Ltd; job numbering YYNN + code
- [ ] Confirm address, company no., VAT no., web
- [ ] Tone / signer (default: formal British English, signed by the user running the skill)

## Skills
### 1. Drawings → BoQ
- [x] Bundled template + SharePoint fallback, no laptop path
- [ ] Rates (default: DBP pricing database where available, else user input; flag any market-rate guesses)

### 2. Programmes — DBP Timeline
- [x] Files first; draft from BoQ/scope, update progress, feed cashflow, narrative
- [x] File format captured; Corsham sample for durations/sequencing
- [ ] Predecessor links (see above)

### 3. Cashflows
- [x] Programme-driven; new DBP template (monthly by package, cumulative %, S-curve)
- [ ] Default: client-facing, excl. VAT, retention line

### 4. Application to certificate
- [x] Latest live format; ask retention/dates/terms each time; variations added by user
- [ ] Default: no applied-vs-certified tracking

### 5. Variation — formal for issue
- [x] Excel sheet as now
- [ ] Default: per-VO sheet from build-up workbook, saved as PDF for issue

### 6. Variation Excel
- [x] Bundled template; daywork from Day Work Rates; separate from applications

### 7. Enquiries
- [x] One draft email per trade; trades from Sub Contract sheet; names from Timeline; emails from Outlook
- [ ] Default: wording from recent enquiries, 10 working days, chase draft 3 days before

### 8. Meeting minutes — Mint
- [x] Mint layout captured from sample; notes/transcripts → minutes, action chasers (drafts), next agenda

### 9. Inbox triage
- [x] Weekday mornings + on demand; no filing
- [ ] Default categories: Needs reply / Chase / FYI, grouped by job

### 10. RFIs — SubmittalLink
- [x] Claude fills in via browser; user submits
- [ ] User signs in to SubmittalLink in the built-in browser once
