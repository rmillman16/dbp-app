# du Boulay Projects (DBP) super app: build instructions for Claude

You are building **one web app for du Boulay Projects Ltd**, a London fit-out contractor. It replaces their spreadsheet and macro templates for the commercial "mundane bits" and will later absorb two existing apps (DBP Timeline and DBP Minutes). The person you are working with is **Richard Millman, QS**. He is not a developer: explain in plain English, keep him in the loop, and ask before anything hard to undo.

**Read `docs/decisions.md` before starting any work.** It holds every decision agreed during scoping (19–20 Nov 2026). Where this file and `docs/decisions.md` disagree, `docs/decisions.md` wins; if something isn't covered there, ask Richard rather than guess.

## Stack (agreed)
- **Database / auth / storage:** Supabase (already created; schema in `supabase/`). Region should be London.
- **Front end:** a single-page web app. Suggested: Vite + React + TypeScript, Supabase JS client. Keep it simple: Richard must be able to run it with `npm install` and `npm run dev`.
- **Excel in and out only**, no macros. Exports built in the browser (ExcelJS or similar) and must reproduce DBP's own layouts in `reference/templates/`: same tabs, columns, colours and wording.
- **Word / PDF** exports for quotations, letters (EOT notices), progress reports, O&M front pages. Use the letterhead in `reference/templates/dbp Letterhead - Template.docx`.
- **Hosting:** to be set up by DBP's IT manager (suggested Firebase Hosting, like Timeline and Minutes). Develop locally until then.
- **SharePoint:** later, via a Microsoft Graph app registration (needs IT's Microsoft 365 approval). Until then, exports download to the user, who saves them to SharePoint.

## Secrets
- Supabase **Project URL** and **publishable (anon) key** go in `.env.local` (copy `.env.example`). `.env.local` is git-ignored; never commit it.
- **Never ask for or use the secret / service-role key or the database password** in the front end.
- Bank details are never stored in the app or the database.

## Database changes
- `supabase/001_dbp_app_schema.sql` has **already been run** on the live project (20 Nov 2026). Never re-run it.
- Any change to the database = a **new numbered script** in `supabase/` (`002_…sql`, `003_…`) that alters what exists without losing data, plus a row in `supabase/README.md`. Richard runs it in Supabase › SQL Editor. Tell him clearly when one needs running.
- Every table has row level security: signed-in users only, no roles yet. Keep it that way unless Richard asks.

## Build order
1. **Sign-in and the shell**: Supabase email sign-in, front page with the **notifications pane (bell, count, red overdue / amber due soon)** and a jobs list; add / edit a job (job no. + code, e.g. 2611 FISL; SharePoint site; contract sum; PC date).
2. **Variations** (first real module): VO register and VO build-up with OMIT and ADD sections and subtotals, OHP 15% / prelims 9% defaults, statuses Not issued / Issued / Agreed / Rejected, budget hidden once a firm price exists, Excel export matching `reference/templates/dbp VARIATION SUMMARY AND BUILD UP - TEMPLATE.xlsm` (VO sheet + summary with colour key). Test case: 2611 Micro by The Fix.
3. **Quotations** from a VO or standalone; reference `2611 FISL – QU001 – Waterproofing`.
4. **Client applications** (2611 Application 2 R2 layout: Anticipated Final Account front sheet, priced SoW with application and Client Assessment columns, VO summary).
5. **Subcontract payment notices**: import the sub's application PDF / Excel, run the checks in `docs/decisions.md`, export in exactly the layout of `reference/templates/2609 Kong Logik Payment Notice 2 …xlsx`. Expected results for two real applications are in `reference/test-cases/` (Lumen due £56,401.94; Mercury due £44,056.19).
6. Then cashflow, procurement schedule, sampling tracker, CVR, EOT, progress reports, O&M / H&S file, as scoped in `docs/decisions.md`.

## House rules for every screen (decided 20 Nov)
- **Every screen works on a phone, a tablet / iPad and a laptop.** Check each new screen at phone width (~375 px), tablet (~768–1024 px) and laptop before calling it done: no sideways page scrolling, tables become stacked cards on phones (`table.stack` with `data-label` on each cell), buttons big enough to tap, inputs 16 px so iPhones don't zoom.
- **Offline-ready:** the app installs to the home screen and opens from cache with no signal. Read data through `cached()` in `src/lib/offline.ts` so screens show the last-loaded data offline. **Meeting minutes** are editable offline (outbox on the device, synced when the connection returns) and the **latest programme** is kept on the device for offline viewing; **everything else is view-only offline** (agreed 20 Nov).

## House rules for every output
- **Logo:** the current dbp logo (`reference/brand/dbp-logo.svg` / `.png`) top right of every printed A4 page, **60 × 15 mm, 10 mm from the top and right edges**, the same size on every tab or page whatever its print scale. In Excel use a picture on the sheet sized to cancel the tab's fixed print scale (see `docs/decisions.md`, "Logo on every export"); header-only logos aren't visible on screen.
- **UK English**, £, dates as DD/MM/YYYY.
- The client is called **"Client"** on exports, never the certifier's name.
- **Emails are drafted only, never sent** automatically.
- Progress reports never show the forecast final account, a variations list, CVR, margin or application figures.
- Quotations live in the draft VO folder (`7. Variations/VARIATIONS TO PRICE`) until accepted, then move to the VO folder.

## Working with Richard
- Show him the screen (`npm run dev`) after each meaningful step and ask if it matches what he expects. He prefers previews before big changes.
- Commit little and often once the GitHub repo exists, with clear messages.
- When you finish a module, update `docs/decisions.md` only if a decision changed, and tell Richard what's next.
