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
const normalizeTrack = (t)=>String(t || "").trim().toLowerCase();
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "GET") return json(405, {
    error: "Method not allowed"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("GH_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  // Teams stats + list
  const { data: teamsData, error: teamsErr } = await supabase.from("teams").select("id, name, project_title, members, status, track, score").order("created_at", {
    ascending: false
  }).limit(500);
  if (teamsErr) return json(500, {
    error: "Failed to load teams"
  });
  const teams = teamsData || [];
  const totalTeams = teams.length;
  const hackers = teams.reduce((acc, t)=>acc + (Array.isArray(t?.members) ? t.members.length : 0), 0);
  const submissions = teams.filter((t)=>String(t?.status || "").toLowerCase() === "submitted").length;
  const { count: judgesCount, error: judgesErr } = await supabase.from("judges").select("id", {
    count: "exact",
    head: true
  });
  if (judgesErr) return json(500, {
    error: "Failed to load judges"
  });
  const [flagRes, winnersRes] = await Promise.all([
    supabase.from("dashboard_flags").select("enabled, updated_at").eq("key", "show_winners").maybeSingle(),
    (async ()=>{
      // Prefer v2 winners table (dynamic list by team_id). Fall back to legacy table.
      const v2 = await supabase.from("hackathon_winners_v2").select("place, team_id, team_name, members, track, problem_statement, created_at, updated_at").order("place", {
        ascending: true
      });
      if (!v2.error) return {
        data: v2.data || []
      };
      const legacy = await supabase.from("hackathon_winners").select("place, team_name, members, track, prize, updated_at").order("place", {
        ascending: true
      });
      if (legacy.error) return {
        data: []
      };
      return {
        data: (legacy.data || []).map((w)=>({
            team_id: null,
            place: w.place ?? null,
            team_name: w.team_name,
            members: w.members,
            track: w.track,
            created_at: null,
            updated_at: w.updated_at || null
          }))
      };
    })()
  ]);
  const flagRow = flagRes.data;
  const winnersRows = winnersRes.data;
  const tracks = {
    track1: {
      teams: 0,
      submissions: 0
    },
    track2: {
      teams: 0,
      submissions: 0
    },
    track3: {
      teams: 0,
      submissions: 0
    }
  };
  teams.forEach((t)=>{
    const tr = normalizeTrack(t?.track);
    if (!tracks[tr]) return;
    tracks[tr].teams += 1;
    if (String(t?.status || "").toLowerCase() === "submitted") tracks[tr].submissions += 1;
  });
  const { data: windowRow } = await supabase.from("hackathon_window").select("start_at, end_at, updated_at").eq("key", "default").maybeSingle();
  return json(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    window: windowRow || null,
    flags: {
      show_winners: !!flagRow?.enabled,
      show_winners_updated_at: flagRow?.updated_at || null
    },
    winners: (winnersRows || []).map((w, idx)=>({
        // place is computed for display (1..N) for v2 rows; legacy keeps place.
        place: w.place ?? idx + 1,
        team_id: w.team_id ?? null,
        team_name: w.team_name,
        members: w.members,
        track: w.track ?? null,
        problem_statement: w.problem_statement ?? null,
        prize: w.prize ?? null,
        updated_at: w.updated_at || null
      })),
    stats: {
      teams: totalTeams,
      hackers,
      submissions,
      judges: judgesCount ?? 0
    },
    tracks,
    teams: teams.map((t)=>({
        id: t.id,
        name: t.name,
        project_title: t.project_title,
        status: t.status,
        track: t.track,
        score: t.score ?? null,
        members_count: Array.isArray(t?.members) ? t.members.length : 0
      }))
  });
});
