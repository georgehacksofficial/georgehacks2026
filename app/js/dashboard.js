import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.98.0/+esm';

const SUPABASE_URL = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_URL) || 'https://gtuytjhvjdpwtubaxnrg.supabase.co';
const SUPABASE_ANON_KEY = (window.GH_CONFIG && window.GH_CONFIG.SUPABASE_ANON_KEY) || 'sb_publishable_ERd3MFPLUPWIoNXhC64uJQ_fHGx2Jv0';
createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

AOS.init();

// Remove preload overlay if app.js isn't loaded on this page
const preload = document.querySelector('.preload');
if (preload) {
  setTimeout(() => preload.remove(), 100);
}

function setCountdown(hh, mm, ss) {
  const h = $("h");
  const m = $("m");
  const s = $("s");
  if (h) h.textContent = String(hh).padStart(2, "0");
  if (m) m.textContent = String(mm).padStart(2, "0");
  if (s) s.textContent = String(ss).padStart(2, "0");
}

function startCountdown(endIso) {
  if (!endIso) return;
  // Avoid spawning multiple countdown intervals on auto-refresh.
  window.__ghCountdown = window.__ghCountdown || { endIso: null, timer: null };
  const state = window.__ghCountdown;
  if (state.endIso === String(endIso) && state.timer) return;
  state.endIso = String(endIso);
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  const tick = () => {
    const end = new Date(endIso).getTime();
    const now = Date.now();
    if (!Number.isFinite(end)) return;
    let diff = Math.max(0, end - now);

    const totalSeconds = Math.floor(diff / 1000);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    setCountdown(hh, mm, ss);

    if (diff <= 0 && state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  };

  tick();
  state.timer = setInterval(tick, 1000);
}

// UI-only display labels (DB stays as stable keys like track1/track2 and "Problem Statement 1/2").
// Update these labels any time without migrating existing data.
const TRACK_DISPLAY = {
  track1: "Track 1 - United Nations & Food and Agricultural Organization",
  track2: "Track 2 - GW Global Food Institute",
  track3: "Track 3 - COMING SOON",
};

const TRACK_SHORT = {
  track1: "track1",
  track2: "track2",
  track3: "track3",
};

const PROBLEM_DISPLAY_BY_TRACK = {
  track1: {
    "Problem Statement 1": "AI",
    "Problem Statement 2": "Security",
  },
  track2: {
    "Problem Statement 1": "Global",
    "Problem Statement 2": "Local",
  },
  track3: {
    "Problem Statement 1": "Education",
    "Problem Statement 2": "Happy",
  },
};

function displayTrack(trackKey) {
  const k = String(trackKey || "").toLowerCase();
  return TRACK_DISPLAY[k] || trackKey || "-";
}

function displayProblem(trackKey, storedValue) {
  const v = String(storedValue || "").trim();
  // For now, display the stored value (e.g. "Problem Statement 1/2") as-is.
  return v || "-";
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function renderSchedule(events) {
  const wrap = $("scheduleList");
  const hint = $("scheduleHint");
  if (!wrap) return;

  const now = new Date();
  const all = (events || [])
    .map(e => ({ ...e, _start: new Date(e.start_at), _end: e.end_at ? new Date(e.end_at) : null }))
    .sort((a, b) => a._start.getTime() - b._start.getTime());

  let todays = all.filter(e => sameLocalDay(e._start, now));
  if (!todays.length) {
    // If there are no events today, show the next upcoming day's schedule.
    const nextUpcoming = all.find(e => e._start.getTime() >= now.getTime()) || null;
    if (nextUpcoming) {
      const target = nextUpcoming._start;
      todays = all.filter(e => sameLocalDay(e._start, target));
      if (hint) {
        hint.textContent = `Showing: ${target.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      }
    }
  }

  if (!todays.length) {
    wrap.innerHTML = `
      <div class="gh-dash-empty">
        No events scheduled for today.
      </div>
    `;
    if (hint) hint.textContent = '';
    return;
  }

  // Active: now between start/end (or start within last 60 min if no end)
  const activeIdx = todays.findIndex(e => {
    const start = e._start.getTime();
    const end = (e._end ? e._end.getTime() : (start + 60 * 60 * 1000));
    const t = now.getTime();
    return t >= start && t <= end;
  });

  const nextIdx = activeIdx >= 0
    ? (activeIdx + 1 < todays.length ? activeIdx + 1 : -1)
    : todays.findIndex(e => e._start.getTime() > now.getTime());

  const next = nextIdx >= 0 ? todays[nextIdx] : null;
  if (hint) {
    hint.textContent = next
      ? `Next up: ${fmtTime(next.start_at)} - ${next.title}`
      : `Today: ${todays.length} events`;
  }

  wrap.innerHTML = todays.map((e, idx) => {
    const isActive = idx === activeIdx;
    const isNext = idx === nextIdx;
    const cls = `gh-dash-sched__item${isActive ? ' is-active' : ''}${isNext ? ' is-next' : ''}`;
    const t = `${fmtTime(e.start_at)}${e.end_at ? `-${fmtTime(e.end_at)}` : ''}`;
    const loc = e.location ? `<div class="gh-dash-sched__loc">@ ${e.location}</div>` : '';
    return `
      <div class="${cls}">
        <div class="gh-dash-sched__time">${t || '-'}</div>
        <div class="gh-dash-sched__title">${e.title || '-'}</div>
        ${loc}
      </div>
    `;
  }).join('');

  // Keep the current item visible: if there is an active event, scroll it into view.
  // Otherwise, scroll the "next" event into view. This is safe even on TV displays.
  requestAnimationFrame(() => {
    const target =
      wrap.querySelector('.gh-dash-sched__item.is-active') ||
      wrap.querySelector('.gh-dash-sched__item.is-next');
    if (!target) return;

    // TV-friendly scrolling: set scrollTop directly for consistent behavior.
    // Keep a small top padding so the highlighted item is clearly visible.
    const top = Math.max(0, (target.offsetTop - wrap.offsetTop - 12));
    wrap.scrollTop = top;
  });

  // "What's Next" rail removed on this dashboard variant.
}

function setText(id, v) {
  const el = $(id);
  if (!el) return;
  el.textContent = String(v ?? '');
}

function renderTrackCounts(tracks) {
  // Map the existing UI tabs to counts we compute from DB.
  const map = {
    'UN/FAO': 'track1',
    'Global Food': 'track2',
    'Goodwill': 'track3',
  };

  const title = $("trackTitle");
  const teamsEl = $("trackTeams");
  const subsEl = $("trackSubs");
  const desc = $("trackDesc");
  const tabs = document.querySelectorAll('.gh-dash-tab');
  if (!title || !teamsEl || !subsEl || !desc || !tabs.length) return;

  const descriptions = {
    track1: 'Developing technological solutions for sustainable agriculture and global food security targets set by the United Nations.',
    track2: 'Optimizing international supply chains and waste reduction methods using IoT and edge computing technologies.',
    track3: 'Creating accessible platforms for donation management and community resource distribution in non-profit sectors.',
  };

  function setActive(label) {
    const key = map[label] || 'track1';
    const data = tracks?.[key] || { teams: 0, submissions: 0 };
    title.innerHTML = `${label} <span class="gh-dash-accent">Track</span>`;
    teamsEl.textContent = String(data.teams ?? 0);
    subsEl.textContent = String(data.submissions ?? 0);
    desc.textContent = descriptions[key] || '';
    tabs.forEach((t) => {
      const isOn = (t.getAttribute('data-track') === label);
      t.classList.toggle('is-active', isOn);
    });

    // Notify team list renderer.
    window.__ghActiveTrackKey = key;
    if (typeof window.__ghRenderTeams === 'function') window.__ghRenderTeams();
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => setActive(t.getAttribute('data-track')));
  });

  // Initialize based on the active tab, else first tab.
  const active = document.querySelector('.gh-dash-tab.is-active')?.getAttribute('data-track') ||
    tabs[0].getAttribute('data-track');
  setActive(active);
}

async function loadDashboard() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/dashboard-data`, {
    method: "GET",
    headers: { apikey: SUPABASE_ANON_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to load dashboard data");
  }

  return res.json();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = text[i + 1];
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (ch === "\r") continue;
    cell += ch;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeTime(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  return s.replace(/(\d)(AM|PM)$/i, "$1 $2").replace(/\s+/g, " ");
}

function parseDateTime(dateStr, timeStr) {
  const d = new Date(String(dateStr || "").trim());
  if (!Number.isFinite(d.getTime())) return null;
  const t = normalizeTime(timeStr);
  if (!t) return d;

  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return d;
  let hh = Number(m[1] || 0);
  const mm = Number(m[2] || 0);
  const ap = String(m[3] || "").toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  d.setHours(hh, mm, 0, 0);
  return d;
}

async function loadRoadmapEvents() {
  const url = `${window.location.origin}/assets/sheets/roadmapnew2026.csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to load roadmap CSV");
  }

  const text = await res.text();
  const rows = parseCSV(text);
  const dataRows = rows.slice(1);

  const events = [];
  dataRows.forEach((c) => {
    const date = (c[1] || "").trim();
    const time = (c[4] || "").trim();
    const title = (c[5] || "").trim();
    const loc = (c[6] || "").trim();
    const start = parseDateTime(date, time);
    if (!start || !title) return;
    events.push({
      start_at: start.toISOString(),
      end_at: null,
      title,
      location: loc,
    });
  });

  return events;
}

function renderTeamsList(teams, trackKey) {
  const wrap = $("teamsList");
  const hint = $("teamsHint");
  if (!wrap) return;

  // Airport-style "departures board" ticker:
  // Always show teams from ALL tracks, with a track badge per row.
  // The track tabs still control the header stats, not the center ticker.
  const listAll = (teams || []).slice();
  if (hint) hint.textContent = `${listAll.length} teams (all tracks)`;

  if (!listAll.length) {
    wrap.innerHTML = `<div class="gh-dash-empty">No teams yet.</div>`;
    return;
  }

  const trackLabel = (key) => {
    const k = String(key || '').toLowerCase();
    return TRACK_SHORT[k] || 'Track';
  };

  const trackBadgeClass = (key) => {
    const k = String(key || '').toLowerCase();
    if (k === 'track1') return 'gh-dash-tracktag gh-dash-tracktag--t1';
    if (k === 'track2') return 'gh-dash-tracktag gh-dash-tracktag--t2';
    if (k === 'track3') return 'gh-dash-tracktag gh-dash-tracktag--t3';
    return 'gh-dash-tracktag';
  };

  const pillClass = (row) => {
    // Score takes precedence (Scored) even if status is Draft/Submitted.
    if (row?.score !== null && row?.score !== undefined) return 'gh-dash-pill gh-dash-pill--scored';
    const s = String(row?.status || 'Draft').toLowerCase();
    if (s.includes('submit')) return 'gh-dash-pill gh-dash-pill--submitted';
    if (s.includes('draft')) return 'gh-dash-pill gh-dash-pill--draft';
    return 'gh-dash-pill gh-dash-pill--other';
  };

  // Interleave tracks so the board looks "mixed", like an airport schedule.
  const byTrack = {
    track1: [],
    track2: [],
    track3: [],
    other: [],
  };
  listAll.forEach((t) => {
    const k = String(t?.track || '').toLowerCase();
    if (k === 'track1') byTrack.track1.push(t);
    else if (k === 'track2') byTrack.track2.push(t);
    else if (k === 'track3') byTrack.track3.push(t);
    else byTrack.other.push(t);
  });
  const interleaved = [];
  while (byTrack.track1.length || byTrack.track2.length || byTrack.track3.length || byTrack.other.length) {
    if (byTrack.track1.length) interleaved.push(byTrack.track1.shift());
    if (byTrack.track2.length) interleaved.push(byTrack.track2.shift());
    if (byTrack.track3.length) interleaved.push(byTrack.track3.shift());
    if (byTrack.other.length) interleaved.push(byTrack.other.shift());
  }

  const renderRow = (t) => {
    const title = `${t?.name || '-'}`;
    const project = t?.project_title ? displayProblem(t?.track, String(t.project_title)) : '';
    const members = `${t?.members_count ?? 0} members`;
    const status = String(t?.status || 'Draft');
    const displayStatus = (() => {
      const s = status.toLowerCase();
      if (t?.score !== null && t?.score !== undefined) return 'Scored';
      if (s.includes('submit')) return 'Submitted';
      if (s.includes('draft')) return 'Registered';
      return status;
    })();
    const tKey = String(t?.track || '').toLowerCase();
    const badgeTitle = escapeHtml(displayTrack(tKey));
    const badge = `<span class="${trackBadgeClass(tKey)}" title="${badgeTitle}">${escapeHtml(trackLabel(tKey))}</span>`;

    return `
      <div class="gh-dash-flight">
        <div class="gh-dash-flight__col gh-dash-flight__col--track">${badge}</div>
        <div class="gh-dash-flight__col gh-dash-flight__col--stmt" title="${escapeHtml(project || '-')}">${escapeHtml(project || '-')}</div>
        <div class="gh-dash-flight__col gh-dash-flight__col--team" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="gh-dash-flight__col gh-dash-flight__col--members">${escapeHtml(members)}</div>
        <div class="${pillClass(t)}">${displayStatus}</div>
      </div>
    `;
  };

  wrap.innerHTML = `
    <div class="gh-dash-ticker" aria-label="Teams departures board">
      <div class="gh-dash-flighthead" aria-hidden="true">
        <div class="gh-dash-flighthead__col">Track</div>
        <div class="gh-dash-flighthead__col">Statement</div>
        <div class="gh-dash-flighthead__col">Team</div>
        <div class="gh-dash-flighthead__col">Members</div>
        <div class="gh-dash-flighthead__col">Status</div>
      </div>
      <div class="gh-dash-ticker__viewport">
        <div class="gh-dash-ticker__track">
          ${interleaved.map(renderRow).join('')}
        </div>
      </div>
      <div class="gh-dash-ticker__foot">
        <span class="gh-dash-ticker__meta">All tracks</span>
      </div>
    </div>
  `;

  const viewport = wrap.querySelector('.gh-dash-ticker__viewport');
  const track = wrap.querySelector('.gh-dash-ticker__track');
  if (!viewport || !track) return;

  // Manage a single global ticker timer.
  window.__ghTeamsTicker = window.__ghTeamsTicker || { timer: null, rowH: 0 };
  const state = window.__ghTeamsTicker;

  const measureRow = () => {
    const first = track.firstElementChild;
    if (!first) return 0;
    const h = first.getBoundingClientRect().height;
    return Math.max(0, Math.round(h));
  };

  const rollOnce = () => {
    if (!track.firstElementChild) return;
    if (viewport.matches(':hover')) return;
    if (!state.rowH) state.rowH = measureRow();
    if (!state.rowH) return;

    track.style.transition = 'transform .55s cubic-bezier(.2,.8,.2,1)';
    track.style.transform = `translateY(-${state.rowH}px)`;

    setTimeout(() => {
      const first = track.firstElementChild;
      if (first) track.appendChild(first);
      track.style.transition = 'none';
      track.style.transform = 'translateY(0)';
      // Re-measure in case of wrap/responsive changes.
      state.rowH = measureRow();
    }, 620);
  };

  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  // Set a fixed viewport height so the board feels like an airport list.
  // Show ~8 rows (depending on font/line-wrapping).
  setTimeout(() => {
    state.rowH = measureRow();
    if (state.rowH) viewport.style.maxHeight = `${state.rowH * 8}px`;
  }, 0);

  state.timer = setInterval(rollOnce, 2500);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function burstConfettiOnce(key) {
  if (prefersReducedMotion()) return;

  try {
    // Versioned key so new deployments can celebrate once again.
    const storageKey = "gh_winners_celebrated_at_v2";
    const last = sessionStorage.getItem(storageKey) || "";
    if (last && last === String(key || "")) return;
    sessionStorage.setItem(storageKey, String(key || "1"));
  } catch {
    // ignore storage errors
  }

  const canvas = document.createElement("canvas");
  canvas.className = "gh-confetti-canvas";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const resize = () => {
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const colors = ["#64b8fc", "#ffffff", "#93c5fd", "#38bdf8", "#e2e8f0"];
  const particles = [];
  const count = 120;
  const gravity = 900;

  for (let i = 0; i < count; i++) {
    particles.push({
      x: window.innerWidth * (0.15 + Math.random() * 0.7),
      y: -20 - Math.random() * 60,
      vx: (-220 + Math.random() * 440),
      vy: (150 + Math.random() * 520),
      r: 2 + Math.random() * 4,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (-5 + Math.random() * 10),
      c: colors[Math.floor(Math.random() * colors.length)],
      a: 0.9,
    });
  }

  const start = performance.now();
  const ttl = 1800;

  const onResize = () => resize();
  window.addEventListener("resize", onResize);

  const draw = (t) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const dt = 1 / 60;
    particles.forEach((p) => {
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      // fade out near end
      if (elapsed > ttl * 0.7) p.a = Math.max(0, 0.9 * (1 - (elapsed - ttl * 0.7) / (ttl * 0.3)));

      ctx.save();
      ctx.globalAlpha = p.a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    if (elapsed < ttl) {
      requestAnimationFrame(draw);
    } else {
      window.removeEventListener("resize", onResize);
      canvas.remove();
    }
  };

  requestAnimationFrame(draw);
}

function renderWinners(flags, winners, teamsById) {
  const section = $("winnersSection");
  const tbody = $("winnersTbody");
  const hint = $("winnersHint");
  if (!section || !tbody) return;

  const enabled = !!flags?.show_winners;
  const list = Array.isArray(winners) ? winners : [];

  if (!enabled || !list.length) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";
  document.body?.classList?.add("gh-show-winners");
  // Slight delay helps ensure the canvas draws after layout/paint.
  setTimeout(() => burstConfettiOnce(flags?.show_winners_updated_at || "show_winners"), 120);

  if (hint) hint.textContent = `${list.length} winners`;

  const placeLabel = (p) => {
    const n = Number(p);
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  };

  const membersText = (m) => {
    if (!Array.isArray(m) || !m.length) return "-";
    return m.map((x) => {
      const name = x?.name ? String(x.name) : "";
      return name || "";
    }).filter(Boolean).join(", ");
  };

  tbody.innerHTML = list.map((w) => {
    const p = placeLabel(w?.place);
    const teamRow = (teamsById && w?.team_id) ? teamsById.get(String(w.team_id)) : null;
    const trackKey = String(teamRow?.track || w?.track || "").toLowerCase();
    const psStored = w?.problem_statement
      ? String(w.problem_statement)
      : (teamRow?.project_title ? String(teamRow.project_title) : "");
    const ps = psStored ? displayProblem(trackKey, psStored) : "";
    const trackName = trackKey || "";
    const rawTeam = String(w?.team_name || "-");
    const teamShort = rawTeam.length > 50 ? `${rawTeam.slice(0, 47)}...` : rawTeam;
    const team = escapeHtml(teamShort);
    const mem = escapeHtml(membersText(w?.members));
    return `
      <tr>
        <td class="gh-winners__place">${escapeHtml(p)}</td>
        <td class="gh-winners__track">${escapeHtml(trackName || "-")}</td>
        <td class="gh-winners__stmt">${escapeHtml(ps || "-")}</td>
        <td class="gh-winners__team" title="${escapeHtml(rawTeam)}">${team}</td>
        <td class="gh-winners__members">${mem}</td>
      </tr>
    `;
  }).join("");
}

(async () => {
  try {
    const updatedEl = $("dashUpdated");
    const refreshRateMs = 15000;

    const applyDashboardData = (data) => {
      setText("statTeams", data?.stats?.teams ?? 0);
      setText("statHackers", data?.stats?.hackers ?? 0);
      setText("statSubs", data?.stats?.submissions ?? 0);
      setText("statJudges", data?.stats?.judges ?? 0);
      if (data?.window?.end_at) startCountdown(data.window.end_at);

      const teams = data?.teams || [];
      const teamsById = new Map((teams || []).map((t) => [String(t.id), t]));
      renderWinners(data?.flags, data?.winners, teamsById);

      window.__ghRenderTeams = function () {
        renderTeamsList(teams, window.__ghActiveTrackKey || 'track1');
      };

      renderTrackCounts(data?.tracks || {});

      // Board-only mode: hide track UI and show a single airport-style teams board.
      document.body?.classList?.add('gh-board-only');
      const t = $("trackTitle");
      if (t) t.innerHTML = `Teams <span class="gh-dash-accent">Board</span>`;
      window.__ghRenderTeams();

      if (updatedEl) {
        updatedEl.textContent = `Last updated: ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      }
    };

    const first = await loadDashboard();
    applyDashboardData(first);
    const roadmapEvents = await loadRoadmapEvents();
    renderSchedule(roadmapEvents || []);

    // Auto-refresh dashboard data (no full page reload).
    window.__ghDashRefresh = window.__ghDashRefresh || { timer: null };
    if (window.__ghDashRefresh.timer) clearInterval(window.__ghDashRefresh.timer);
    window.__ghDashRefresh.timer = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await loadDashboard();
        applyDashboardData(next);
      } catch (e) {
        if (updatedEl) updatedEl.textContent = "Last updated: offline";
        // eslint-disable-next-line no-console
        console.warn("dashboard refresh:", e);
      }
    }, refreshRateMs);
  } catch (e) {
    const wrap = $("scheduleList");
    if (wrap) {
      wrap.innerHTML = `<div class="gh-dash-empty">Dashboard data unavailable.</div>`;
    }
    // eslint-disable-next-line no-console
    console.warn("dashboard:", e);
  }
})();
