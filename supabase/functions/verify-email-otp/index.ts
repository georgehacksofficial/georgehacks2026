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
const getAuthToken = (req)=>{
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
};
const sha256Hex = async (input)=>{
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2, "0")).join("");
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  const token = getAuthToken(req);
  if (!token) return json(401, {
    error: "Missing bearer token"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const maxAttempts = Number(Deno.env.get("OTP_MAX_ATTEMPTS") || "5");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: serviceRoleKey
    }
  });
  if (!authRes.ok) {
    const errText = await authRes.text();
    return json(401, {
      error: "Invalid token",
      details: errText
    });
  }
  const userData = await authRes.json();
  if (!userData?.id) return json(401, {
    error: "Invalid token"
  });
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const email = userData.email;
  if (!email) return json(400, {
    error: "User email not available"
  });
  let body = {};
  try {
    body = await req.json();
  } catch (_) {
    return json(400, {
      error: "Invalid JSON body"
    });
  }
  const otp = (body.otp || "").trim();
  if (!otp) return json(400, {
    error: "OTP is required"
  });
  const { data: row, error: rowError } = await supabase.from("login_otps").select("id, otp_hash, expires_at, attempts, verified").eq("email", email).maybeSingle();
  if (rowError || !row) return json(400, {
    error: "No OTP found"
  });
  if (row.verified) return json(400, {
    error: "OTP already used"
  });
  const now = Date.now();
  const exp = new Date(row.expires_at).getTime();
  if (!Number.isFinite(exp) || exp < now) {
    await supabase.from("login_otps").delete().eq("id", row.id);
    return json(400, {
      error: "OTP expired"
    });
  }
  if (row.attempts >= maxAttempts) {
    return json(400, {
      error: "Too many attempts"
    });
  }
  const otpHash = await sha256Hex(`${otp}:${email.toLowerCase()}`);
  if (otpHash !== row.otp_hash) {
    await supabase.from("login_otps").update({
      attempts: row.attempts + 1
    }).eq("id", row.id);
    return json(400, {
      error: "Invalid OTP"
    });
  }
  const { error: verifyError } = await supabase.from("login_otps").update({
    verified: true
  }).eq("id", row.id);
  if (verifyError) return json(500, {
    error: "Failed to verify OTP"
  });
  return json(200, {
    ok: true
  });
});
