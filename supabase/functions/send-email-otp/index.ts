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

// Brevo (Sendinblue) transactional email sender for OTPs.
const parseFrom = (from)=>{
  const v = String(from || "").trim();
  const m = v.match(/^(.*)<([^>]+)>$/);
  if (!m) return { name: "", email: v };
  return { name: m[1].trim().replace(/^"|"$/g, ""), email: m[2].trim() };
};

const sendViaBrevo = async ({ apiKey, from, to, subject, text })=>{
  const sender = parseFrom(from);
  const payload = {
    sender: sender.name ? { name: sender.name, email: sender.email } : { email: sender.email },
    to: [
      { email: to }
    ],
    subject,
    textContent: text
  };
  return await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  const token = getAuthToken(req);
  if (!token) return json(401, {
    error: "Missing bearer token"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("GH_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const brevoKey = Deno.env.get("BREVO_API_KEY");
  const brevoFrom = Deno.env.get("BREVO_FROM_EMAIL");
  const ttlMinutes = Number(Deno.env.get("OTP_TTL_MINUTES") || "10");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, {
      error: "Missing required environment variables"
    });
  }
  if (!brevoKey || !brevoFrom) {
    return json(500, {
      error: "Missing required email environment variables"
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
  const subject = "Your login code";
  const text = `Your login code is ${otp}. It expires in ${ttlMinutes} minutes.`;
  const emailRes = await sendViaBrevo({
    apiKey: brevoKey,
    from: brevoFrom,
    to: email,
    subject,
    text
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
