import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

AOS.init();

// Remove preload overlay if app.js isn't loaded on this page
const preload = document.querySelector('.preload');
if (preload) {
  setTimeout(() => preload.remove(), 100);
}

function toast(msg, danger = false) {
  const el = $("ghToast");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-danger", !!danger);
  el.classList.add("is-show");
  setTimeout(() => el.classList.remove("is-show"), 2600);
}

function setMsg(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-show", !!text);
  el.classList.toggle("is-danger", kind === "danger");
  el.classList.toggle("is-ok", kind === "ok");
}

const emailStep = $("emailStep");
const otpStep = $("otpStep");
const teamStep = $("teamStep");

const regEmail = $("regEmail");
const btnSendOtp = $("btnSendOtp");
const emailMsg = $("emailMsg");

const otpCode = $("otpCode");
const btnVerifyOtp = $("btnVerifyOtp");
const otpMsg = $("otpMsg");

const teamName = $("teamName");
const projectName = $("projectName");
const teamTrack = $("teamTrack");
const problemStatement = $("problemStatement");
const memberName = $("memberName");
const memberEmail = $("memberEmail");
const btnAddMember = $("btnAddMember");
const memberList = $("memberList");
const btnCreateTeam = $("btnCreateTeam");
const teamMsg = $("teamMsg");

let verifiedEmail = "";
let members = [];
const MIN_MEMBERS = 3;
const MAX_MEMBERS = 5;
// Public team registration is controlled server-side via the `team_registration_open` flag.
// This client-side toggle is kept as a soft-override for emergencies (defaults to open).
const TEAM_REGISTRATION_OPEN = true;
const PROBLEM_STATEMENTS_BY_TRACK = {
  track1: ["Problem Statement 1"],
  track2: ["Problem Statement 2", "Problem Statement 3"],
  track3: ["Problem Statement 4"],
};

function normalizeEmail(v) {
  const raw = (v || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return raw;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain === "gwmail.gwu.edu") return `${local}@gwu.edu`;
  return raw;
}

function renderMemberList() {
  if (!memberList) return;
  const count = members.length;
  const prefix = `Members: ${count}/${MAX_MEMBERS}. `;
  if (btnAddMember) btnAddMember.disabled = count >= MAX_MEMBERS;
  if (!count) {
    memberList.textContent = `${prefix}No members added yet.`;
    return;
  }
  memberList.textContent = `${prefix}${members.map(m => `${m.name} <${m.email}>`).join(", ")}`;
}

function populateProblemStatements(track) {
  if (!problemStatement) return;
  const key = String(track || "").trim();
  const list = PROBLEM_STATEMENTS_BY_TRACK[key] || [];

  if (!key) {
    problemStatement.innerHTML = `<option value="">Select a track first</option>`;
    problemStatement.disabled = true;
    if (projectName) projectName.value = "";
    return;
  }

  if (!list.length) {
    problemStatement.innerHTML = `<option value="">No problem statements available</option>`;
    problemStatement.disabled = true;
    if (projectName) projectName.value = "";
    return;
  }

  problemStatement.disabled = false;
  problemStatement.innerHTML = [`<option value="">Select a problem statement</option>`]
    .concat(list.map((s) => `<option value="${s}">${s}</option>`))
    .join("");
  if (projectName) projectName.value = "";
}

if (teamTrack && problemStatement) {
  teamTrack.addEventListener("change", () => populateProblemStatements(teamTrack.value));
  problemStatement.addEventListener("change", () => {
    if (projectName) projectName.value = (problemStatement.value || "").trim();
  });
  populateProblemStatements(teamTrack.value);
}

async function sendOtp(email) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-team-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const raw = await res.text(); // Read once
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = null;
    }
    throw new Error(body?.error || raw || "Failed to send OTP");
  }
}

async function lookupTeamByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/lookup-team-by-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to lookup team");
  }
  return res.json();
}

async function verifyOtp(email, otp) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-team-otp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, otp }),
  });
  if (!res.ok) {
    const raw = await res.text(); // Read once
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = null;
    }
    throw new Error(body?.error || raw || "Failed to verify OTP");
  }
}

async function createTeam(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-team`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const raw = await res.text(); // Read the body once (avoid "body stream already read")
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch (_) {
      body = null;
    }

    const err = body?.error || raw || "Failed to create team";
    if (body?.team?.name) {
      const memberStr = Array.isArray(body.team.members) && body.team.members.length
        ? body.team.members.map(m => `${m?.name || "Member"} <${m?.email || "-"}>`).join(", ")
        : "-";
      const conflict = body?.conflict_email ? ` (${body.conflict_email})` : "";
      throw new Error(
        `${err}${conflict}. You belong to team "${body.team.name}"` +
          `${body.team.project_title ? ` (${body.team.project_title})` : ""}. ` +
          `Your team members are: ${memberStr}. If you want to change your team please contact admin.`
      );
    }

    throw new Error(err);
  }

  return res.json();
}

if (btnSendOtp) {
  btnSendOtp.addEventListener("click", async () => {
    setMsg(emailMsg, "", "");
    setMsg(otpMsg, "", "");
    setMsg(teamMsg, "", "");

    const email = normalizeEmail(regEmail?.value);
    if (!email) return setMsg(emailMsg, "Enter your email.", "danger");

    if (!TEAM_REGISTRATION_OPEN) {
      setMsg(emailMsg, "Registration closed for George Hacks 2026.", "danger");
      toast("Registration closed", true);
      return;
    }

    btnSendOtp.disabled = true;
    try {
      const lookup = await lookupTeamByEmail(email);
      if (lookup?.found && lookup?.team) {
        const t = lookup.team;
        const memberStr = Array.isArray(t.members) && t.members.length
          ? t.members.map(m => `${m?.name || "Member"} <${m?.email || "-"}>`).join(", ")
          : "-";

        setMsg(
          emailMsg,
          `You belong to team "${t.name || "-"}"${t.project_title ? ` (${t.project_title})` : ""}. ` +
            `Your team members are: ${memberStr}. If you want to change your team please contact admin.`,
          "danger"
        );
        toast("Already registered", true);
        return;
      }

      await sendOtp(email);
      verifiedEmail = email;
      if (otpStep) otpStep.style.display = "block";
      setMsg(emailMsg, "OTP sent. Check your email and enter the code below.", "ok");
      toast("OTP sent");
    } catch (e) {
      setMsg(emailMsg, (e && e.message) ? e.message : "Failed to send OTP.", "danger");
    } finally {
      btnSendOtp.disabled = false;
    }
  });
}

if (btnVerifyOtp) {
  btnVerifyOtp.addEventListener("click", async () => {
    setMsg(otpMsg, "", "");
    setMsg(teamMsg, "", "");

    const email = verifiedEmail || normalizeEmail(regEmail?.value);
    const code = (otpCode?.value || "").trim();
    if (!email) return setMsg(otpMsg, "Enter your email first.", "danger");
    if (!code) return setMsg(otpMsg, "Enter the OTP code.", "danger");

    btnVerifyOtp.disabled = true;
    try {
      await verifyOtp(email, code);
      if (emailStep) emailStep.style.display = "none";
      if (otpStep) otpStep.style.display = "none";
      if (teamStep) teamStep.style.display = "block";
      // Prefill the first member with the verified email so the user adds themselves first.
      if (memberEmail) {
        memberEmail.value = email;
        memberEmail.disabled = true;
      }
      if (memberName) memberName.focus();
      setMsg(otpMsg, "Verified. You can now create your team.", "ok");
      toast("OTP verified");
    } catch (e) {
      setMsg(otpMsg, (e && e.message) ? e.message : "Invalid OTP.", "danger");
    } finally {
      btnVerifyOtp.disabled = false;
    }
  });
}

if (btnAddMember) {
  btnAddMember.addEventListener("click", () => {
    setMsg(teamMsg, "", "");
    if (members.length >= MAX_MEMBERS) {
      setMsg(teamMsg, `Maximum ${MAX_MEMBERS} members allowed.`, "danger");
      toast("Max members reached", true);
      return;
    }
    const n = (memberName?.value || "").trim();
    const e = normalizeEmail(memberEmail?.value);
    if (!n || !e) {
      setMsg(teamMsg, "Enter member name and email.", "danger");
      return;
    }
    const existing = members.map(m => normalizeEmail(m?.email)).filter(Boolean);
    if (existing.includes(e)) {
      setMsg(teamMsg, "This member email is already in your team.", "danger");
      toast("Duplicate member email", true);
      return;
    }
    members = [...members, { name: n, email: e }];
    if (memberName) memberName.value = "";
    if (memberEmail) memberEmail.value = "";
    renderMemberList();
    toast("Member added");

    // After the user adds themselves (verified email) as the first member,
    // unlock the email field so they can add additional members.
    if (memberEmail && memberEmail.disabled) {
      const verified = normalizeEmail(verifiedEmail);
      if (verified && normalizeEmail(e) === verified) {
        memberEmail.disabled = false;
        memberEmail.value = "";
        memberEmail.focus();
      }
    }
  });
}

if (btnCreateTeam) {
  btnCreateTeam.addEventListener("click", async () => {
    setMsg(teamMsg, "", "");
    const email = verifiedEmail || normalizeEmail(regEmail?.value);
    if (!email) return setMsg(teamMsg, "Missing verified email.", "danger");

    const tName = (teamName?.value || "").trim();
    const track = (teamTrack?.value || "").trim();
    if (!track) return setMsg(teamMsg, "Please choose a track.", "danger");
    if (!tName) return setMsg(teamMsg, "Enter team name.", "danger");

    let pName = "";
    if (problemStatement) {
      pName = (problemStatement.value || "").trim();
      if (!pName) return setMsg(teamMsg, "Please choose a problem statement.", "danger");
      if (projectName) projectName.value = pName; // stored in teams.project_title
    } else {
      pName = (projectName?.value || "").trim();
      if (!pName) return setMsg(teamMsg, "Enter problem statement.", "danger");
    }

    const memberEmails = members.map(m => normalizeEmail(m?.email)).filter(Boolean);
    if (!memberEmails.includes(email)) {
      return setMsg(teamMsg, "Please add yourself as the first member (your verified email).", "danger");
    }
    if (new Set(memberEmails).size !== memberEmails.length) {
      return setMsg(teamMsg, "Duplicate member emails are not allowed.", "danger");
    }
    if (members.length < MIN_MEMBERS) {
      return setMsg(teamMsg, `Minimum ${MIN_MEMBERS} members required.`, "danger");
    }
    if (members.length > MAX_MEMBERS) {
      return setMsg(teamMsg, `Maximum ${MAX_MEMBERS} members allowed.`, "danger");
    }

    btnCreateTeam.disabled = true;
    try {
      const payload = await createTeam({
        email,
        team_name: tName,
        project_name: pName,
        track,
        members: [...members],
      });

      setMsg(teamMsg, "Team created successfully.", "ok");
      toast("Team created");

      // Reset form (keep email visible)
      if (teamName) teamName.value = "";
      if (projectName) projectName.value = "";
      members = [];
      renderMemberList();
      // If the server returned anything useful, keep for debugging
      // eslint-disable-next-line no-console
      console.log("create-team:", payload);

      // Redirect to home after a short confirmation delay.
      setTimeout(() => {
        window.location.href = `${window.location.origin}/index.html`;
      }, 1400);
    } catch (e) {
      setMsg(teamMsg, (e && e.message) ? e.message : "Failed to create team.", "danger");
    } finally {
      btnCreateTeam.disabled = false;
    }
  });
}

renderMemberList();
