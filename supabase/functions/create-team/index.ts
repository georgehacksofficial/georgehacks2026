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
  const teamName = (body.team_name || "").trim();
  const projectName = (body.project_name || "").trim();
  const track = (body.track || "").trim();
  const members = Array.isArray(body.members) ? body.members : [];
  if (!email || !looksLikeEmail(email)) return json(400, {
    error: "Valid email is required"
  });
  if (!teamName || !projectName) return json(400, {
    error: "team_name and project_name are required"
  });
  if (!track) return json(400, {
    error: "track is required"
  });
  if (![
    "track1",
    "track2",
    "track3"
  ].includes(track)) return json(400, {
    error: "Invalid track"
  });
  const safeMembers = members.map((m)=>({
      name: (m?.name || "").trim(),
      email: (m?.email || "").trim().toLowerCase()
    })).filter((m)=>m.name && m.email && looksLikeEmail(m.email));
  // Require the verified email to be included as a team member.
  if (!safeMembers.some((m)=>m.email === email)) {
    return json(400, {
      error: "Please add yourself as the first member (your verified email)."
    });
  }
  // Prevent duplicate member emails.
  const uniqueMemberEmails = new Set(safeMembers.map((m)=>m.email));
  if (uniqueMemberEmails.size !== safeMembers.length) {
    return json(400, {
      error: "Duplicate member emails are not allowed."
    });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  // Require that the email has a verified OTP and it hasn't expired.
  const { data: otpRow, error: otpErr } = await supabase.from("team_registration_otps").select("email, expires_at, verified").eq("email", email).maybeSingle();
  if (otpErr || !otpRow) return json(403, {
    error: "Email not verified"
  });
  if (!otpRow.verified) return json(403, {
    error: "Email not verified"
  });
  const exp = new Date(otpRow.expires_at).getTime();
  if (!Number.isFinite(exp) || exp < Date.now()) {
    await supabase.from("team_registration_otps").delete().eq("email", email);
    return json(403, {
      error: "OTP expired"
    });
  }
  // Ensure the verified email and all provided member emails are not already
  // present in any existing team (teams.members jsonb array).
  const normalize = (v)=>String(v || "").trim().toLowerCase();
  const emailsToCheck = [
    email,
    ...safeMembers.map((m)=>m.email)
  ].map(normalize).filter(Boolean);
  if (emailsToCheck.length) {
    const { data: allTeams, error: allErr } = await supabase.from("teams").select("id, name, project_title, members").order("created_at", {
      ascending: false
    }).limit(2000);
    if (allErr) {
      return json(500, {
        error: "Failed to validate existing team membership"
      });
    }
    const normText = (v)=>String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
    const wantedTeamName = normText(teamName);
    const wantedProjectTitle = normText(projectName);
    // Avoid duplicate team name / project title.
    // (Scan the recent teams list already fetched above.)
    const dupName = (allTeams || []).find((t)=>normText(t?.name) === wantedTeamName) || null;
    if (dupName) {
      return json(409, {
        error: "Team name already exists. Please choose a different team name."
      });
    }
    const dupProject = (allTeams || []).find((t)=>normText(t?.project_title) === wantedProjectTitle) || null;
    if (dupProject) {
      return json(409, {
        error: "Project name already exists. Please choose a different project name."
      });
    }
    // Map each existing member email -> team (first match wins).
    const memberToTeam = new Map();
    (allTeams || []).forEach((t)=>{
      const mem = Array.isArray(t?.members) ? t.members : [];
      mem.forEach((m)=>{
        const e = normalize(m?.email);
        if (e && !memberToTeam.has(e)) memberToTeam.set(e, t);
      });
    });
    const conflictEmail = emailsToCheck.find((e)=>memberToTeam.has(e)) || "";
    if (conflictEmail) {
      const t = memberToTeam.get(conflictEmail);
      return json(409, {
        error: "One or more emails already belong to a team.",
        conflict_email: conflictEmail,
        team: {
          id: t?.id,
          name: t?.name,
          project_title: t?.project_title,
          members: Array.isArray(t?.members) ? t.members : []
        }
      });
    }
  }
  // Re-check existing team membership to prevent bypass/races.
  const membersNeedle = JSON.stringify([
    {
      email
    }
  ]);
  const { data: existingTeams, error: existingErr } = await supabase.from("teams").select("id, name, project_title, members").filter("members", "cs", membersNeedle).order("created_at", {
    ascending: false
  }).limit(1);
  if (existingErr) {
    return json(500, {
      error: "Failed to validate existing team membership"
    });
  }
  let existingTeam = (existingTeams || [])[0] || null;
  if (!existingTeam) {
    // Fallback scan (see lookup-team-by-email for rationale).
    const { data: allTeams, error: allErr } = await supabase.from("teams").select("id, name, project_title, members").order("created_at", {
      ascending: false
    }).limit(1000);
    if (allErr) {
      return json(500, {
        error: "Failed to validate existing team membership"
      });
    }
    const normalize = (v)=>String(v || "").trim().toLowerCase();
    const target = normalize(email);
    existingTeam = (allTeams || []).find((t)=>{
      const mem = Array.isArray(t?.members) ? t.members : [];
      return mem.some((m)=>normalize(m?.email) === target);
    }) || null;
  }
  if (existingTeam) {
    const t = existingTeam;
    return json(409, {
      error: "Email already belongs to a team.",
      team: {
        id: t?.id,
        name: t?.name,
        project_title: t?.project_title,
        members: Array.isArray(t?.members) ? t.members : []
      }
    });
  }
  const { data: teamRow, error: teamErr } = await supabase.from("teams").insert({
    name: teamName,
    project_title: projectName,
    track,
    members: safeMembers,
    status: "Draft"
  }).select("id").single();
  if (teamErr || !teamRow?.id) {
    return json(400, {
      error: "Failed to create team",
      details: teamErr?.message || ""
    });
  }
  // Consume OTP so it can't be reused for unlimited team creation.
  await supabase.from("team_registration_otps").delete().eq("email", email);
  return json(200, {
    ok: true,
    team_id: teamRow.id
  });
});
