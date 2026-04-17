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
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const ttlMinutes = Number(Deno.env.get("OTP_TTL_MINUTES") || "10");
  if (!supabaseUrl || !serviceRoleKey || !resendKey || !resendFrom) {
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
  const rng = new Uint32Array(1);
  crypto.getRandomValues(rng);
  const otp = (rng[0] % 900000 + 100000).toString();
  const otpHash = await sha256Hex(`${otp}:${email.toLowerCase()}`);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const { error: upsertError } = await supabase.from("login_otps").upsert({
    user_id: userData.id,
    email,
    otp_hash: otpHash,
    expires_at: expiresAt,
    attempts: 0,
    verified: false,
    created_at: new Date().toISOString()
  }, {
    onConflict: "email"
  });
  if (upsertError) return json(500, {
    error: "Failed to store OTP"
  });
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: resendFrom,
      to: email,
      subject: "Your login code",
      text: `Your login code is ${otp}. It expires in ${ttlMinutes} minutes.`
    })
  });
  if (!emailRes.ok) {
    const errText = await emailRes.text();
    return json(502, {
      error: "Failed to send email",
      details: errText
    });
  }
  return json(200, {
    ok: true
  });
});
