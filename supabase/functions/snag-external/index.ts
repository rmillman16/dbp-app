// Supabase Edge Function "snag-external": the ONLY way a trades person reaches their snags (script 070). They have no login and no
// database access: this function checks the private link (https://<app>/s/<token>) and returns just their own company's snags
// on that one job. Deploy with "Verify JWT" OFF (they have no Supabase sign-in); it does its own checks.
//
// What they can do: see their snags and the photos, tick a snag as done with an optional note and photos as proof, and take that
// tick back. Nothing else exists here: no other jobs, companies, people or documents. The approver is then asked to check it.
//
// The link is made by DBP (issue_snag_link): the token is random, only its hash is stored, it expires, and DBP can withdraw it.
// Secrets: the server key is automatic.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
class Fail extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
// deno-lint-ignore no-explicit-any
type DB = any;
function serverKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const k = keys.default ?? Object.values(keys)[0];
      if (k) return k;
    } catch {
      /* fall through */
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const rand = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, "0")).join("");
const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;
const UUID = /^[0-9a-f-]{36}$/;
// pictures only (a phone photo), plus a PDF
const ALLOWED = new Set(["jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "pdf"]);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function limit(db: DB, kind: string, key: string, max: number, minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await db.from("external_attempts").select("id", { count: "exact", head: true }).eq("kind", kind).eq("key", key).gte("at", since);
  if ((count ?? 0) >= max) throw new Fail(429, "Too many attempts. Please wait a while and try again.");
  await db.from("external_attempts").insert({ kind, key });
}

interface Ctx {
  linkId: string;
  jobId: string;
  companyId: string;
  company: string;
}
async function byToken(db: DB, token: string, ip: string): Promise<Ctx> {
  if (!TOKEN.test(token)) {
    await limit(db, "badtoken", ip, 30, 60);
    throw new Fail(404, "This link isn't valid. Please copy the whole link, or ask du Boulay Projects for a new one.");
  }
  const { data: l, error } = await db.from("snag_links").select("id, job_id, company_id, expires_at, revoked_at, use_count").eq("token_hash", await sha256(token)).maybeSingle();
  if (error) {
    console.error("snag-external: link lookup failed:", error.message);
    throw new Fail(500, "The server couldn't check this link. Please try again.");
  }
  if (!l) {
    await limit(db, "badtoken", ip, 30, 60);
    throw new Fail(404, "This link isn't valid. Please copy the whole link, or ask du Boulay Projects for a new one.");
  }
  if (l.revoked_at) throw new Fail(410, "This link has been withdrawn. Please ask du Boulay Projects for a new one.");
  if (new Date(l.expires_at) < new Date()) throw new Fail(410, "This link has expired. Please ask du Boulay Projects for a new one.");
  const { data: co } = await db.from("companies").select("name").eq("id", l.company_id).maybeSingle();
  await db.from("snag_links").update({ last_used_at: new Date().toISOString(), use_count: (l.use_count ?? 0) + 1 }).eq("id", l.id);
  return { linkId: l.id, jobId: l.job_id, companyId: l.company_id, company: co?.name ?? "Your company" };
}

// the directory entries that belong to this company on this job
async function dirIds(db: DB, ctx: Ctx): Promise<string[]> {
  const { data } = await db.from("job_directory").select("id").eq("job_id", ctx.jobId).eq("company_id", ctx.companyId);
  return (data ?? []).map((d: { id: string }) => d.id);
}
// one snag, only if it is theirs
async function mySnag(db: DB, ctx: Ctx, id: string) {
  if (!UUID.test(id)) throw new Fail(404, "That snag isn't available to you.");
  const ids = await dirIds(db, ctx);
  const { data: s } = await db.from("snags").select("id, number, title, status, location, marked_done_at, assignee_id").eq("id", id).eq("job_id", ctx.jobId).maybeSingle();
  if (!s || !s.assignee_id || !ids.includes(s.assignee_id)) throw new Fail(404, "That snag isn't available to you.");
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, error: "Not found." }, 404);
  try {
    const key = serverKey();
    if (!key) return reply({ ok: false, error: "Not available." }, 503);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(b.action ?? "");
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const ctx = await byToken(db, String(b.token ?? ""), ip);

    if (action === "list") {
      const ids = await dirIds(db, ctx);
      const { data: job } = await db.from("jobs").select("name, job_no, code, site_address, hub_url").eq("id", ctx.jobId).maybeSingle();
      const { data: rows } = ids.length
        ? await db.from("snags").select("id, number, title, description, location, status, trade, marked_done_at, done_note, created_at, completed_at").eq("job_id", ctx.jobId).in("assignee_id", ids).order("number")
        : { data: [] };
      const snagIds = (rows ?? []).map((r: { id: string }) => r.id);
      const { data: files } = snagIds.length ? await db.from("snag_files").select("id, snag_id, kind, name").in("snag_id", snagIds).order("created_at") : { data: [] };
      return reply({
        ok: true,
        company: ctx.company,
        job: { name: job?.name ?? "", ref: `${job?.job_no ?? ""} ${job?.code ?? ""}`.trim(), address: job?.site_address ?? "", hub_url: job?.hub_url ?? null },
        snags: (rows ?? []).map((r: { id: string; number: number }) => ({
          ...r,
          ref: `${job?.job_no ?? ""}_${job?.code ?? ""}_SNAG_${String(r.number).padStart(3, "0")}`,
          photos: (files ?? []).filter((f: { snag_id: string; kind: string }) => f.snag_id === r.id && f.kind === "raised").map((f: { id: string; name: string }) => ({ id: f.id, name: f.name })),
          proof: (files ?? []).filter((f: { snag_id: string; kind: string }) => f.snag_id === r.id && f.kind === "proof").map((f: { id: string; name: string }) => ({ id: f.id, name: f.name })),
        })),
      });
    }

    if (action === "file_url") {
      const fid = String(b.file_id ?? "");
      if (!UUID.test(fid)) throw new Fail(404, "File not found.");
      const { data: f } = await db.from("snag_files").select("path, name, snag_id").eq("id", fid).maybeSingle();
      if (!f) throw new Fail(404, "File not found.");
      await mySnag(db, ctx, f.snag_id);
      const s = await db.storage.from("snags").createSignedUrl(f.path, 600);
      if (s.error) throw new Fail(500, "Couldn't open that picture.");
      return reply({ ok: true, url: s.data.signedUrl });
    }

    if (action === "upload_url") {
      const snag = await mySnag(db, ctx, String(b.snag_id ?? ""));
      if (snag.status !== "incomplete") throw new Fail(403, "This snag is already complete.");
      await limit(db, "snag-upload", ctx.linkId, 60, 60);
      const filename = String(b.filename ?? "").slice(0, 200);
      const ext = filename.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED.has(ext)) throw new Fail(400, "Only pictures (and PDFs) can be added.");
      const safe = filename.replace(/[^\w.\- ()]+/g, "_");
      const path = `${snag.id}/ext-${Date.now()}-${rand(4)}-${safe}`;
      const s = await db.storage.from("snags").createSignedUploadUrl(path);
      if (s.error) throw new Fail(500, "Couldn't start the upload.");
      return reply({ ok: true, path, url: s.data.signedUrl });
    }

    if (action === "mark_done") {
      const snag = await mySnag(db, ctx, String(b.snag_id ?? ""));
      if (snag.status !== "incomplete") throw new Fail(409, "This snag is already complete.");
      await limit(db, "snag-done", ctx.linkId, 200, 60);
      const note = String(b.note ?? "").trim().slice(0, 1000);
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 6) as { path?: string; name?: string }[];
      const proof: { path: string; name: string }[] = [];
      for (const f of files) {
        const path = String(f?.path ?? "");
        const name = String(f?.name ?? "").slice(0, 200);
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (!path.startsWith(`${snag.id}/ext-`) || path.includes("..") || !name || !ALLOWED.has(ext)) throw new Fail(400, "One of the pictures isn't allowed.");
        proof.push({ path, name });
      }
      const up = await db.from("snags").update({ marked_done_at: new Date().toISOString(), marked_done_by: ctx.company, done_note: note || null }).eq("id", snag.id).eq("status", "incomplete");
      if (up.error) throw new Fail(500, "Couldn't save that. Please try again.");
      for (const f of proof) await db.from("snag_files").insert({ snag_id: snag.id, kind: "proof", name: f.name, path: f.path, uploaded_by: null });
      await db.from("external_events").insert({ email: null, action: "snag_done", item_kind: "snag", item_id: snag.id, ip_hash: (await sha256(ip)).slice(0, 16) });
      return reply({ ok: true });
    }

    if (action === "undo") {
      // they ticked the wrong one: take the tick back, as long as the approver hasn't completed it
      const snag = await mySnag(db, ctx, String(b.snag_id ?? ""));
      if (snag.status !== "incomplete") throw new Fail(409, "This snag has already been checked.");
      await db.from("snags").update({ marked_done_at: null, marked_done_by: null, done_note: null }).eq("id", snag.id).eq("status", "incomplete");
      await db.from("snag_files").delete().eq("snag_id", snag.id).eq("kind", "proof").is("uploaded_by", null);
      return reply({ ok: true });
    }

    return reply({ ok: false, error: esc("Not found.") }, 404);
  } catch (e) {
    if (e instanceof Fail) return reply({ ok: false, error: e.message }, e.status);
    console.error("snag-external:", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
