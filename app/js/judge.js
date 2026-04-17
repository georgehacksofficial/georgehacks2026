import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

const ensureJudge = async () => {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return { ok: false, message: 'Unable to verify user.' };
  }

  const { data: judgeRow, error: judgeError } = await supabase
    .from('judges')
    .select('id, user_id, full_name, email')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (judgeError || !judgeRow) {
    return { ok: false, message: 'Judge access required.' };
  }

  return { ok: true, judge: judgeRow };
};

const guardJudgePage = async () => {
  const judgeCheck = await ensureJudge();
  if (judgeCheck.ok) return judgeCheck.judge;
  await supabase.auth.signOut();
  window.location.href = `${window.location.origin}/pages/signin.html?reason=judge`;
  return null;
};

AOS.init();
const judge = await guardJudgePage();

const judgeSignoutBtn = document.getElementById('judgeSignoutBtn');
if (judgeSignoutBtn) {
  judgeSignoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = `${window.location.origin}/pages/signin.html`;
  });
}

// Remove preload overlay if app.js isn't loaded on this page
const preload = document.querySelector('.preload');
if (preload) {
  setTimeout(() => preload.remove(), 100);
}

function toast(msg, danger = false) {
  const el = $("ghToast");
  el.textContent = msg;
  el.classList.toggle("is-danger", !!danger);
  el.classList.add("is-show");
  setTimeout(() => el.classList.remove("is-show"), 2600);
}

let teams = [];
let assignments = [];
let scoresByTeam = {};
let activeTeamId = null;
let activeJudge = judge;
let activeJudgeId = judge?.id || null;

function setJudgeName() {
  const el = $("judgeName");
  if (!el) return;
  el.textContent = activeJudge?.full_name || "-";
}

function computeTotalFromInputs() {
  let total = 0;
  document.querySelectorAll(".scoreInput").forEach(inp => {
    const v = Number(inp.value || 0);
    total += Number.isFinite(v) ? v : 0;
  });
  $("totalScore").textContent = total;
  return total;
}

function clampInputs() {
  document.querySelectorAll(".scoreInput").forEach(inp => {
    inp.addEventListener("input", () => {
      const v = Number(inp.value || 0);
      if (v < 0) inp.value = 0;
      if (v > 10) inp.value = 10;
      computeTotalFromInputs();
    });
  });
}
clampInputs();

function getAssignedTeamIds() {
  if (!activeJudgeId) return [];
  return assignments.filter(a => a.judge_id === activeJudgeId).map(a => a.team_id);
}

function badge(status, scored) {
  if (scored) return `<span class="gh-badge gh-badge--scored">Scored</span>`;
  const s = (status || "Draft").toLowerCase();
  if (s.includes("draft")) return `<span class="gh-badge gh-badge--draft">Draft</span>`;
  if (s.includes("submit")) return `<span class="gh-badge gh-badge--submitted">Submitted</span>`;
  if (s.includes("hack")) return `<span class="gh-badge gh-badge--hacking">Hacking</span>`;
  return `<span class="gh-badge gh-badge--draft">${status}</span>`;
}

function parseUxFromComments(comments) {
  if (!comments) return { ux: 0, clean: "" };
  const lines = comments.split("\n");
  const first = lines[0] || "";
  const match = first.match(/^UX\/Design:\s*(\d+)/i);
  if (!match) return { ux: 0, clean: comments };
  const ux = Number(match[1] || 0);
  const clean = lines.slice(1).join("\n").trim();
  return { ux: Number.isFinite(ux) ? ux : 0, clean };
}

function filteredTeamsForJudge() {
  const assigned = new Set(getAssignedTeamIds());
  const q = $("searchInput").value.trim().toLowerCase();

  const list = teams
    .filter(t => assigned.has(t.id))
    .map(t => {
      const scoreObj = scoresByTeam[t.id] || null;
      const total = scoreObj?.total ?? null;
      const lastBy = t.lastScoredByName || "-";
      return { ...t, _myScoreTotal: total, _lastBy: lastBy };
    })
    .filter(t => {
      const matchesQ =
        !q ||
        (t.teamName || "").toLowerCase().includes(q) ||
        (t.projectName || "").toLowerCase().includes(q);
      return matchesQ;
    });

  $("countAssigned").textContent = assigned.size;
  $("countShown").textContent = list.length;

  return list;
}

async function refreshAssignments() {
  if (!activeJudgeId) return;
  const { data, error } = await supabase
    .from("assignments")
    .select("id, judge_id, team_id")
    .eq("judge_id", activeJudgeId)
    .order("created_at", { ascending: false });

  if (error) {
    toast("Failed to load assignments", true);
    return;
  }

  assignments = data || [];
  renderTable();
}

async function refreshTeams() {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, project_title, members, status, score, last_scored_by_name")
    .order("created_at", { ascending: false });

  if (error) {
    toast("Failed to load teams", true);
    return;
  }

  teams = (data || []).map(row => ({
    id: row.id,
    teamName: row.name || "-",
    projectName: row.project_title || "-",
    members: row.members || [],
    status: row.status || "Draft",
    score: row.score ?? null,
    lastScoredByName: row.last_scored_by_name || "-",
  }));

  renderTable();
}

async function refreshScores() {
  if (!activeJudgeId) return;
  const { data, error } = await supabase
    .from("scores")
    .select("id, team_id, innovation, technical, impact, presentation, comments, submitted")
    .eq("judge_id", activeJudgeId);

  if (error) {
    toast("Failed to load scores", true);
    return;
  }

  scoresByTeam = {};
  (data || []).forEach(s => {
    const { ux, clean } = parseUxFromComments(s.comments || "");
    const parts = [
      s.innovation ?? 0,
      s.technical ?? 0,
      s.impact ?? 0,
      ux,
      s.presentation ?? 0,
    ];
    const total = parts.reduce((a, b) => a + b, 0);
    scoresByTeam[s.team_id] = {
      id: s.id,
      parts,
      total,
      comments: clean,
      submitted: !!s.submitted,
    };
  });

  renderTable();
}

function renderTable() {
  const tbody = $("teamsBody");
  if (!activeJudgeId) {
    tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding: 18px; color: rgba(255,255,255,.7);">
              Judge not found.
            </td>
          </tr>
        `;
    $("countShown").textContent = "0";
    return;
  }

  const list = filteredTeamsForJudge();

  if (!list.length) {
    tbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding: 18px; color: rgba(255,255,255,.7);">
              No assigned teams match your search.
            </td>
          </tr>
        `;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const judgeScore = scoresByTeam[t.id]?.total ?? null;
    const totalShown = judgeScore ?? t.score ?? null;

    const lastBy = scoresByTeam[t.id]
      ? (activeJudge?.full_name || "-")
      : (t.lastScoredByName || "-");
    const scoredByMe = judgeScore !== null && judgeScore !== undefined;
    const isFinal = scoresByTeam[t.id]?.submitted === true;

    return `
          <tr>
            <td data-label="Team">${t.teamName || "-"}</td>
            <td data-label="Project">${t.projectName || "-"}</td>
            <td data-label="Status">${badge(t.status, scoredByMe)}</td>
            <td data-label="Total Score">${totalShown ?? "-"}</td>
            <td data-label="Last Scored By">${lastBy}</td>
            <td data-label="Action" class="gh-actions">
              <button class="gh-mini" data-act="score" data-id="${t.id}" ${isFinal ? "disabled" : ""}>Score</button>
            </td>
          </tr>
        `;
  }).join("");
}

function openModal(teamId) {
  const t = teams.find(x => x.id === teamId);
  if (!t) return;

  activeTeamId = teamId;

  $("modalTitle").textContent = t.teamName || "Team";
  $("modalSub").textContent = t.projectName || "Project";

  const prev = scoresByTeam[teamId] || null;
  const vals = prev?.parts || [0,0,0,0,0];

  const inputs = document.querySelectorAll(".scoreInput");
  inputs.forEach((inp, i) => inp.value = vals[i] ?? 0);
  $("scoreComments").value = prev?.comments || "";

  computeTotalFromInputs();

  $("scoreModal").classList.add("is-open");
  $("scoreModal").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeModal() {
  $("scoreModal").classList.remove("is-open");
  $("scoreModal").setAttribute("aria-hidden", "true");
  activeTeamId = null;
  document.body.classList.remove("modal-open");
}

function submitScore() {
  const judgeId = activeJudgeId;
  const j = activeJudge;
  if (!judgeId || !j) return toast("Judge not available", true);
  if (!activeTeamId) return;

  const t = teams.find(x => x.id === activeTeamId);
  if (!t) return;

  const parts = Array.from(document.querySelectorAll(".scoreInput")).map(i => {
    const v = Number(i.value || 0);
    if (!Number.isFinite(v)) return 0;
    return Math.min(10, Math.max(0, v));
  });

  const total = parts.reduce((a,b) => a + b, 0);
  const commentsRaw = $("scoreComments").value.trim();
  const uxScore = parts[3];
  const comments = `UX/Design: ${uxScore}${commentsRaw ? `\n${commentsRaw}` : ""}`;

  (async () => {
    const existing = scoresByTeam[activeTeamId];
    if (existing?.id && existing.submitted) {
      return toast("Final scores already submitted.", true);
    }

    if (existing?.id) {
      const { error } = await supabase
        .from("scores")
        .update({
          innovation: parts[0],
          technical: parts[1],
          impact: parts[2],
          presentation: parts[4],
          comments,
          submitted: false,
        })
        .eq("id", existing.id);

      if (error) return toast("Failed to update score", true);
    } else {
      const { error } = await supabase
        .from("scores")
        .insert({
          judge_id: judgeId,
          team_id: activeTeamId,
          innovation: parts[0],
          technical: parts[1],
          impact: parts[2],
          presentation: parts[4],
          comments,
          submitted: false,
        });

      if (error) return toast("Failed to submit score", true);
    }

    await supabase
      .from("teams")
      .update({ score: total, last_scored_by: judgeId, last_scored_by_name: j.full_name })
      .eq("id", activeTeamId);

    await refreshScores();
    await refreshTeams();
    toast("Score submitted");
    closeModal();
    renderTable();
  })();
}

async function submitAllScores() {
  const assignedIds = getAssignedTeamIds();
  const missing = assignedIds.filter(id => !scoresByTeam[id]);
  if (missing.length) {
    return toast(`Score all assigned teams first (${missing.length} missing).`, true);
  }

  const { error } = await supabase
    .from("scores")
    .update({ submitted: true })
    .eq("judge_id", activeJudgeId);

  if (error) return toast("Failed to submit all scores", true);
  toast("All scores submitted");
  await refreshScores();
}

// Events
$("btnRefresh").addEventListener("click", () => {
  toast("Refreshed");
  refreshTeams();
  refreshAssignments();
  refreshScores();
});

$("btnSubmitAll").addEventListener("click", submitAllScores);
$("searchInput").addEventListener("input", renderTable);

$("teamsBody").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const act = btn.getAttribute("data-act");
  const id = btn.getAttribute("data-id");
  if (act === "score") openModal(id);
});

$("btnCloseModal").addEventListener("click", closeModal);
$("btnSubmitScore").addEventListener("click", submitScore);

$("scoreModal").addEventListener("click", (e) => {
  if (e.target.id === "scoreModal") closeModal();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// Init
setJudgeName();
refreshTeams();
refreshAssignments();
refreshScores();
computeTotalFromInputs();
