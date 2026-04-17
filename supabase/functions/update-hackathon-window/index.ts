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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
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
  // Confirm they are an admin.
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
  const startAt = String(payload?.start_at || "").trim();
  const endAt = String(payload?.end_at || "").trim();
  if (!startAt || !endAt) return json(400, {
    error: "start_at and end_at are required"
  });
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return json(400, {
      error: "Invalid start_at or end_at"
    });
  }
  if (endMs <= startMs) return json(400, {
    error: "end_at must be after start_at"
  });
  const { error: upErr } = await adminDb.from("hackathon_window").upsert({
    key: "default",
    start_at: new Date(startMs).toISOString(),
    end_at: new Date(endMs).toISOString(),
    updated_at: new Date().toISOString()
  }, {
    onConflict: "key"
  });
  if (upErr) return json(500, {
    error: "Failed to update window"
  });
  return json(200, {
    ok: true
  });
});
