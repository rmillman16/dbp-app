# DBP app

du Boulay Projects' internal web app. Each job holds its commercial work (variations, quotations, applications, payment notices, cashflow, CVR, EOT), programme, procurement, sampling, minutes and O&M. Alongside the jobs it has Estimating, Contracts, Contractors, Site requisitions, a company dashboard and Settings.

- **Front end:** React + TypeScript + Vite. It is a static site that installs to phones and works offline.
- **Data, sign-in and files:** Supabase (Postgres with row-level security, Auth, Storage, Edge Functions).
- **Decisions and scope:** `docs/decisions.md` is the record of what was agreed and why. Its "Still to build" list is at the top. Read it before changing a module.
- **Requests for IT:** `docs/questions-for-IT.md`.

## Getting started

1. Install [Node.js](https://nodejs.org) (LTS) and Git.
2. Clone the repository, then install:
   ```
   git clone <repo url>
   cd dbp-app
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in the two values. Richard will send them.
   - `VITE_SUPABASE_URL`: the project URL.
   - `VITE_SUPABASE_ANON_KEY`: the **publishable** key.

   **Never** put the secret / service-role key or the database password in the app, in `.env.local` or in the repository.
4. Run it with `npm run dev`, then open the address it prints. Sign in with your app login; an admin adds you in Settings › Users.
5. Check your work with `npx tsc -b`, which must be clean, and `npx vite build`.

Everyone's local copy talks to **the same live database**. What you enter while testing is real data.

## How we work

- **Branches and pull requests.** Don't push straight to `main`. Make a branch, open a pull request, and Richard merges it.
- **Formatting:** `npx prettier --no-semi --single-quote --print-width 180 --write <files>`.
- **Writing style:** UK English, £, DD/MM/YYYY. Write messages in the app plainly, as you'd say them to a colleague.
- **Database changes** are numbered SQL scripts in `supabase/`, e.g. `052_….sql`. The rules:
  - Each script starts with a header comment saying what it does, in plain words, and ends the header with "Safe to run more than once. No existing data is lost."
  - Scripts must be re-runnable: `if not exists`, `drop … if exists`, `create or replace`.
  - Every table has row-level security. Follow the patterns in `043` (access grid) and `042` (archived jobs read-only).
  - Add a row to `supabase/README.md` marked ⬜ Not yet.
  - **Only Richard runs scripts**, in the Supabase SQL Editor, in number order. Tick the README row once it's run.
  - **Agree the next number with Richard before writing one,** so two people don't both write 052.
  - Never re-run `001`.
- **Edge Functions** live in `supabase/functions/`. Richard deploys them. Their secrets live only in Supabase › Edge Functions › Secrets.
- **Emails:** the app only drafts emails (Outlook `mailto:`). The one exception is the short notification emails sent by the `send-emails` function.
- **Bank details** are never stored.
- **Keep the docs current.** When something is agreed or built, update `docs/decisions.md`, including its "Still to build" list.

## Where things are

| Path | What |
|---|---|
| `src/pages/` | One file per screen (e.g. `Site.tsx` requisitions, `OmTab.tsx`, `Minutes.tsx`, `ProgrammeTab.tsx`) |
| `src/lib/` | Data loading and saving per module, calculations (`cvrCalc.ts`, `cashflowCalc.ts`…), exports (`export*.ts`), `access.tsx` (profile types and the access grid), `notifications.tsx` (the bell) |
| `src/components/` | Shared pieces: layout, job tabs' building blocks, programme editor, `NoAccess`, `SuggestInput`, `ReadOnlyArea` |
| `supabase/` | Numbered SQL scripts, their README (what's been run), and Edge Functions |
| `docs/` | Decisions and scope, and the IT list |
| `reference/` | Copies of older DBP apps kept for reference only |
