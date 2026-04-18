import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ensureAdmin = async () => {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false, message: 'Unable to verify user.' };
  }

  const { data: adminRow, error: adminError } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (adminError || !adminRow) {
    return { ok: false, message: 'Admin access required.' };
  }

  return { ok: true };
};

const guardAdminPage = async () => {
  const adminCheck = await ensureAdmin();
  if (adminCheck.ok) return;
  await supabase.auth.signOut();
  window.location.href = `${window.location.origin}/pages/signin.html?reason=admin`;
};

AOS.init();
await guardAdminPage();

const adminSignoutBtn = document.getElementById('adminSignoutBtn');
if (adminSignoutBtn) {
  adminSignoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = `${window.location.origin}/pages/signin.html`;
  });
}

// Remove preload overlay if app.js isn't loaded on this page
const preload = document.querySelector('.preload');
if (preload) {
  setTimeout(() => preload.remove(), 100);
}

// Storage keys (keep separate from your other single-file demo)
const KEY_TEAMS = "gh_admin_teams";
const KEY_JUDGES = "gh_admin_judges";
const KEY_ASSIGN = "gh_admin_assignments"; // legacy local only

const $ = (id) => document.getElementById(id);

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const load = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; }
  catch { return fallback; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

let teams = [];
let judges = [];
let assignments = [];
let tempMembers = [];

const MIN_MEMBERS = 3;
const MAX_MEMBERS = 5;
const PROBLEM_STATEMENTS_BY_TRACK = {
  track1: ["Problem Statement 1"],
  track2: ["Problem Statement 1", "Problem Statement 2"],
  track3: ["Problem Statement 1"],
};

// Normalize GW student aliases: treat @gwmail.gwu.edu as @gwu.edu to prevent duplicates.
function normalizeEmail(v) {
  const raw = String(v || "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return raw;
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (domain === "gwmail.gwu.edu") return `${local}@gwu.edu`;
  return raw;
}

const PAGE_SIZE_TEAMS = 5;
const PAGE_SIZE_JUDGES = 5;
let teamsPage = 1;
let judgesPage = 1;
let teamsSearchQuery = "";

// Seed small demo data once

function toast(msg, danger = false) {
  const el = $("ghToast");
  el.textContent = msg;
  el.classList.toggle("is-danger", !!danger);
  el.classList.add("is-show");
  setTimeout(() => el.classList.remove("is-show"), 2600);
}

function computeStats() {
  const totalTeams = teams.length;
  const hackers = teams.reduce((acc, t) => acc + (t.members?.length || 0), 0);
  const submitted = teams.filter(t => t.status && t.status !== "Draft").length;
  const scored = teams.filter(t => t.score !== null && t.score !== undefined).length;

  $("statTeams").textContent = totalTeams;
  $("statHackers").textContent = hackers;
  $("statSubmitted").textContent = submitted;
  $("statScored").textContent = scored;
}

function badge(status) {
  const s = (status || "Draft").toLowerCase();
  if (s.includes("draft")) return `<span class="gh-badge gh-badge--draft">Draft</span>`;
  if (s.includes("submit")) return `<span class="gh-badge gh-badge--submitted">Submitted</span>`;
  if (s.includes("hack")) return `<span class="gh-badge gh-badge--hacking">Hacking</span>`;
  return `<span class="gh-badge gh-badge--draft">${status}</span>`;
}

function labelBadge(text, kind = "draft") {
  const v = String(text || "").trim() || "-";
  const cls = kind === "hacking" ? "gh-badge gh-badge--hacking" : (kind === "submitted" ? "gh-badge gh-badge--submitted" : "gh-badge gh-badge--draft");
  return `<span class="${cls}">${v}</span>`;
}

function pageCount(totalItems, pageSize) {
  const pages = Math.ceil((totalItems || 0) / pageSize);
  return Math.max(1, pages);
}

function clampPage(page, totalPages) {
  return Math.min(Math.max(1, page), Math.max(1, totalPages || 1));
}

function slicePage(list, page, pageSize) {
  const p = clampPage(page, pageCount(list.length, pageSize));
  const start = (p - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

function updatePager(kind, page, totalPages) {
  const prevBtn = $(`${kind}Prev`);
  const nextBtn = $(`${kind}Next`);
  const info = $(`${kind}PageInfo`);

  if (info) info.textContent = `Page ${page} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = page <= 1;
  if (nextBtn) nextBtn.disabled = page >= totalPages;
}

function judgesForTeam(teamId) {
  const list = [];
  assignments.forEach(a => {
    if (a.team_id === teamId) {
      const j = judges.find(x => x.id === a.judge_id);
      if (j) list.push(j.name);
    }
  });
  return list;
}

function teamsForJudge(judgeId) {
  const tids = assignments.filter(a => a.judge_id === judgeId).map(a => a.team_id);
  return tids.map(tid => teams.find(t => t.id === tid)?.teamName).filter(Boolean);
}

function renderSelects() {
  $("assignJudge").innerHTML = judges.length
    ? judges.map(j => `<option value="${j.id}">${j.name} (${j.email})</option>`).join("")
    : `<option value="">No judges yet</option>`;

  $("assignTeam").innerHTML = teams.length
    ? teams.map(t => `<option value="${t.id}">${t.teamName} - ${t.projectName}</option>`).join("")
    : `<option value="">No teams yet</option>`;
}

function renderTeams() {
  const tbody = $("teamsTbody");

  const q = String(teamsSearchQuery || "").trim().toLowerCase();
  const filtered = q
    ? teams.filter((t) => {
      const members = Array.isArray(t?.members) ? t.members : [];
      const membersText = members.map(m => `${m?.name || ""} ${m?.email || ""}`.toLowerCase()).join(" ");
      return [
        t?.teamName,
        t?.projectName,
        t?.track,
        membersText,
        t?.status,
      ].filter(Boolean).join(" ").toLowerCase().includes(q);
    })
    : teams;

  if (!filtered.length) {
    tbody.innerHTML = `
          <tr>
            <td colspan="8" style="padding: 18px; color: rgba(255,255,255,.7);">
              ${q ? "No matching teams." : "No teams yet."}
            </td>
          </tr>
        `;
    updatePager("teams", 1, 1);
    return;
  }

  const totalPages = pageCount(filtered.length, PAGE_SIZE_TEAMS);
  teamsPage = clampPage(teamsPage, totalPages);
  const pageTeams = slicePage(filtered, teamsPage, PAGE_SIZE_TEAMS);

  tbody.innerHTML = pageTeams.map(t => {
    const jNames = judgesForTeam(t.id);
    const scoreShown = (t.score !== null && t.score !== undefined) ? t.score : "Pending";
    const scoreBtn = (t.score !== null && t.score !== undefined)
      ? `<button class="gh-mini" data-act="unscore" data-id="${t.id}">Unmark Scored</button>`
      : `<button class="gh-mini" data-act="score" data-id="${t.id}">Mark Scored</button>`;
    return `
          <tr>
            <td>${t.teamName}</td>
            <td>${labelBadge(t.projectName, "draft")}</td>
            <td>${labelBadge(t.track || "-", "hacking")}</td>
            <td>${(t.members || []).length}</td>
            <td>${badge(t.status)}</td>
            <td>${scoreShown}</td>
            <td>${jNames.length ? jNames.join(", ") : "-"}</td>
            <td class="gh-actions">
              <button class="gh-mini" data-act="submit" data-id="${t.id}">Mark Submitted</button>
              ${scoreBtn}
              <button class="gh-mini" data-act="add-member" data-id="${t.id}">Add Member</button>
              <button class="gh-mini" data-act="remove-member" data-id="${t.id}">Remove Member</button>
              <button class="gh-mini gh-mini--danger" data-act="del" data-id="${t.id}">Delete</button>
            </td>
          </tr>
        `;
  }).join("");

  updatePager("teams", teamsPage, totalPages);
}

function renderJudges() {
  const tbody = $("judgesTbody");

  if (!judges.length) {
    tbody.innerHTML = `
          <tr>
            <td colspan="4" style="padding: 18px; color: rgba(255,255,255,.7);">
              No judges yet.
            </td>
          </tr>
        `;
    updatePager("judges", 1, 1);
    return;
  }

  const totalPages = pageCount(judges.length, PAGE_SIZE_JUDGES);
  judgesPage = clampPage(judgesPage, totalPages);
  const pageJudges = slicePage(judges, judgesPage, PAGE_SIZE_JUDGES);

  tbody.innerHTML = pageJudges.map(j => {
    const tNames = teamsForJudge(j.id);
    return `
          <tr>
            <td>${j.name}</td>
            <td>${j.email}</td>
            <td>${tNames.length ? tNames.join(", ") : "-"}</td>
            <td class="gh-actions">
              <button class="gh-mini" data-jact="unassign" data-id="${j.id}">Remove Team</button>
              <button class="gh-mini gh-mini--danger" data-jact="del" data-id="${j.id}">Delete</button>
            </td>
          </tr>
        `;
  }).join("");

  updatePager("judges", judgesPage, totalPages);
}

function persist() {
  computeStats();
  renderSelects();
  renderTeams();
  renderJudges();
}

function normalizeTeamRow(row) {
  return {
    id: row.id,
    teamName: row.name || "-",
    projectName: row.project_title || "-",
    track: row.track || null,
    members: row.members || [],
    status: row.status || "Draft",
    score: row.score ?? null,
    lastScoredByName: row.last_scored_by_name || "-",
  };
}

async function refreshTeams() {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, project_title, track, members, status, score, last_scored_by_name")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Failed to load teams", true);
    return;
  }

  teams = (data || []).map(normalizeTeamRow);
  computeStats();
  renderSelects();
  renderTeams();
}

async function refreshAssignments() {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, judge_id, team_id")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Failed to load assignments", true);
    return;
  }

  assignments = data || [];
  renderTeams();
  renderJudges();
}

async function refreshJudges() {
  const { data, error } = await supabase
    .from("judges")
    .select("id, user_id, full_name, email")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Failed to load judges", true);
    return;
  }

  judges = (data || []).map(j => ({
    id: j.id,
    user_id: j.user_id,
    name: j.full_name || "-",
    email: j.email || "-",
  }));

  renderSelects();
  renderJudges();
}

function renderMemberList() {
  const el = $("memberList");
  if (!el) return;
  const count = tempMembers.length;
  const prefix = `Members: ${count}/${MAX_MEMBERS}. `;
  const addBtn = $("btnAddMember");
  if (addBtn) addBtn.disabled = count >= MAX_MEMBERS;
  if (!tempMembers.length) {
    el.textContent = `${prefix}No members added yet.`;
    return;
  }
  el.textContent = `${prefix}${tempMembers.map(m => `${m.name} <${m.email}>`).join(", ")}`;
}



$("btnAddMember").addEventListener("click", () => {
  if (tempMembers.length >= MAX_MEMBERS) return toast(`Maximum ${MAX_MEMBERS} members allowed`, true);
  const name = $("memberName").value.trim();
  const email = $("memberEmail").value.trim();
  if (!name || !email) return toast("Enter member name & email", true);

  const normEmail = normalizeEmail(email);
  if (tempMembers.some(m => normalizeEmail(m.email) === normEmail)) {
    return toast("Duplicate member emails are not allowed.", true);
  }
  tempMembers.push({ name, email: normEmail });
  $("memberName").value = "";
  $("memberEmail").value = "";
  renderMemberList();
});

function populateAdminProblemStatements(track) {
  const sel = $("problemStatementAdmin");
  if (!sel) return;
  const key = String(track || "").trim();
  const list = PROBLEM_STATEMENTS_BY_TRACK[key] || [];

  if (!key) {
    sel.innerHTML = `<option value="">Select a track first</option>`;
    sel.disabled = true;
    return;
  }

  if (!list.length) {
    sel.innerHTML = `<option value="">No problem statements available</option>`;
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  sel.innerHTML = [`<option value="">Select a problem statement</option>`]
    .concat(list.map((s) => `<option value="${s}">${s}</option>`))
    .join("");
}

const teamTrackSel = $("teamTrack");
if (teamTrackSel) {
  teamTrackSel.addEventListener("change", () => populateAdminProblemStatements(teamTrackSel.value));
  populateAdminProblemStatements(teamTrackSel.value);
}

// Add Team
$("btnAddTeam").addEventListener("click", () => {
  const teamName = $("teamName").value.trim();
  const projectNameEl = $("projectName");
  const track = ($("teamTrack")?.value || "").trim();
  const ps = ($("problemStatementAdmin")?.value || "").trim();

  if (!teamName) return toast("Enter team name", true);
  if (!track) return toast("Choose a track", true);
  if (!ps) return toast("Choose a problem statement", true);
  if (projectNameEl) projectNameEl.value = ps; // stored in teams.project_title
  if (tempMembers.length < MIN_MEMBERS) return toast(`Minimum ${MIN_MEMBERS} members required`, true);
  if (tempMembers.length > MAX_MEMBERS) return toast(`Maximum ${MAX_MEMBERS} members allowed`, true);

  (async () => {
    // Normalize member emails (including GW alias mapping) and block duplicates.
    const normalizedMembers = (tempMembers || []).map(m => ({
      name: String(m?.name || "").trim(),
      email: normalizeEmail(m?.email),
    })).filter(m => m.name && m.email);

    const emails = normalizedMembers.map(m => m.email);
    const unique = new Set(emails);
    if (unique.size !== emails.length) {
      return toast("Duplicate member emails are not allowed.", true);
    }

    // Prevent assigning a member email to multiple teams (admin-side guard).
    // Uses the currently loaded teams list as a fast, UI-level protection.
    const memberToTeam = new Map();
    (teams || []).forEach(t => {
      const mem = Array.isArray(t?.members) ? t.members : [];
      mem.forEach(mm => {
        const e = normalizeEmail(mm?.email);
        if (e && !memberToTeam.has(e)) memberToTeam.set(e, t);
      });
    });
    const conflict = emails.find(e => memberToTeam.has(e));
    if (conflict) {
      const t = memberToTeam.get(conflict);
      return toast(`Email already belongs to team "${t?.teamName || t?.name || "-"}".`, true);
    }

    const { error } = await supabase
      .from("teams")
      .insert({
        name: teamName,
        project_title: ps,
        track,
        members: normalizedMembers,
        status: "Draft",
      });

    if (error) return toast("Failed to add team", true);

    $("teamName").value = "";
    $("projectName").value = "";
    if ($("teamTrack")) $("teamTrack").value = "";
    tempMembers = [];
    renderMemberList();

    await refreshTeams();
    toast("Team added");
  })();
});

// Add Judge
$("btnAddJudge").addEventListener("click", () => {
  const name = $("judgeName").value.trim();
  const email = $("judgeEmail").value.trim();
  const password = ($("judgePassword")?.value || "").trim();

  // For this flow, admins will create the Supabase Auth user manually.
  // We only insert into the `judges` table here.
  if (!name || !email) return toast("Enter judge name & email", true);

  (async () => {
    const { data: judge, error } = await supabase
      .from("judges")
      .insert({ full_name: name, email: email.trim().toLowerCase() })
      .select("id, user_id, full_name, email")
      .single();

    if (error) return toast("Failed to add judge", true);

    const j = { id: judge.id, name: judge.full_name, email: judge.email, user_id: judge.user_id };
    judges = [j, ...judges];

    $("judgeName").value = "";
    $("judgeEmail").value = "";
    if ($("judgePassword")) $("judgePassword").value = "";

    persist();
    toast("Judge added");
    refreshJudges();

    /*
    // Previous flow (kept for reference): create Auth user + insert judge via Edge Function.
    // This is intentionally disabled so no email/invite is sent.
    //
    // if (!password) return toast("Enter judge password", true);
    // if (password.length < 8) return toast("Password must be at least 8 characters", true);
    //
    // const session = (await supabase.auth.getSession()).data.session;
    // if (!session) return toast("Session expired. Please sign in again.", true);
    //
    // const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-judge`, {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     Authorization: `Bearer ${session.access_token}`,
    //     apikey: SUPABASE_ANON_KEY,
    //   },
    //   body: JSON.stringify({ email, full_name: name, password }),
    // });
    */
  })();
});

// Assign
$("btnAssign").addEventListener("click", () => {
  const jid = $("assignJudge").value;
  const tid = $("assignTeam").value;
  if (!jid || !tid) return toast("Select judge and team", true);

  (async () => {
    const { error } = await supabase
      .from("assignments")
      .insert({ judge_id: jid, team_id: tid });

    if (error) return toast("Failed to assign", true);
    await refreshAssignments();
    toast("Assigned");
  })();
});

// Team actions
$("teamsTbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id = btn.getAttribute("data-id");
  const act = btn.getAttribute("data-act");
  const t = teams.find(x => x.id === id);
  if (!t) return;

  if (act === "submit") {
    (async () => {
      const { error } = await supabase
        .from("teams")
        .update({ status: "Submitted" })
        .eq("id", id);

      if (error) return toast("Failed to update status", true);
      await refreshTeams();
      toast("Marked Submitted");
    })();
  }

  if (act === "score") {
    (async () => {
      // Use score != null to mean "Scored" (dashboard display).
      const { error } = await supabase
        .from("teams")
        .update({ score: 0 })
        .eq("id", id);

      if (error) return toast("Failed to mark scored", true);
      await refreshTeams();
      toast("Marked Scored");
    })();
  }

  if (act === "unscore") {
    (async () => {
      const { error } = await supabase
        .from("teams")
        .update({ score: null })
        .eq("id", id);

      if (error) return toast("Failed to unmark scored", true);
      await refreshTeams();
      toast("Unmarked Scored");
    })();
  }

  if (act === "add-member") {
    const name = prompt("Member name:", "");
    if (name === null) return;
    const email = prompt("Member email:", "");
    if (email === null) return;
    const mName = name.trim();
    const mEmail = email.trim();
    if (!mName || !mEmail) return toast("Enter member name & email", true);

    (async () => {
      const updatedMembers = [...(t.members || []), { name: mName, email: mEmail }];
      if (updatedMembers.length > MAX_MEMBERS) {
        return toast(`Maximum ${MAX_MEMBERS} members allowed`, true);
      }
      const { error } = await supabase
        .from("teams")
        .update({ members: updatedMembers })
        .eq("id", id);

      if (error) return toast("Failed to add member", true);
      await refreshTeams();
      toast("Member added");
    })();
  }

  if (act === "remove-member") {
    if (!t.members || !t.members.length) return toast("No members to remove", true);
    const email = prompt("Member email to remove:", "");
    if (email === null) return;
    const target = email.trim().toLowerCase();
    if (!target) return toast("Enter member email", true);

    (async () => {
      const updatedMembers = (t.members || []).filter(m => (m.email || "").toLowerCase() !== target);
      if (updatedMembers.length < MIN_MEMBERS) {
        return toast(`Minimum ${MIN_MEMBERS} members required`, true);
      }
      const { error } = await supabase
        .from("teams")
        .update({ members: updatedMembers })
        .eq("id", id);

      if (error) return toast("Failed to remove member", true);
      await refreshTeams();
      toast("Member removed");
    })();
  }

  if (act === "del") {
    if (!confirm("Delete this team?")) return;
    (async () => {
      const { error } = await supabase
        .from("teams")
        .delete()
        .eq("id", id);

      if (error) return toast("Failed to delete team", true);

      persist();
      await supabase.from("assignments").delete().eq("team_id", id);
      await refreshAssignments();
      await refreshTeams();
      toast("Team deleted");
    })();
  }
});

// Judge actions
$("judgesTbody").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const id = btn.getAttribute("data-id");
  const act = btn.getAttribute("data-jact");
  if (act === "unassign") {
    const teamName = prompt("Team name to remove:", "");
    if (teamName === null) return;
    const target = teamName.trim().toLowerCase();
    if (!target) return toast("Enter team name", true);

    const team = teams.find(t => (t.teamName || "").toLowerCase() === target);
    if (!team) return toast("Team not found", true);

    (async () => {
      const { error } = await supabase
        .from("assignments")
        .delete()
        .eq("judge_id", id)
        .eq("team_id", team.id);

      if (error) return toast("Failed to remove assignment", true);
      await refreshAssignments();
      toast("Assignment removed");
    })();
    return;
  }

  if (act !== "del") return;

  if (!confirm("Delete this judge?")) return;
  (async () => {
    const { error } = await supabase
      .from("judges")
      .delete()
      .eq("id", id);

    if (error) return toast("Failed to delete judge", true);
    await supabase.from("assignments").delete().eq("judge_id", id);
    await refreshJudges();
    await refreshAssignments();
    toast("Judge deleted");
  })();
});

// Export
$("btnExport").addEventListener("click", () => {
  (async () => {
    const [{ data: tData, error: tErr }, { data: jData, error: jErr }, { data: aData, error: aErr }] =
      await Promise.all([
        supabase.from("teams").select("*"),
        supabase.from("judges").select("*"),
        supabase.from("assignments").select("*"),
      ]);

    if (tErr || jErr || aErr) {
      toast("Export failed. Check permissions.", true);
      return;
    }

    const payload = {
      teams: tData || [],
      judges: jData || [],
      assignments: aData || [],
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gh-admin-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Export started");
  })();
});

// Reset (form only)
$("btnReset").addEventListener("click", () => {
  if (!confirm("Clear the form fields and member list?")) return;
  $("teamName").value = "";
  $("projectName").value = "";
  $("memberName").value = "";
  $("memberEmail").value = "";
  tempMembers = [];
  renderMemberList();
  toast("Form cleared");
});

// Init render
persist();
renderMemberList();
refreshTeams();
refreshJudges();
refreshAssignments();

// Pagination
const teamsPrev = $("teamsPrev");
const teamsNext = $("teamsNext");
const judgesPrev = $("judgesPrev");
const judgesNext = $("judgesNext");

if (teamsPrev) {
  teamsPrev.addEventListener("click", () => {
    teamsPage = Math.max(1, teamsPage - 1);
    renderTeams();
  });
}
if (teamsNext) {
  teamsNext.addEventListener("click", () => {
    teamsPage = teamsPage + 1;
    renderTeams();
  });
}
if (judgesPrev) {
  judgesPrev.addEventListener("click", () => {
    judgesPage = Math.max(1, judgesPage - 1);
    renderJudges();
  });
}
if (judgesNext) {
  judgesNext.addEventListener("click", () => {
    judgesPage = judgesPage + 1;
    renderJudges();
  });
}

// Teams search (filter + pagination)
const teamsSearch = $("teamsSearch");
if (teamsSearch) {
  teamsSearch.addEventListener("input", () => {
    teamsSearchQuery = teamsSearch.value || "";
    teamsPage = 1;
    renderTeams();
  });
}

// Hackathon timing window controls (Dashboard countdown)
const hackStartAt = $("hackStartAt");
const hackEndAt = $("hackEndAt");
const btnSaveHackWindow = $("btnSaveHackWindow");
const hackWindowHint = $("hackWindowHint");

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalInput = (iso) => {
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return "";
  }
};

async function loadHackathonWindow() {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-data`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.window || null;
  } catch {
    return null;
  }
}

async function saveHackathonWindow(startAtLocal, endAtLocal) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("No active session");

  const startDt = new Date(startAtLocal);
  const endDt = new Date(endAtLocal);
  if (!Number.isFinite(startDt.getTime()) || !Number.isFinite(endDt.getTime())) {
    throw new Error("Invalid date/time format");
  }

  const startIso = startDt.toISOString();
  const endIso = endDt.toISOString();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/update-hackathon-window`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ start_at: startIso, end_at: endIso }),
  });

  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j?.error || j?.details || JSON.stringify(j);
    } catch {
      msg = await res.text();
    }
    throw new Error(msg || "Failed to update timing");
  }
}

(async () => {
  if (!hackStartAt || !hackEndAt || !btnSaveHackWindow) return;

  const w = await loadHackathonWindow();
  if (w?.start_at) hackStartAt.value = toLocalInput(w.start_at);
  if (w?.end_at) hackEndAt.value = toLocalInput(w.end_at);
  if (hackWindowHint) hackWindowHint.textContent = w?.updated_at ? `Last updated: ${new Date(w.updated_at).toLocaleString()}` : "";

  btnSaveHackWindow.addEventListener("click", async () => {
    const s = String(hackStartAt.value || "").trim();
    const e = String(hackEndAt.value || "").trim();
    if (!s || !e) return toast("Start and end date/time required", true);

    const sMs = new Date(s).getTime();
    const eMs = new Date(e).getTime();
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) return toast("Invalid date/time", true);
    if (eMs <= sMs) return toast("End must be after start", true);

    try {
      await saveHackathonWindow(s, e);
      toast("Timing updated");
      const nw = await loadHackathonWindow();
      if (hackWindowHint) hackWindowHint.textContent = nw?.updated_at ? `Last updated: ${new Date(nw.updated_at).toLocaleString()}` : "Saved";
    } catch (err) {
      toast(`Failed to update timing: ${err?.message || "Unknown error"}`, true);
      // eslint-disable-next-line no-console
      console.warn("hackathon window:", err);
    }
  });
})();

// Winners controls (manual toggle + editable winners list)
const showWinnersToggle = $("showWinnersToggle");
const btnSaveWinners = $("btnSaveWinners");
const winnersAdminHint = $("winnersAdminHint");
const winnerPlaceSelect = $("winnerPlaceSelect");
const winnerTeamSelect = $("winnerTeamSelect");
const btnAddWinnerTeam = $("btnAddWinnerTeam");
const winnersList = $("winnersList");
const winnerMembersPreview = $("winnerMembersPreview");

function parseMembers(text) {
  const lines = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.map((line) => {
    // Accept: "Name, email" OR "Name <email>" OR "Name"
    const angle = line.match(/^(.*?)<([^>]+)>$/);
    if (angle) {
      const name = angle[1].trim().replace(/,$/, "");
      const email = angle[2].trim();
      return { name: name || email, email };
    }
    const parts = line.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { name: parts[0], email: parts[1] };
    return { name: line };
  });
}

async function loadWinnersState() {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-data`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { flags: data?.flags || {}, winners: data?.winners || [] };
  } catch {
    return null;
  }
}

async function saveWinnersState(enabled, winners) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("No active session");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/update-winners`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ enabled: !!enabled, winners }),
  });

  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = j?.error || j?.details || JSON.stringify(j);
    } catch {
      msg = await res.text();
    }
    throw new Error(msg || "Failed to save winners");
  }
}

(async () => {
  if (!showWinnersToggle || !btnSaveWinners) return;
  // Ensure teams are loaded before we build the winners dropdown.
  if (!teams || !teams.length) {
    try { await refreshTeams(); } catch { /* ignore */ }
  }
  const state = await loadWinnersState();
  if (state?.flags) showWinnersToggle.checked = !!state.flags.show_winners;

  const byPlace = new Map((state?.winners || []).map(w => [Number(w.place), w]));
  const w1 = byPlace.get(1);
  const w2 = byPlace.get(2);
  const w3 = byPlace.get(3);

  if (winnersAdminHint) {
    winnersAdminHint.textContent = state?.flags?.show_winners_updated_at
      ? `Last updated: ${new Date(state.flags.show_winners_updated_at).toLocaleString()}`
      : "";
  }

  // Winners picker (v2): single dropdown + list (similar to Assign flow).
  const winnerEntries = [];

  const membersText = (t) => {
    const members = Array.isArray(t?.members) ? t.members : [];
    return members.length
      ? members.map(x => x?.email ? `${x.name || x.email} <${x.email}>` : (x?.name || "")).filter(Boolean).join(", ")
      : "-";
  };

  const setPlaceOptions = () => {
    if (!winnerPlaceSelect) return;
    const opts = [`<option value="">Place...</option>`];
    for (let i = 1; i <= 20; i++) opts.push(`<option value="${i}">${i}</option>`);
    winnerPlaceSelect.innerHTML = opts.join("");
  };

  const setTeamOptions = () => {
    if (!winnerTeamSelect) return;
    const list = (teams || []).slice().sort((a, b) => String(a.teamName || "").localeCompare(String(b.teamName || "")));
    winnerTeamSelect.innerHTML = [`<option value="">Select a team...</option>`]
      .concat(list.map(t => `<option value="${t.id}">${t.teamName}</option>`))
      .join("");
  };

  const updatePreview = () => {
    if (!winnerMembersPreview) return;
    const id = String(winnerTeamSelect?.value || "").trim();
    const t = (teams || []).find(x => x.id === id);
    if (!t) {
      winnerMembersPreview.innerHTML = `<strong>Members:</strong> -`;
      return;
    }
    winnerMembersPreview.innerHTML = `<strong>Members:</strong> ${membersText(t)}`;
  };

  const renderWinnersList = () => {
    if (!winnersList) return;
    if (!winnerEntries.length) {
      winnersList.innerHTML = `<div style="color: rgba(255,255,255,.70); font-size: 13px;">No winners selected yet.</div>`;
      return;
    }
    const sorted = winnerEntries.slice().sort((a, b) => a.place - b.place);
    winnersList.innerHTML = sorted.map((e) => {
      const t = (teams || []).find(x => x.id === e.team_id);
      const name = t?.teamName || "Unknown Team";
      return `
        <div class="gh-admin-winners__item">
          <div><span>${e.place}</span> <strong>${name}</strong></div>
          <button class="gh-mini gh-mini--danger" type="button" data-wid="${e.team_id}">Remove</button>
        </div>
      `;
    }).join("");
  };

  const seedFromState = () => {
    winnerEntries.length = 0;
    const v2 = (state?.winners || []).filter(w => w?.team_id);
    v2
      .slice()
      .sort((a, b) => Number(a.place || 0) - Number(b.place || 0))
      .forEach(w => winnerEntries.push({ team_id: String(w.team_id), place: Number(w.place || 0) || 0 }));
    renderWinnersList();
  };

  setPlaceOptions();
  setTeamOptions();
  updatePreview();
  seedFromState();

  if (btnAddWinnerTeam) {
    btnAddWinnerTeam.addEventListener("click", () => {
      const id = String(winnerTeamSelect?.value || "").trim();
      const place = Number(String(winnerPlaceSelect?.value || "").trim());
      if (!place || !Number.isFinite(place) || place < 1) return toast("Select a valid place", true);
      if (!id) return toast("Select a team to add", true);
      if (winnerEntries.some(x => x.team_id === id)) return toast("That team is already in winners", true);
      if (winnerEntries.some(x => x.place === place)) return toast("That place is already used", true);
      winnerEntries.push({ team_id: id, place });
      renderWinnersList();
    });
  }

  if (winnersList) {
    winnersList.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const id = b.getAttribute("data-wid");
      if (!id) return;
      const idx = winnerEntries.findIndex(x => x.team_id === id);
      if (idx >= 0) winnerEntries.splice(idx, 1);
      renderWinnersList();
    });
  }

  if (winnerTeamSelect) winnerTeamSelect.addEventListener("change", updatePreview);

  btnSaveWinners.addEventListener("click", async () => {
    const winners = [];

    if (!winnerEntries.length) return toast("Add at least one winning team", true);
    winnerEntries
      .slice()
      .sort((a, b) => a.place - b.place)
      .forEach((e) => winners.push({ team_id: e.team_id, place: e.place }));

    try {
      await saveWinnersState(showWinnersToggle.checked, winners);
      toast("Winners saved");
      const fresh = await loadWinnersState();
      if (winnersAdminHint) {
        winnersAdminHint.textContent = fresh?.flags?.show_winners_updated_at
          ? `Last updated: ${new Date(fresh.flags.show_winners_updated_at).toLocaleString()}`
          : "Saved";
      }
    } catch (err) {
      toast(`Failed to save winners: ${err?.message || "Unknown error"}`, true);
      // eslint-disable-next-line no-console
      console.warn("winners:", err);
    }
  });
})();
