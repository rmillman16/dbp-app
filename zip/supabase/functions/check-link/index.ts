// Supabase Edge Function: can a SharePoint link be opened by anyone (23 Nov)? The O&M tracker's links (as-builts
// etc.) go to the client, so they need "Anyone with the link" sharing. From the browser every link opens for
// staff, because they're signed in to SharePoint, so this opens the link from the server with no sign-in, the
// way a client would, and reports:
//   public   the document opened                      → green tick in the app
//   sign_in  SharePoint asked for a sign-in / refused  → change the sharing to "Anyone with the link"
//   broken   the link doesn't exist (404 etc.)
//   unknown  couldn't tell (timeout, odd reply)
// Only SharePoint / OneDrive addresses are checked, and only signed-in users of the app can ask.
// No secrets needed. Deploy as for manage-users, with Verify JWT off.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ALLOWED = (h: string) => h.endsWith(".sharepoint.com") || h === "onedrive.live.com" || h === "1drv.ms";
const SIGN_IN = (u: URL) =>
  /(^|\.)login\.microsoftonline\.com$|(^|\.)login\.live\.com$|(^|\.)login\.windows\.net$/i.test(u.hostname) ||
  /\/_forms\/|authenticate\.aspx|accessdenied|\/_layouts\/15\/(error|accessdenied)\.aspx/i.test(u.pathname);

async function check(start: string): Promise<{ status: "public" | "sign_in" | "broken" | "unknown"; detail: string }> {
  let url = new URL(start);
  const jar = new Map<string, string>(); // SharePoint sets a cookie on the first hop of an "Anyone" link and expects it back
  for (let hop = 0; hop < 10; hop++) {
    if (!ALLOWED(url.hostname) && !SIGN_IN(url)) return { status: "unknown", detail: `It leads off SharePoint (${url.hostname}).` };
    if (SIGN_IN(url)) return { status: "sign_in", detail: "SharePoint asks for a sign-in." };
    const r = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (DBP app link check)", Accept: "*/*", ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    await r.body?.cancel();
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) return { status: "unknown", detail: `Redirect with no address (${r.status}).` };
      url = new URL(loc, url);
      continue;
    }
    if (r.status === 200) return { status: "public", detail: "Opens without signing in." };
    if (r.status === 401 || r.status === 403) return { status: "sign_in", detail: "SharePoint refuses it without a sign-in." };
    if (r.status === 404 || r.status === 410) return { status: "broken", detail: "The link doesn't lead to a document (not found)." };
    return { status: "unknown", detail: `SharePoint replied ${r.status}.` };
  }
  return { status: "unknown", detail: "Too many redirects." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const publicKey = req.headers.get("apikey") ?? "";
    if (!token || !publicKey) return reply({ ok: false, detail: "Sign in first." }, 401);
    const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data } = await asCaller.auth.getUser(token);
    if (!data?.user) return reply({ ok: false, detail: "Sign in first." }, 401);

    const { url } = await req.json().catch(() => ({ url: "" }));
    let u: URL;
    try {
      u = new URL(String(url));
    } catch {
      return reply({ ok: true, status: "broken", detail: "That isn't a web address." });
    }
    if (u.protocol !== "https:" || !ALLOWED(u.hostname)) return reply({ ok: true, status: "unknown", detail: "Only SharePoint / OneDrive links are checked." });
    return reply({ ok: true, ...(await check(u.toString())) });
  } catch (e) {
    return reply({ ok: true, status: "unknown", detail: e instanceof Error ? e.message : String(e) });
  }
});
