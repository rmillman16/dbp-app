# DBP app: questions and requests for IT

Running list of what the DBP app needs from IT. Newest additions at the top of each section; tick items off as they're done.
**Next discussion: Monday 23 November 2026.**

## 1. Anthropic API for reading PDFs (capped trial)
**What for:** the app reads PDFs (supplier quotes, schedules of works, subcontractors' applications) and turns them into priced lines for staff to check, instead of retyping them. Used now in quotations; next in subcontract payment notices (Lumen / Mercury style applications).
**How it's built:** a small server step on our Supabase project (Edge Function `read-pricing-pdf`, code in `supabase/functions/read-pricing-pdf/index.ts`) sends the PDF to Claude and returns the lines. The key never goes into the app itself; only signed-in users can use it. **If there's no credit or no key, the app says so and asks for the Excel version instead: nothing breaks.**
- [ ] Create an Anthropic API account for DBP (console.anthropic.com), company card or invoice.
- [ ] **Prepaid credits with auto-reload OFF** (suggest £10 to start) and a monthly spend limit, so it can never overspend. Note: this is separate from any Claude subscription; subscriptions don't cover API use.
- [ ] Create an API key and add it in Supabase › Edge Functions › Secrets as `ANTHROPIC_API_KEY`.
- [ ] Deploy the function: Supabase › Edge Functions › Deploy a new function › name `read-pricing-pdf` › paste the code from the file above › Deploy. (Or with the Supabase CLI: `supabase functions deploy read-pricing-pdf`.)
- [ ] **Also used by the tender enquiry generator (Richard, 23 Nov).** In Estimating › an enquiry › Tender enquiries, the estimator uploads the drawings for a package (PDFs or pictures) and the app drafts a **scope of works** from them, which the estimator edits and can attach to the contractor emails. It uses the **same API key** (`ANTHROPIC_API_KEY`), so no second account is needed.
  - Deploy a second function: Supabase › Edge Functions › Deploy a new function › name `tender-scope` › paste `supabase/functions/tender-scope/index.ts` › Deploy, with **Verify JWT ON**.
  - Optional secret `SCOPE_MODEL` (default `claude-opus-5-5`, the most capable model for reading drawings).
  - The drawings are stored in the app's private `orders` storage bucket (tender/ folder) and sent to Anthropic only when the estimator presses the button.
  - **Cost:** drawings use many more tokens than text PDFs: roughly 10p to £1 per package depending on the number of pages. Worth counting in the monthly limit above (e.g. £20).
  - If there's no key or credit, the button says so and the scope can still be typed by hand.
- [ ] Data protection: PDFs may include names, prices and bank details, and the tender drawings are client project information. Check Anthropic's current commercial terms and data processing agreement (API data isn't used for model training; limited retention) against DBP policy, and any confidentiality terms in the client's tender documents.
- **Cost:** about 5–15p per typical 1–7 page PDF on the main model (Claude Opus 5.5, $4 / $20 per million tokens in / out). 50 documents a month ≈ £3–£7. A smaller model (Claude Haiku 5.5) is ~40× cheaper but may misread messy tables; to choose one, set the secret `ANTHROPIC_MODEL=claude-haiku-5-5`. Richard to decide after testing both on real PDFs.

## 2. Microsoft 365 app registration (Microsoft Graph)
**What for:** (a) save exports (VO sheets, quotations, applications, payment notices) straight into each job's SharePoint site in the right folder; (b) put monthly valuation dates (and later other reminders) straight into users' Outlook calendars. Until then, exports download and calendar dates come as a file to open in Outlook.
- [ ] Approve an app registration in Entra ID with access limited to the job SharePoint sites (`Sites.Selected`) and calendar write for signed-in users (`Calendars.ReadWrite`, delegated).
- [ ] Agree how the app signs users in to Microsoft (single sign-on with work accounts would also replace separate app passwords).
- [ ] **For material / hire requisitions (agreed with Richard 22 Nov): "Sign in with Microsoft"** so site managers raise requisitions with their DBP account, with no app passwords and no accounts to set up.
  - Register a **single-tenant** app in Entra ID (DBP accounts only).
  - Give Richard its Application (client) ID and a client secret, to enter in **Supabase › Authentication › Providers › Azure**. The secret goes only there, never in the app.
  - Add Supabase's callback URL (shown on that page) as the redirect URI.
  - The requested scopes are just `openid email profile`.
  - Someone who leaves loses access when their Microsoft account is disabled.

- [ ] **Notification emails from the app (agreed with Richard 22 Nov).** Short automatic notices, e.g. "the buyer has a question on MR0012" or "HR0005 hire ends in 3 days", with a link into the app. No attachments or documents.
  - Create or choose a **shared mailbox** to send from, e.g. `requisitions@duboulay.co.uk` or `dbp-app@duboulay.co.uk`.
  - On the app registration, add the Microsoft Graph **application** permission **Mail.Send**, with admin consent.
  - **Limit it to that one mailbox** with an Exchange Online application access policy (`New-ApplicationAccessPolicy -AccessRight RestrictAccess -PolicyScopeGroupId <mailbox or mail-enabled group> -AppId <client id>`), so the app can't send as anyone else.
  - Give Richard the **tenant ID**, **client ID**, a **client secret** and the **mailbox address**. He enters them only in Supabase › Edge Functions › Secrets (`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MAIL_SENDER`), never in the app.

## 3. Supabase plan before go-live
- [ ] Upgrade the Supabase project to **Pro** (about $25 / month) for daily backups of the data. The free plan has no automatic backups; until then an admin runs Settings › **Export all data** weekly.
- [ ] Confirm the project's region is London (UK data residency).
- [ ] **Photo storage (snagging, 24 Nov):** site staff and trades add snag photos from their phones. They are scaled down to about 1600 px before upload (roughly 300 KB each), so 10,000 photos is about 3 GB. The Pro plan includes 100 GB of file storage; worth knowing before go-live.
- [ ] Decide who else holds owner access to the Supabase project (currently Richard).

## 4. Hosting and the web address
**Recommended (Richard, 23 Nov): Azure Static Web Apps**, in DBP's own Microsoft Azure. The app is a static website: its data stays in Supabase, so hosting only serves the app's files.
- **In the meantime,** Richard is using a free Netlify site for testing with colleagues. Moving to Azure later just means deploying the same files there and changing the address in two settings. Nothing is rebuilt or lost.
- Why Azure:
  - IT owns and manages it alongside the rest of DBP's Microsoft set-up.
  - It has a free tier, and the custom domain gets free HTTPS.
  - It can **require a DBP Microsoft sign-in before the site loads**, on top of the app's own login, using the same Entra app as §2.
  - Deploys are one command, so the way changes are made doesn't change.
- [ ] Create an **Azure Static Web App** (free tier) in DBP's Azure subscription. Give Richard a deployment token, or deploy access, so updates can be published.
- [ ] **SPA routing:** the app needs every path to serve `index.html` (navigation fallback in `staticwebapp.config.json`, which Claude will add to the app).
- [ ] **Web address:** e.g. `app.duboulay.co.uk` (or `dbp-app.com` if DBP owns it), pointed at the static web app.
- [ ] Optional: restrict the site to DBP accounts (Entra ID authentication on the static web app). Note that site managers and any External users would then need DBP accounts or guest access.
- [ ] Once it's live, Richard updates **Supabase › Authentication › URL Configuration** (Site URL) and the email secret **APP_URL** to the new address.
- The app already installs to phones and tablets and works offline.
- **Not Firebase Hosting:** Timeline and Minutes are on Firebase under the developer's Google account, which DBP doesn't control. Minutes has now been rebuilt inside this app.

## 5. Code: private GitHub repository (Richard, 23 Nov)
Richard has changed his mind on GitHub: the code is going into a **private GitHub repository** so colleagues can help develop the app. It no longer needs to be kept only on his laptop.
- [ ] Ideally the repository sits in a **DBP-owned GitHub organisation** (free plan is fine), so the company owns the code rather than a personal account. Who should own it?
- [ ] Colleagues need GitHub accounts (work email), added to the repository.
- No secrets are in the repository: `.env.local` is excluded, and server keys live only in Supabase.
- The OneDrive backup bundle can carry on as a second copy.

## 6. Timeline and Minutes merge (parked)
- [ ] Access to the Minutes Firebase project (held by the developer) and fresh copies of both apps when work starts.

## Notes
- Some SharePoint Word files couldn't be copied out (probably a sensitivity label); PDFs worked. Worth knowing for future template updates.
