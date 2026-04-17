import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const json = (status, body)=>new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
const pickAnonKey = ()=>Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("ANON_KEY") || "";
function isValidMembers(m) {
  if (m === null || m === undefined) return true;
  if (!Array.isArray(m)) return false;
  for (const item of m){
    if (typeof item !== "object" || item === null) return false;
    const name = item.name;
    const email = item.email;
    if (name !== undefined && typeof name !== "string") return false;
    if (email !== undefined && typeof email !== "string") return false;
  }
  return true;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("GH_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const anonKey = pickAnonKey();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, {
    error: "Missing Authorization header"
  });
  // Validate user session via anon key + JWT.
  const authed = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: u, error: uErr } = await authed.auth.getUser();
  if (uErr || !u?.user) return json(401, {
    error: "Unauthorized"
  });
  // Confirm admin via admin_users table.
  const adminDb = createClient(supabaseUrl, serviceRoleKey);
  const { data: adminRow, error: adminErr } = await adminDb.from("admin_users").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (adminErr || !adminRow) return json(403, {
    error: "Admin access required"
  });
  let payload = null;
  try {
    payload = await req.json();
  } catch  {
    return json(400, {
      error: "Invalid JSON body"
    });
  }
  const enabled = !!payload?.enabled;
  const winners = Array.isArray(payload?.winners) ? payload.winners : [];
  const nowIso = new Date().toISOString();
  const isV2 = winners.some((w)=>!!String(w?.team_id || "").trim());
  // Validation (v2: team_id list; legacy: place + team_name).
  const places = new Set();
  const teamIds = new Set();
  for (const w of winners){
    const tid = String(w?.team_id || "").trim();
    if (isV2) {
      if (!tid) return json(400, {
        error: "team_id is required"
      });
      if (teamIds.has(tid)) return json(400, {
        error: "Duplicate winner team_id"
      });
      teamIds.add(tid);
      const place = Number(w?.place);
      if (!Number.isFinite(place) || place < 1 || place > 1000) return json(400, {
        error: "place is required for each winner"
      });
      if (places.has(place)) return json(400, {
        error: "Duplicate winner place"
      });
      places.add(place);
      continue;
    }
    const place = Number(w?.place);
    const team = String(w?.team_name || "").trim();
    if (!Number.isFinite(place) || place < 1 || place > 10) {
      return json(400, {
        error: "Invalid winner place"
      });
    }
    if (!team) return json(400, {
      error: "Winner team_name is required"
    });
    if (places.has(place)) return json(400, {
      error: "Duplicate winner place"
    });
    places.add(place);
    if (!isValidMembers(w?.members)) return json(400, {
      error: "Invalid members format"
    });
  }
  const { error: flagErr } = await adminDb.from("dashboard_flags").upsert({
    key: "show_winners",
    enabled,
    updated_at: nowIso
  }, {
    onConflict: "key"
  });
  if (flagErr) return json(500, {
    error: "Failed to update flag",
    details: flagErr.message
  });
  // If winners are disabled, clear any winners data and return early.
  // This avoids failing on stale/removed team_id values when the admin is simply hiding winners.
  if (!enabled) {
    const [delV2, delLegacy] = await Promise.all([
      adminDb.from("hackathon_winners_v2").delete().neq("id", "00000000-0000-0000-0000-000000000000"),
      adminDb.from("hackathon_winners").delete().neq("place", -1)
    ]);
    // If one of the tables doesn't exist in this project, Supabase returns an error.
    // We ignore that because clearing "the other" table still satisfies the hide action.
    // We only hard-fail if both deletes fail.
    if (delV2.error && delLegacy.error) {
      return json(500, {
        error: "Failed to clear winners",
        details: delV2.error.message || delLegacy.error.message
      });
    }
    return json(200, {
      ok: true
    });
  }
  if (isV2) {
    // Replace winners list (v2).
    const { error: delErr } = await adminDb.from("hackathon_winners_v2").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (delErr) return json(500, {
      error: "Failed to clear winners",
      details: delErr.message
    });
    if (winners.length) {
      const entries = winners.map((w)=>({
          id: String(w.team_id).trim(),
          place: Number(w.place)
        }));
      const ids = entries.map((e)=>e.id);
      const { data: tRows, error: tErr } = await adminDb.from("teams").select("id, name, members, track, project_title").in("id", ids);
      if (tErr) return json(500, {
        error: "Failed to load teams for winners",
        details: tErr.message
      });
      const byId = new Map((tRows || []).map((t)=>[
          String(t.id),
          t
        ]));
      const rows = entries.sort((a, b)=>a.place - b.place).map((e)=>{
        const t = byId.get(String(e.id));
        if (!t) return null;
        return {
          place: e.place,
          team_id: t.id,
          team_name: t.name,
          members: Array.isArray(t.members) ? t.members : [],
          track: t.track ?? null,
          problem_statement: t.project_title ?? null,
          updated_at: nowIso
        };
      }).filter(Boolean);
      if (rows.length !== ids.length) return json(400, {
        error: "One or more team_id values not found"
      });
      const { error: insErr } = await adminDb.from("hackathon_winners_v2").insert(rows);
      if (insErr) return json(500, {
        error: "Failed to save winners",
        details: insErr.message
      });
    }
  } else {
    // Replace winners list (legacy).
    const { error: delErr } = await adminDb.from("hackathon_winners").delete().neq("place", -1);
    if (delErr) return json(500, {
      error: "Failed to clear winners",
      details: delErr.message
    });
    if (winners.length) {
      const rows = winners.map((w)=>({
          place: Number(w.place),
          team_name: String(w.team_name).trim(),
          members: Array.isArray(w.members) ? w.members : [],
          track: w.track ? String(w.track).trim() : null,
          prize: w.prize ? String(w.prize).trim() : null,
          updated_at: nowIso
        }));
      const { error: insErr } = await adminDb.from("hackathon_winners").insert(rows);
      if (insErr) return json(500, {
        error: "Failed to save winners",
        details: insErr.message
      });
    }
  }
  return json(200, {
    ok: true
  });
});
