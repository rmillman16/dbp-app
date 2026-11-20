// Supabase Edge Function: read a PDF (supplier quote, schedule of works, subcontractor
// application) with Claude and return its priced lines for the app to check.
//
// Needs the secret ANTHROPIC_API_KEY (Supabase › Edge Functions › Secrets). Optional
// ANTHROPIC_MODEL to use a cheaper model (default claude-opus-5-5).
// If there's no key, no credit, or Claude can't read the file, it says why and the app
// asks for the Excel version instead. Only signed-in users can call it (Supabase checks
// the sign-in token before this code runs).
import Anthropic from "npm:@anthropic-ai/sdk@1.11.0";
import { z } from "npm:zod@4.6.7";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.11.0/helpers/zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// why it couldn't read the PDF; the app shows a matching message
type Failure = "not_configured" | "no_credit" | "busy" | "too_large" | "unreadable" | "failed";
const fail = (reason: Failure, detail: string, status = 200) =>
  new Response(JSON.stringify({ ok: false, reason, detail }), { status, headers: { ...cors, "Content-Type": "application/json" } });

const Line = z.object({
  section: z.string().nullable().describe("Section or trade heading the line sits under, if any"),
  heading: z.string().nullable().describe("Short bold lead-in for the line, e.g. 'Waterproofing', if the document has one"),
  description: z.string(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  rate: z.number().nullable().describe("£ rate excluding VAT"),
  total: z.number().nullable().describe("£ line total excluding VAT; null when the document shows text such as FOC, Excl or Incl"),
  note: z.string().nullable().describe("Any text shown instead of a figure (FOC, Excl, Provisional sum…)"),
});
const Result = z.object({
  document_type: z.string().describe("e.g. quotation, schedule of works, payment application"),
  supplier: z.string().nullable(),
  lines: z.array(Line),
  document_total: z.number().nullable().describe("The document's own total excluding VAT, if stated"),
  warnings: z.array(z.string()).describe("Anything unclear: illegible figures, totals that don't add up, pages that couldn't be read"),
});

const PROMPT = `This PDF is a construction pricing document for du Boulay Projects, a London fit-out contractor: a supplier or subcontractor quotation, a schedule of works, or a payment application.

Extract every priced line, in the order shown. Rules:
- Money in £ as plain numbers, excluding VAT. Do not invent or calculate figures that aren't shown, except rate × quantity when only one of rate or total is missing and the other two are clear.
- Where the document shows text instead of a figure (FOC, Excl, Incl, TBC), leave total null and put that text in note.
- Keep section or trade headings in "section"; don't output headings as lines themselves.
- Skip subtotal, VAT and grand total rows as lines, but put the document's own total excluding VAT in document_total.
- List anything unclear in warnings rather than guessing.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return fail("not_configured", "PDF reading isn't switched on (no Anthropic key in Supabase).");

  let pdf: string;
  try {
    pdf = (await req.json()).pdf;
  } catch {
    return fail("failed", "No PDF received.", 400);
  }
  if (!pdf || typeof pdf !== "string") return fail("failed", "No PDF received.", 400);
  if (pdf.length > 30_000_000) return fail("too_large", "That PDF is too large to read (over about 20 MB).");

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.parse({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-5-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(Result) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return fail("unreadable", "Claude couldn't read the pricing from this PDF.");
    }
    return new Response(JSON.stringify({ ok: true, ...response.parsed_output, usage: response.usage }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    // most specific first; 402 = no credit left on the Anthropic account
    if (error instanceof Anthropic.AuthenticationError) return fail("not_configured", "The Anthropic key in Supabase isn't valid.");
    if (error instanceof Anthropic.RateLimitError) return fail("busy", "PDF reading is busy; try again in a minute.");
    if (error instanceof Anthropic.APIError && error.status === 402) return fail("no_credit", "The Anthropic account has run out of credit.");
    if (error instanceof Anthropic.BadRequestError) return fail("unreadable", error.message);
    if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) return fail("busy", "Anthropic's service is unavailable; try again shortly.");
    return fail("failed", error instanceof Error ? error.message : String(error));
  }
});
