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
const sha256Hex = async (input)=>{
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2, "0")).join("");
};
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
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM_EMAIL");
  const ttlMinutes = Number(Deno.env.get("OTP_TTL_MINUTES") || "10");
  if (!supabaseUrl || !serviceRoleKey || !resendKey || !resendFrom) {
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
  // Basic throttle: 1 OTP per 30 seconds per email
  const { data: existing } = await supabase.from("team_registration_otps").select("last_sent_at").eq("email", email).maybeSingle();
  if (existing?.last_sent_at) {
    const last = new Date(existing.last_sent_at).getTime();
    if (Number.isFinite(last) && Date.now() - last < 30_000) {
      return json(429, {
        error: "Please wait before requesting another OTP."
      });
    }
  }
  const rng = new Uint32Array(1);
  crypto.getRandomValues(rng);
  const otp = (rng[0] % 900000 + 100000).toString();
  const otpHash = await sha256Hex(`${otp}:${email}`);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const { error: upsertError } = await supabase.from("team_registration_otps").upsert({
    email,
    otp_hash: otpHash,
    expires_at: expiresAt,
    attempts: 0,
    verified: false,
    last_sent_at: nowIso,
    created_at: nowIso,
    verified_at: null
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
      subject: "Your team registration code",
      text: `Your team registration code is ${otp}. It expires in ${ttlMinutes} minutes.`
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
