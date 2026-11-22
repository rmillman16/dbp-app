// Supabase Edge Function: admins (including IT's admin login) add, reset and switch off app logins from
// Settings › Users (22 Nov). Creating a login needs Supabase's service-role key, which must never be in the
// app; Supabase gives it to Edge Functions automatically (SUPABASE_SERVICE_ROLE_KEY), so nobody copies it
// anywhere. Every call checks that the person calling is an admin before doing anything.
//
// Actions (POST JSON):
//   { action: "list" }                                       → each login's last sign-in and whether it's switched off
//   { action: "create", email, full_name, roles? }           → a new login with a temporary password (shown once)
//   { action: "reset_password", user_id }                    → a new temporary password (shown once)
//   { action: "disable", user_id } / { action: "enable", user_id }
//                                                            → switch a login off / on. Off rather than deleted, so
//                                                              their name stays on what they did
// Admin itself is still only set in Supabase's SQL Editor.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (detail: string, status = 200) => reply({ ok: false, detail }, status);

const ROLES = ["project_manager", "commercial", "site_management", "design", "accounts", "external", "operations"];

// a temporary password that's easy to read out: Dbp-7KQM-X4TP-29 (no 0/O, 1/l/I)
function tempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (v) => chars[v % chars.length]).join("");
  return `Dbp-${pick(4)}-${pick(4)}-${pick(2)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return fail("The server key isn't available to this function.");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // who's calling, and are they an admin?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: caller } = await admin.auth.getUser(token);
    if (!caller?.user) return fail("Sign in first.", 401);
    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", caller.user.id).single();
    if (!me?.is_admin) return fail("Only admins can manage logins.", 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (action === "list") {
      const out: Record<string, { last_sign_in_at: string | null; disabled: boolean }> = {};
      for (let page = 1; page < 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return fail(error.message);
        for (const u of data.users)
          out[u.id] = { last_sign_in_at: u.last_sign_in_at ?? null, disabled: !!(u as { banned_until?: string }).banned_until && new Date((u as { banned_until?: string }).banned_until!) > new Date() };
        if (data.users.length < 200) break;
      }
      return reply({ ok: true, users: out });
    }

    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim();
      const roles = (Array.isArray(body.roles) ? body.roles : []).filter((r: unknown) => ROLES.includes(String(r)));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email address doesn't look right.");
      const password = tempPassword();
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName || email } });
      if (error) return fail(/already|registered|exists/i.test(error.message) ? "There's already a login for that email." : error.message);
      // the profile is made by the database as the login is created; add their name and types
      const { error: pErr } = await admin.from("profiles").update({ full_name: fullName || email, roles, is_operations: roles.includes("operations") }).eq("id", data.user.id);
      if (pErr) return reply({ ok: true, user_id: data.user.id, password, warning: `Login made, but the profile types weren't saved: ${pErr.message}` });
      return reply({ ok: true, user_id: data.user.id, password });
    }

    const userId = String(body.user_id ?? "");
    if (!userId) return fail("Which login?");

    if (action === "reset_password") {
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return fail(error.message);
      return reply({ ok: true, password });
    }

    if (action === "disable" || action === "enable") {
      if (action === "disable" && userId === caller.user.id) return fail("You can't switch off your own login.");
      // switched off for 100 years, or back on
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: action === "disable" ? "876000h" : "none" });
      if (error) return fail(error.message);
      return reply({ ok: true });
    }

    return fail("Unknown action.", 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
});
