import "jsr:@supabase/functions-js/edge-runtime.d.ts";
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
const getAuthToken = (req)=>{
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const token = getAuthToken(req);
  if (!token) return json(401, {
    error: "Missing bearer token"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("GH_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  // Validate token + get user (anon key)
  const anonClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  const { data: userData, error: userError } = await anonClient.auth.getUser();
  if (userError || !userData?.user?.id) {
    return json(401, {
      error: "Invalid token",
      details: userError?.message || ""
    });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  // Ensure requester is admin
  const { data: adminRow, error: adminError } = await supabase.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !adminRow) {
    return json(403, {
      error: "Admin access required"
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
  const fullName = (body.full_name || "").trim();
  if (!email || !fullName) return json(400, {
    error: "Email and full_name are required"
  });
  // Invite user via Admin API
  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
  if (inviteError || !inviteData?.user?.id) {
    return json(400, {
      error: "Invite failed",
      details: inviteError?.message || ""
    });
  }
  const userId = inviteData.user.id;
  // Insert into judges table
  const { data: judgeRow, error: judgeError } = await supabase.from("judges").insert({
    user_id: userId,
    full_name: fullName,
    email
  }).select("id, user_id, full_name, email").single();
  if (judgeError) {
    return json(400, {
      error: "Failed to create judge",
      details: judgeError.message
    });
  }
  return json(200, {
    ok: true,
    judge: judgeRow
  });
});
