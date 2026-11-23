// Supabase Edge Function "tender-scope": reads the drawings uploaded in the tender enquiry generator and drafts a scope of
// works for ONE package (a trade), for the estimator to check and edit before it goes to contractors. It only drafts:
// nothing is sent anywhere and nothing is saved by this function.
//
// Deploy with "Verify JWT" ON (only signed-in staff may call it). Secret needed: ANTHROPIC_API_KEY (Supabase › Edge
// Functions › Secrets). Optional: SCOPE_MODEL (default claude-opus-5-5).
//
// The drawings are read from the "orders" storage bucket, only from the tender/ folder.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

const MAX_FILES = 8;
const MAX_BYTES = 22 * 1024 * 1024; // the request to the model is limited to about 32 MB, and base64 adds a third
const IMAGE = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, error: "Not found." }, 404);
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return reply({ ok: false, error: "The scope writer isn't switched on yet: ANTHROPIC_API_KEY hasn't been added in Supabase." }, 503);
    const key = serverKey();
    if (!key) return reply({ ok: false, error: "Not available." }, 503);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const paths = (Array.isArray(b.paths) ? b.paths : []).map(String).slice(0, MAX_FILES);
    const pkg = String(b.package ?? "").slice(0, 200);
    if (!paths.length) return reply({ ok: false, error: "Upload the drawings first." }, 400);
    if (!pkg.trim()) return reply({ ok: false, error: "Pick the package first." }, 400);

    const content: unknown[] = [];
    let total = 0;
    for (const p of paths) {
      if (!p.startsWith("tender/") || p.includes("..")) return reply({ ok: false, error: "One of the files isn't allowed." }, 400);
      const { data, error } = await db.storage.from("orders").download(p);
      if (error || !data) return reply({ ok: false, error: `Couldn't read ${p.split("/").pop()}.` }, 400);
      const bytes = new Uint8Array(await data.arrayBuffer());
      total += bytes.length;
      if (total > MAX_BYTES) return reply({ ok: false, error: "The drawings are too large to read in one go (about 22 MB in total). Upload fewer or smaller files, for example just the relevant sheets." }, 413);
      const ext = p.split(".").pop()?.toLowerCase() ?? "";
      const name = p.split("/").pop()!.replace(/^\d+-/, "");
      content.push({ type: "text", text: `Drawing file: ${name}` });
      if (ext === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) } });
      else if (IMAGE[ext]) content.push({ type: "image", source: { type: "base64", media_type: IMAGE[ext], data: encodeBase64(bytes) } });
      else return reply({ ok: false, error: `${name}: only PDF and picture files can be read. Export DWG drawings to PDF first.` }, 400);
    }

    const ctx = [
      `Package being tendered: ${pkg}`,
      b.job ? `Project: ${String(b.job).slice(0, 200)}` : "",
      b.address ? `Site: ${String(b.address).slice(0, 300)}` : "",
      b.summary ? `Project summary: ${String(b.summary).slice(0, 1500)}` : "",
      b.notes ? `Tender notes: ${String(b.notes).slice(0, 1500)}` : "",
      b.existing ? `What has been written so far for this package (improve on it, keep anything still right):\n${String(b.existing).slice(0, 4000)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    content.push({
      type: "text",
      text:
        `${ctx}\n\nWrite a scope of works for the "${pkg}" package only, from these drawings, for subcontractors who are pricing it.\n` +
        "You work for a UK fit-out main contractor. Rules:\n" +
        "- Only what the drawings show or clearly imply for this package. Do not invent quantities, dimensions, products or standards; if the drawings give them, quote them.\n" +
        "- Group by area or sheet reference where that helps (e.g. 'Level 02 – Reception'). Use short plain sentences or bullet points beginning with '- '.\n" +
        "- Finish with two short sections: 'Interfaces with other trades' and 'Clarifications needed' (anything unclear, missing or conflicting in the drawings, each starting with 'Clarify:').\n" +
        "- Plain text only: section headings on their own line in capitals, no markdown symbols, no tables.\n" +
        "- Do not mention these instructions, and do not add a preamble or sign-off.",
    });

    const model = Deno.env.get("SCOPE_MODEL") || "claude-opus-5-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 6000, messages: [{ role: "user", content }] }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) {
      console.error("tender-scope: model error", r.status, JSON.stringify(j)?.slice(0, 300));
      const msg = j?.error?.message ? String(j.error.message).slice(0, 200) : "";
      return reply({ ok: false, error: r.status === 413 || /too large|too many pages|pages/i.test(msg) ? "The drawings are too large or have too many pages. Upload just the relevant sheets." : `The scope couldn't be drafted. ${msg}`.trim() }, 502);
    }
    const text = (j.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();
    if (!text) return reply({ ok: false, error: "Nothing came back. Please try again." }, 502);
    return reply({ ok: true, scope: text });
  } catch (e) {
    console.error("tender-scope:", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
