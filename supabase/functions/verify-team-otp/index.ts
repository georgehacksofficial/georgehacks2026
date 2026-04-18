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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json(405, {
    error: "Method not allowed"
  });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("GH_SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const maxAttempts = Number(Deno.env.get("OTP_MAX_ATTEMPTS") || "5");
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
  const emailRaw = (body.email || "").trim().toLowerCase();
  const email = normalizeEmail(emailRaw);
  const otp = (body.otp || "").trim();
  if (!emailRaw || !looksLikeEmail(emailRaw)) return json(400, {
    error: "Valid email is required"
  });
  if (!otp) return json(400, {
    error: "OTP is required"
  });
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: row, error: rowError } = await supabase.from("team_registration_otps").select("email, otp_hash, expires_at, attempts, verified").eq("email", email).maybeSingle();
  if (rowError || !row) return json(400, {
    error: "No OTP found"
  });
  if (row.verified) return json(400, {
    error: "OTP already used"
  });
  const exp = new Date(row.expires_at).getTime();
  if (!Number.isFinite(exp) || exp < Date.now()) {
    await supabase.from("team_registration_otps").delete().eq("email", email);
    return json(400, {
      error: "OTP expired"
    });
  }
  if ((row.attempts || 0) >= maxAttempts) {
    return json(400, {
      error: "Too many attempts"
    });
  }
  const otpHash = await sha256Hex(`${otp}:${email}`);
  if (otpHash !== row.otp_hash) {
    await supabase.from("team_registration_otps").update({
      attempts: (row.attempts || 0) + 1
    }).eq("email", email);
    return json(400, {
      error: "Invalid OTP"
    });
  }
  const { error: verifyError } = await supabase.from("team_registration_otps").update({
    verified: true,
    verified_at: new Date().toISOString()
  }).eq("email", email);
  if (verifyError) return json(500, {
    error: "Failed to verify OTP"
  });
  return json(200, {
    ok: true
  });
});
