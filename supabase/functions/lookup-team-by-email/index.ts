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
const looksLikeEmail = (email)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  let body = {};
  try {
    body = await req.json();
  } catch (_) {
    return json(400, {
      error: "Invalid JSON body"
    });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!email || !looksLikeEmail(email)) return json(400, {
    error: "Valid email is required"
  });
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  // Use an explicit JSON string for the `cs` (contains) filter to avoid
  // PostgREST JSON parsing issues in some environments.
  const membersNeedle = JSON.stringify([
    {
      email
    }
  ]);
  const { data, error } = await supabase.from("teams").select("id, name, project_title, members").filter("members", "cs", membersNeedle).order("created_at", {
    ascending: false
  }).limit(1);
  if (error) return json(500, {
    error: "Lookup failed",
    details: error.message
  });
  const team = (data || [])[0] || null;
  if (!team) {
    // Fallback: scan recent teams and compare emails in JS.
    // This handles cases where stored member emails have casing/spacing differences
    // or where PostgREST JSON containment doesn't match as expected.
    const { data: allTeams, error: allErr } = await supabase.from("teams").select("id, name, project_title, members").order("created_at", {
      ascending: false
    }).limit(1000);
    if (allErr) return json(500, {
      error: "Lookup failed",
      details: allErr.message
    });
    const normalize = (v)=>String(v || "").trim().toLowerCase();
    const target = normalize(email);
    const found = (allTeams || []).find((t)=>{
      const mem = Array.isArray(t?.members) ? t.members : [];
      return mem.some((m)=>normalize(m?.email) === target);
    }) || null;
    if (!found) return json(200, {
      found: false
    });
    return json(200, {
      found: true,
      team: {
        id: found.id,
        name: found.name,
        project_title: found.project_title,
        members: Array.isArray(found.members) ? found.members : []
      }
    });
  }
  return json(200, {
    found: true,
    team: {
      id: team.id,
      name: team.name,
      project_title: team.project_title,
      members: Array.isArray(team.members) ? team.members : []
    }
  });
});
