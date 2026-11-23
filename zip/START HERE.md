# Start here (for Richard)

This folder is the home of the DBP super app. Claude reads `CLAUDE.md` automatically, so it knows the plan and every decision we made.

## One-off setup
1. Unzip this folder somewhere sensible, e.g. `C:\Users\Richard Millman\Projects\dbp-app` (not inside OneDrive or SharePoint, which fight with the build files).
2. Install, if you haven't already:
   - **Visual Studio Code** (code.visualstudio.com)
   - **Node.js LTS** (nodejs.org)
   - The **Claude Code** extension in VS Code (Extensions, search "Claude Code", Install, sign in)
3. In VS Code: **File › Open Folder…** and pick the `dbp-app` folder.
4. Copy `.env.example` to a new file called `.env.local` and paste in your Supabase **Project URL** and **publishable (anon) key** (Supabase › Project Settings › API). Never the secret key.

## Start building
Open the Claude Code panel and type:

> Read CLAUDE.md and docs/decisions.md, then start step 1 of the build order.

Claude will set the app up and ask you to look at it in the browser as it goes.

## What's in here
- `CLAUDE.md`: the build brief Claude follows
- `docs/decisions.md`: every decision from scoping
- `supabase/`: database scripts (001 already run) and the run log
- `reference/templates/`: your templates the exports must match
- `reference/test-cases/`: real applications and the payment notices they should produce
- `reference/brand/`: logo and insurance confirmation
