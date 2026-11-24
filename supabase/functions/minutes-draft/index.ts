// Supabase Edge Function "minutes-draft": turns rough notes, or a pasted Teams / Zoom transcript, into a first draft of the minutes:
// headings, points, and the actions with owners and due dates. It only drafts: nothing is saved here, and the person reviews the
// draft in the app, ticks what they want and adds it to the minutes themselves.
//
// Deploy with "Verify JWT" ON (only signed-in staff may call it). Secret needed: ANTHROPIC_API_KEY (the same one as tender-scope;
// Supabase › Edge Functions › Secrets). Optional: MINUTES_MODEL (default claude-opus-5-5).
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You turn rough notes or a transcript of a UK construction project meeting into draft minutes.

Return ONLY a JSON object, no other text, in this shape:
{"points":[{"type":"heading"|"note","text":string,"action":boolean,"owner":string|null,"due":string|null,"urgent":boolean}]}

Rules:
- British English, plain professional wording, third person, past or present tense as the minutes would be written. One point per decision, matter or instruction. Leave out small talk, repetition and anything not about the project.
- Do not invent anything: no names, dates, figures, prices or decisions that are not in the text. If something is unclear, write it as it was said or leave it out.
- "heading" points group the notes under them, in the order the meeting covered them. If a list of standing headings is given, use those exact headings, in that order, where the discussion fits them, and add a short heading of your own only for something that fits none. Put a point after the heading it belongs to.
- "note" points are the content. Set "action" true only when somebody has to do something; then set "owner" to the INITIALS of the attendee who has to do it (from the attendee list), or null if it is unclear or the person is not in the list. Refer to attendees in the text as @INITIALS (for example "@AK to confirm the door schedule"). Do not repeat the owner in a separate sentence.
- "due" is a date as YYYY-MM-DD when a date or a day was given ("by Friday", "next week", "end of the month"); work it out from the meeting date. Otherwise null.
- "urgent" is true only if it was said to be urgent or critical.
- Headings have action false, owner null, due null, urgent false.
- No more than 120 points.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, error: "Not found." }, 404);
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return reply({ ok: false, error: "The minutes writer isn't switched on yet: ANTHROPIC_API_KEY hasn't been added in Supabase." }, 503);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(b.text ?? "").slice(0, 80000);
    if (text.trim().length < 20) return reply({ ok: false, error: "Paste the notes or the transcript first." }, 400);
    const attendees = (Array.isArray(b.attendees) ? b.attendees : []).slice(0, 60) as { initials?: string; name?: string; company?: string }[];
    const headings = (Array.isArray(b.headings) ? b.headings : []).map((h) => String(h).slice(0, 120)).slice(0, 30);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? "")) ? String(b.date) : new Date().toISOString().slice(0, 10);
    const day = new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

    const ctx = [
      b.project ? `Project: ${String(b.project).slice(0, 200)}` : "",
      `Meeting date: ${date} (${day})`,
      attendees.length ? `Attendees (initials = name, company):\n${attendees.map((a) => `${String(a.initials ?? "").slice(0, 8)} = ${String(a.name ?? "").slice(0, 80)}${a.company ? `, ${String(a.company).slice(0, 80)}` : ""}`).join("\n")}` : "No attendee list was given: set every owner to null.",
      headings.length ? `Standing headings:\n${headings.map((h) => `- ${h}`).join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const client = new Anthropic({ apiKey });
    const model = Deno.env.get("MINUTES_MODEL") || "claude-opus-5-5";
    let msg;
    try {
      msg = await client.messages.create({ model, max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: `${ctx}\n\nNotes / transcript:\n"""\n${text}\n"""` }] });
    } catch (e) {
      console.error("minutes-draft: model error", e instanceof Error ? e.message : e);
      return reply({ ok: false, error: "The draft couldn't be written just now. Please try again." }, 502);
    }
    const raw = msg.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("\n");
    const from = raw.indexOf("{");
    const to = raw.lastIndexOf("}");
    let parsed: { points?: unknown } | null = null;
    try {
      parsed = from >= 0 && to > from ? JSON.parse(raw.slice(from, to + 1)) : null;
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.points)) return reply({ ok: false, error: "The draft didn't come back in a usable form. Please try again." }, 502);

    const initialsOk = new Set(attendees.map((a) => String(a.initials ?? "").toUpperCase()));
    const points = (parsed.points as Record<string, unknown>[])
      .slice(0, 120)
      .map((p) => {
        const heading = p.type === "heading";
        const owner = !heading && p.owner ? String(p.owner).replace(/^@/, "").toUpperCase() : null;
        return {
          type: heading ? "heading" : "note",
          text: String(p.text ?? "").trim().slice(0, 1500),
          action: !heading && p.action === true,
          owner: owner && initialsOk.has(owner) ? owner : null,
          due: !heading && /^\d{4}-\d{2}-\d{2}$/.test(String(p.due ?? "")) ? String(p.due) : null,
          urgent: !heading && p.urgent === true,
        };
      })
      .filter((p) => p.text);
    if (!points.length) return reply({ ok: false, error: "Nothing usable was found in that text." }, 422);
    return reply({ ok: true, points });
  } catch (e) {
    console.error("minutes-draft:", e instanceof Error ? e.message : e);
    return reply({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
