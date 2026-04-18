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

// Normalize GW student aliases: treat @gwmail.gwu.edu as @gwu.edu to prevent duplicates.
const normalizeEmail = (email)=>{
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return raw;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain === "gwmail.gwu.edu") return `${local}@gwu.edu`;
  return raw;
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
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
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
  let body = {};
  try {
    body = await req.json();
  } catch (_) {
    return json(400, {
      error: "Invalid JSON body"
    });
  }
  const emailRaw = (body.email || "").trim().toLowerCase();
  const email = normalizeEmail(emailRaw);
  if (!emailRaw || !looksLikeEmail(emailRaw)) return json(400, {
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
  const subject = "Your team registration code";
  const text = `Your team registration code is ${otp}. It expires in ${ttlMinutes} minutes.`;
  // Send to what the user entered, but store/look up by normalized email.
  const emailRes = await sendViaBrevo({
    apiKey: brevoKey,
    from: brevoFrom,
    to: emailRaw,
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
