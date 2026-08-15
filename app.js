// ProjectMetrix ideation prototype — quick & dirty by design. Not the product.
// State persists to localStorage so page refreshes keep your edits;
// "Reset demo" in the header returns to seed data.
// NOTE: bump this key whenever seedData()'s shape changes, or stale saved
// state shadows the new seed (design-log finding, 2026-08-07).
const SAVE_KEY = 'pmproto-v6';
const S = (() => {
  try { const s = localStorage.getItem(SAVE_KEY); if (s) return JSON.parse(s); } catch (e) { /* corrupt → reseed */ }
  return seedData();
})();
let currentProject = 'p1';
let currentTab = 'gantt';
let selectedTask = null;
let pendingAction = null;   // chat write gate
let dragId = null;          // WBS drag & drop
let baselineView = null;    // index of baseline being compared, null = off
let showLinks = true;       // dependency link lines on the chart
let cpOnly = false;         // critical-path-only filter
let impactResult = null;    // last action-item impact analysis
let impactSlipDays = 5;     // assumption behind the impact walk — user-adjustable
const NOTES_MAX = 2500;     // per-task free-text notes limit
S.audit = S.audit || [];    // chat/UI write trail
S.approvedReport = S.approvedReport || null;

// Baselines: the CURRENT version is the only editable one; a baseline is a
// named, immutable snapshot of it. Viewing a baseline is read-only;
// reverting promotes the snapshot to current. (No seeded baseline —
// removed 2026-08-07.)
S.namedBaselines = S.namedBaselines || {};  // per project: [{name, takenAt, plan, sched}]
function latestBaselineSched() {
  const l = S.namedBaselines[currentProject] || [];
  return l.length ? l[l.length - 1].sched : null;
}

// ── Undo: snapshot stack over plan + assignments (every Gantt action) ──
const U = [];
function snapshot() {
  U.push({ projectId: currentProject, json: JSON.stringify({ plan: S.plans[currentProject], assignments: S.assignments }) });
  if (U.length > 60) U.shift();
}

const $ = sel => document.querySelector(sel);
const CURRENT_USER = 'u3';   // "logged in as" — Rajesh Ramani in the fake directory

/** Live (not soft-deleted) entities. Archived rows stay visible but muted. */
const liveProjects = () => S.projects.filter(p => !p.deletedAt);
const livePrograms = () => S.programs.filter(g => !g.deletedAt);
let lastEngineMs = 0;       // set by renderGantt, shown in the perf badge

// Perf-test fixture: ~20 phases × (58 tasks in 3 parallel chains + milestone)
// = 1,200 rows, phases chained via milestones. Deliberately naive rendering
// downstream — the point is to SEE where time goes at scale.
function genBigPlan(phases = 20, perPhase = 58) {
  const tasks = [], deps = [];
  let prevMilestone = null;
  for (let p = 1; p <= phases; p++) {
    const sid = 'bp' + p;
    tasks.push({ id: sid, name: `Phase ${String(p).padStart(2, '0')}`, kind: 'summary', parentId: null });
    const chains = [[], [], []];
    for (let i = 1; i <= perPhase; i++) {
      const id = `b${p}_${i}`;
      tasks.push({ id, name: `P${p} task ${i}`, kind: 'task', parentId: sid, duration: 1 + (i * 7) % 9, pct: p <= phases / 3 ? 100 : p <= phases / 2 ? (i * 13) % 100 : 0 });
      const chain = chains[i % 3];
      if (chain.length) deps.push({ pred: chain[chain.length - 1], succ: id, type: i % 9 === 0 ? 'SS' : 'FS', lag: i % 9 === 0 ? 2 : 0 });
      else if (prevMilestone) deps.push({ pred: prevMilestone, succ: id, type: 'FS', lag: 0 });
      chain.push(id);
    }
    const mid = 'bm' + p;
    tasks.push({ id: mid, name: `Phase ${p} complete`, kind: 'milestone', parentId: sid, pct: 0 });
    chains.forEach(ch => { if (ch.length) deps.push({ pred: ch[ch.length - 1], succ: mid, type: 'FS', lag: 0 }); });
    prevMilestone = mid;
  }
  return { start: '2026-08-03', tasks, deps };
}
const plan = () => S.plans[currentProject];
const sched = () => Engine.compute(plan());
const leaves = () => plan().tasks.filter(t => t.kind !== 'summary');
const taskById = id => plan().tasks.find(t => t.id === id);
const todayStr = Engine.fmtDate(new Date());
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtShort(iso) {
  const d = Engine.parseDate(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}
function audit(action, detail) {
  S.audit.unshift({ at: new Date().toLocaleTimeString(), action, detail });
}

// ───────────────────────── Tabs & shell ─────────────────────────

const TABS = [
  ['portfolio', 'Portfolio'], ['details', 'Details'], ['gantt', 'Gantt'], ['status', 'Status'],
  ['risks', 'Risks'], ['actions', 'Action Items'], ['okrs', 'OKRs'], ['inbox', 'Agent Inbox'], ['chatlog', 'Chat Log'],
];
let selectedProgram = null;
S.chatLog = S.chatLog || [];

function renderShell() {
  const sel = $('#projectSelect');
  sel.innerHTML = liveProjects().map(p =>
    `<option value="${p.id}" ${p.id === currentProject ? 'selected' : ''}>${esc(p.name)}${p.archivedAt ? ' (archived)' : ''}</option>`).join('');
  sel.onchange = e => { currentProject = e.target.value; selectedTask = null; render(); };

  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage full/blocked — stay in-memory */ }

  renderCrumbs();

  const proposed = S.agentInbox.filter(a => a.status === 'proposed').length;
  const frCount = S.chatLog.filter(c => c.fr).length;
  $('#tabs').innerHTML = TABS.map(([id, label]) => {
    const badge = id === 'inbox' && proposed ? proposed : id === 'chatlog' && frCount ? frCount : 0;
    return `<button class="${currentTab === id ? 'active' : ''}" onclick="UI.tab('${id}')">${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  }).join('');
}

// Org-scoped tabs stop at the portfolio; the rest are project-scoped and
// show the full Portfolio → Program → Project path.
const ORG_TABS = new Set(['portfolio', 'okrs', 'inbox', 'chatlog']);

function renderCrumbs() {
  const label = TABS.find(([id]) => id === currentTab)?.[1] || '';
  const crumbs = [{ text: S.portfolios[0].name, go: `UI.tab('portfolio')` }];
  if (!ORG_TABS.has(currentTab)) {
    const proj = S.projects.find(p => p.id === currentProject);
    const prog = proj && S.programs.find(g => g.id === proj.programId);
    if (prog) crumbs.push({ text: prog.name, go: `UI.tab('portfolio')` });
    else if (proj) crumbs.push({ text: 'Standalone', go: `UI.tab('portfolio')` });
    if (proj) crumbs.push({ text: proj.name, go: `UI.openProject('${proj.id}')` });
  }
  const trail = crumbs.map(c => `<a href="#" onclick="${c.go};return false">${esc(c.text)}</a>`).join('<i>›</i>');
  const bl = baselineView != null ? (S.namedBaselines[currentProject] || [])[baselineView] : null;
  $('#crumbs').innerHTML = `${trail}<i>›</i><span class="here">${esc(label)}</span>` +
    (bl && currentTab === 'gantt' ? `<span class="chip amber" style="margin-left:8px">🔒 baseline: ${esc(bl.name)}</span>` : '') +
    (cpOnly && currentTab === 'gantt' ? `<span class="chip green" style="margin-left:6px">🎯 critical path only</span>` : '');
}

function render() {
  const t0 = performance.now();
  renderShell();
  const r = { portfolio: renderPortfolio, details: renderProjectDetails, gantt: renderGantt, status: renderStatus, risks: renderRisks, actions: renderActions, okrs: renderOKRs, inbox: renderInbox, chatlog: renderChatLog };
  $('#content').innerHTML = r[currentTab]();
  const script = performance.now() - t0;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const pb = $('#perfbadge');
    if (pb) pb.textContent =
      `engine ${lastEngineMs.toFixed(1)} ms · script ${script.toFixed(0)} ms · to-paint ${(performance.now() - t0).toFixed(0)} ms · ${plan().tasks.length} rows`;
  }));
}

// ───────────────────────── Gantt ─────────────────────────

const ZOOMS = { day: 22, week: 5, month: 1.35 };   // pixels per working day
let zoom = 'day';

function depth(t) { let d = 0, cur = t; while (cur.parentId) { cur = taskById(cur.parentId); d++; } return d; }

// [startIndex, endIndexExclusive] of a task + its (contiguous) subtree
function subtreeBlock(id) {
  const ts = plan().tasks;
  const start = ts.findIndex(t => t.id === id);
  const ids = new Set([id]);
  let end = start + 1;
  while (end < ts.length && ids.has(ts[end].parentId)) { ids.add(ts[end].id); end++; }
  return [start, end];
}
function topLevelAncestor(id) {
  let t = taskById(id);
  while (t.parentId) t = taskById(t.parentId);
  return t;
}
function focusName(id) {
  setTimeout(() => { const el = document.getElementById('nm-' + id); if (el) { el.focus(); el.select(); } }, 0);
}

function renderGantt() {
  const bl = S.namedBaselines[currentProject] || [];
  const bview = baselineView != null ? bl[baselineView] : null;
  const RO = !!bview;                    // read-only baseline view
  const vp = RO ? bview.plan : plan();   // the plan being displayed
  const e0 = performance.now();
  const sc = RO ? Engine.compute(vp) : sched();
  lastEngineMs = performance.now() - e0;
  const tasks = vp.tasks;
  const tById = id => vp.tasks.find(x => x.id === id);
  const depthOf = t => { let d = 0, c = t; while (c.parentId) { c = tById(c.parentId); d++; } return d; };
  const PX = ZOOMS[zoom];
  const span = sc.projectFinish + (zoom === 'day' ? 4 : 2);
  const chartW = Math.max(span * PX, 400);

  const dayTab = Engine.dayTable(vp.start, span);
  // Axis ticks follow the zoom level: day → every working week,
  // week → every 4 weeks, month → month boundaries.
  let axis = '';
  if (zoom === 'month') {
    let lastMonth = '';
    for (let o = 0; o <= span; o++) {
      const mo = dayTab[o].slice(0, 7);
      if (mo !== lastMonth) {
        lastMonth = mo;
        const d = Engine.parseDate(dayTab[o]);
        axis += `<div style="left:${o * PX}px">${d.toLocaleDateString('en-US', { month: 'short' })}${d.getMonth() === 0 ? " '" + String(d.getFullYear()).slice(2) : ''}</div>`;
      }
    }
  } else {
    const step = zoom === 'week' ? 20 : 5;
    for (let o = 0; o <= span; o += step) {
      axis += `<div style="left:${o * PX}px">${fmtShort(dayTab[o])}</div>`;
    }
  }
  let todayLine = '';
  if (todayStr >= vp.start) {
    const off = Engine.dateToOffset(vp.start, todayStr);
    if (off <= span) todayLine = `<div class="todayline" style="left:${off * PX}px"></div>`;
  }

  const resOpts = sel => `<option value="">—</option>` + S.resources.map(r =>
    `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');

  // Display IDs are ROW NUMBERS, recomputed every render — inserting or
  // moving tasks renumbers them AND every predecessor reference shown,
  // because dependencies are stored by stable internal id underneath.
  const rowNum = {};
  tasks.forEach((t, i) => { rowNum[t.id] = i + 1; });

  // Critical-path filter. Row numbers above are computed over the FULL plan
  // and never renumber — otherwise the Preds column would silently point at
  // different tasks while filtered. We only hide rows, never renumber them.
  const visible = cpOnly
    ? tasks.filter(t => sc.tasks[t.id]?.critical)
    : tasks;
  const predsStr = t => vp.deps.filter(d => d.succ === t.id)
    .map(d => `${rowNum[d.pred]}${d.type}${d.lag ? (d.lag > 0 ? '+' + d.lag : d.lag) : ''}`).join(',');

  const yCenter = {};   // vertical center of each task's chart row
  let rowIdx = 0;

  let names = `<div class="gantt-row ghead">
    <div class="c-id">#</div><div class="c-cri" title="critical — zero float">CRI</div><div class="c-note" title="task notes">✎</div><div class="c-name">Task</div><div class="c-dur">Dur</div><div class="c-date">Start</div>
    <div class="c-date">Finish</div><div class="c-pct">%</div><div class="c-res">Resource</div><div class="c-preds">Preds</div><div class="c-cons">Constraint</div></div>`;
  let rows = '';
  visible.forEach(t => {
    const r = sc.tasks[t.id];
    if (!r && t.kind !== 'summary') return;
    const ind = 6 + depthOf(t) * 14;
    const primaryRes = S.assignments.find(a => a.taskId === t.id)?.resourceId || '';
    const cons = t.constraint;
    const consCell = t.kind === 'summary' || !cons
      ? '<div class="c-cons"></div>'
      : `<div class="c-cons"><span class="chip" title="the engine schedules this task no earlier than this date; dependencies can still push it later">${cons.type} ${fmtShort(Engine.fmtDate(Engine.offsetToDate(vp.start, cons.offset)))}</span>${RO ? '' : `<a href="#" class="consx" title="remove constraint (back to ASAP)" onclick="UI.clearConstraint('${t.id}');return false">✕</a>`}</div>`;
    let cells;
    const predsCell = t.kind === 'summary'
      ? `<div class="c-preds muted"></div>`
      : `<div class="c-preds"><input value="${predsStr(t)}" placeholder="e.g. 3FS+2"
           title="comma-separated: rowNumber + FS/SS/FF/SF + lag, e.g. 3FS+2,5SS"
           onchange="UI.setPreds('${t.id}',this.value)"></div>`;
    if (t.kind === 'summary') {
      cells = r
        ? `<div class="c-dur muted">${r.dur}d</div><div class="c-date muted">${fmtShort(r.startDate)}</div>
           <div class="c-date muted">${fmtShort(r.finishDate)}</div><div class="c-pct"></div><div class="c-res"></div>`
        : `<div class="c-dur muted">—</div><div class="c-date muted">empty group</div><div class="c-date muted">—</div><div class="c-pct"></div><div class="c-res"></div>`;
    } else if (t.kind === 'milestone') {
      cells = `<div class="c-dur muted">—</div>
        <div class="c-date"><input type="date" value="${r.startDate}" onchange="UI.cellStart('${t.id}',this.value)"></div>
        <div class="c-date muted">${fmtShort(r.startDate)}</div><div class="c-pct"></div><div class="c-res"></div>`;
    } else {
      cells = `<div class="c-dur"><input type="number" min="1" value="${t.duration}" onchange="UI.cellDur('${t.id}',this.value)"></div>
        <div class="c-date"><input type="date" value="${r.startDate}" onchange="UI.cellStart('${t.id}',this.value)"></div>
        <div class="c-date"><input type="date" value="${r.finishDate}" onchange="UI.cellFinish('${t.id}',this.value)"></div>
        <div class="c-pct"><input type="number" min="0" max="100" value="${t.pct || 0}" onchange="UI.cellPct('${t.id}',this.value)"></div>
        <div class="c-res"><select onchange="UI.cellRes('${t.id}',this.value)">${resOpts(primaryRes)}</select></div>`;
    }
    cells += predsCell + consCell;
    names += `<div class="gantt-row ${selectedTask === t.id ? 'selected' : ''}"
        ondragover="UI.dragOver(event)" ondragleave="UI.dragLeave(event)" ondrop="UI.drop(event,'${t.id}')">
      <div class="c-id muted">${rowNum[t.id]}</div>
      <div class="c-cri">${r && r.critical
        ? `<span class="cri-dot ${cpOnly ? 'cp' : ''} ${t.kind === 'summary' ? 'sum' : ''}" title="${t.kind === 'summary' ? 'contains critical tasks' : `critical — zero float, delays here push the finish date`}">◆</span>`
        : r && t.kind !== 'summary' ? `<span class="cri-float" title="${r.float} working day(s) of float">${r.float}d</span>` : ''}</div>
      <div class="c-note">${t.kind === 'summary' ? '' : `<button class="notebtn ${t.notes ? 'has' : ''}"
        onclick="UI.openNotes('${t.id}')"
        title="${t.notes ? esc(t.notes.slice(0, 120)) + (t.notes.length > 120 ? '…' : '') : 'Add notes'}">${t.notes ? '📝' : '✎'}</button>`}</div>
      <div class="c-name" style="padding-left:${ind}px">
        <span class="handle" draggable="${!cpOnly}" ondragstart="UI.dragStart(event,'${t.id}')"
          onclick="UI.selectTask('${t.id}')" title="${cpOnly ? 'click to select (reordering is off while filtered)' : 'drag to move · click to select'}">⠿</span>
        <input id="nm-${t.id}" class="nm-input ${t.kind}" value="${esc(t.name)}" onchange="UI.renameTask('${t.id}',this.value)">
        ${cpOnly ? '' : `<span class="rowacts">
          <button title="add task above" onclick="UI.addAbove('${t.id}')">＋↑</button>
          <button title="add task below" onclick="UI.addBelow('${t.id}')">＋↓</button>
          <button title="indent — make subtask of the task above" onclick="UI.indent('${t.id}')">→</button>
          ${t.parentId ? `<button title="outdent — promote a level" onclick="UI.outdent('${t.id}')">←</button>` : ''}
        </span>`}
      </div>
      ${cells}
    </div>`;
    let bar = '';
    if (!r) {
      // empty group — no schedule yet
    } else if (t.kind === 'milestone') {
      bar = `<div class="ms ${r.critical ? (cpOnly ? 'cp' : 'critical') : ''}" style="left:${r.es * PX - 6}px" title="${esc(t.name)} · ${fmtShort(r.startDate)}"></div>`;
    } else if (t.kind === 'summary') {
      bar = `<div class="bar summary" style="left:${r.es * PX}px;width:${Math.max(r.dur * PX, 6)}px" title="${esc(t.name)} · ${fmtShort(r.startDate)} → ${fmtShort(r.finishDate)}"></div>`;
    } else {
      const w = Math.max(r.dur * PX - (zoom === 'day' ? 2 : 0), zoom === 'day' ? 8 : 2);
      bar = `<div class="bar ${r.critical ? (cpOnly ? 'cp' : 'critical') : ''}" style="left:${r.es * PX}px;width:${w}px"
               title="${esc(t.name)} · ${fmtShort(r.startDate)} → ${fmtShort(r.finishDate)} · float ${r.float}d">
               <div class="prog" style="width:${(t.pct || 0)}%"></div></div>`;
      if (zoom === 'day' && !r.critical && r.float > 0)
        bar += `<div class="float-lbl" style="left:${r.ef * PX + 4}px">+${r.float}d</div>`;
    }
    rows += `<div class="rowline" onclick="UI.selectTask('${t.id}')">${bar}</div>`;
    yCenter[t.id] = 26 + rowIdx * 28 + 14;
    rowIdx++;
  });

  // Dependency link lines — anchor points depend on the link type:
  // FS: pred finish → succ start · SS: start → start · FF: finish → finish · SF: pred start → succ finish
  let linksSvg = '';
  if (showLinks) {
    const chartH = 26 + rowIdx * 28;
    let paths = '';
    vp.deps.forEach(d => {
      const p = sc.tasks[d.pred], s = sc.tasks[d.succ];
      const pt = tById(d.pred), st = tById(d.succ);
      if (!p || !s || !pt || !st || pt.kind === 'summary' || st.kind === 'summary') return;
      if (yCenter[d.pred] == null || yCenter[d.succ] == null) return;   // endpoint hidden by a filter
      const px = (d.type === 'SS' || d.type === 'SF') ? p.es * PX : p.ef * PX;
      const sx = (d.type === 'FF' || d.type === 'SF') ? s.ef * PX : s.es * PX;
      const y1 = yCenter[d.pred], y2 = yCenter[d.succ];
      const crit = p.critical && s.critical;
      const stroke = crit ? (cpOnly ? '#16a34a' : '#dc2626') : '#94a3b8';
      const marker = crit ? (cpOnly ? 'arr-cp' : 'arr-r') : 'arr-g';
      paths += `<path d="M ${px} ${y1} L ${px + 8} ${y1} L ${px + 8} ${(y1 + y2) / 2} L ${sx - 8} ${(y1 + y2) / 2} L ${sx - 8} ${y2} L ${sx} ${y2}"
        fill="none" stroke="${stroke}" stroke-width="1.3" opacity="0.8"
        marker-end="url(#${marker})"><title>${esc(pt.name)} →${d.type}${d.lag ? (d.lag > 0 ? '+' + d.lag : d.lag) + 'd' : ''} ${esc(st.name)}</title></path>`;
    });
    linksSvg = `<svg class="deplines" width="${chartW}" height="${chartH}">
      <defs>
        <marker id="arr-g" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#94a3b8"/></marker>
        <marker id="arr-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#dc2626"/></marker>
        <marker id="arr-cp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#16a34a"/></marker>
      </defs>${paths}</svg>`;
  }

  const diag = sc.diagnostics.length
    ? `<div class="panel" style="border-color:#fca5a5"><h3>Engine diagnostics</h3>${sc.diagnostics.map(d => `<div>⚠️ [${d.code}] ${esc(d.message)}</div>`).join('')}</div>` : '';

  return `
    ${RO ? `<div class="robanner">🔒 <b>READ-ONLY</b>&nbsp;— viewing baseline "${esc(bview.name)}" · taken ${fmtShort(bview.takenAt)} · editing disabled
        <span class="spacer"></span>
        <button class="btn" onclick="UI.selectBaseline('')">← Back to current version</button>
        <button class="btn danger" onclick="UI.revertBaseline()">Revert — make this the current version</button>
      </div>` : ''}
    <div class="toolbar">
      ${RO ? '' : `<button class="btn" onclick="UI.addTask()">+ Task</button>
      <button class="btn" onclick="UI.addMilestone()">+ Milestone</button>
      <button class="btn" onclick="UI.addGroup()">+ Group</button>
      <button class="btn" onclick="UI.undo()" ${U.length ? '' : 'disabled'}>↶ Undo (${U.length})</button>`}
      <span class="spacer"></span>
      <select id="blsel" class="btn" onchange="UI.selectBaseline(this.value)">
        <option value="">Current version (editable)</option>
        ${bl.map((b, i) => `<option value="${i}" ${i === baselineView ? 'selected' : ''}>${esc(b.name)} · ${fmtShort(b.takenAt)}</option>`).join('')}
      </select>
      ${RO ? '' : `<button class="btn" onclick="UI.takeBaseline()">📷 Save as baseline</button>
      <label class="chip grey" title="project start — ASAP tasks with no predecessors begin here">start:
        <input type="date" value="${vp.start}" onchange="UI.setProjectStart(this.value)" style="border:none;background:none;font-size:11px;width:108px"></label>`}
      <span class="chip grey">finish: <b>${fmtShort(sc.finishDate)}</b></span>
      <button class="btn ${cpOnly ? 'cpon' : ''}" onclick="UI.toggleCP()" title="show only the tasks with zero float — the chain that sets the finish date">🎯 ${cpOnly ? 'Critical path only' : 'Critical path'}</button>
      <span class="chip ${cpOnly ? 'green' : 'red'}">critical: ${sc.criticalPath.length} tasks</span>
      <span class="zoomgrp">${['day', 'week', 'month'].map(z =>
        `<button class="btn small ${zoom === z ? 'primary' : ''}" onclick="UI.setZoom('${z}')">${z[0].toUpperCase() + z.slice(1)}</button>`).join('')}</span>
      <button class="btn" onclick="UI.toggleLinks()" title="show/hide dependency link lines">${showLinks ? '⇢ links on' : '⇢ links off'}</button>
      ${RO ? '' : `<button class="btn" onclick="UI.genBigProject()" title="generate a 1,200-row project to feel edit latency at scale">⚡ 1k-task test</button>`}
    </div>
    ${diag}
    <div class="panel nopad ${RO ? 'readonly' : ''}">
      <div class="gantt-scroll"><div class="gantt">
        <div class="gantt-names">${names}</div>
        <div class="gantt-chart" style="width:${chartW}px;min-width:${chartW}px">
          <div class="gantt-axis" style="width:${chartW}px">${axis}</div>
          ${todayLine}${rows}${linksSvg}
        </div>
      </div></div>
    </div>
    ${RO ? '' : selectedTask ? renderTaskDetail() : '<div class="panel" style="color:var(--muted2)">Click a ⠿ handle or a bar to open the task detail panel. Every edit recomputes through the engine and is undoable.</div>'}
    <div class="panel"><h3>Activity (every Gantt action — undo walks back through these)</h3>
      ${S.audit.slice(0, 8).map(a => `<div style="font-size:12px"><span class="chip grey">${a.at}</span> <b>${esc(a.action)}</b> ${esc(a.detail)}</div>`).join('') || '<span style="color:var(--muted2)">nothing yet</span>'}</div>`;
}

function renderTaskDetail() {
  const t = taskById(selectedTask);
  if (!t) return '';
  const sc = sched();
  const r = sc.tasks[t.id];
  const myDeps = plan().deps.filter(d => d.succ === t.id);
  const asg = S.assignments.filter(a => a.taskId === t.id)
    .map(a => S.resources.find(x => x.id === a.resourceId)?.name).filter(Boolean);
  const others = leaves().filter(x => x.id !== t.id);

  return `<div class="panel">
    <h3>${esc(t.name)} — ${r.startDate} → ${r.finishDate} · float ${r.float}d ${r.critical ? '· <span class="chip red">critical</span>' : ''}</h3>
    <div class="detail">
      ${t.kind === 'task' ? `
      <div><label>Duration (working days)</label><input type="number" min="1" id="ed-dur" value="${t.duration}"></div>
      <div><label>% complete</label><input type="number" min="0" max="100" id="ed-pct" value="${t.pct || 0}"></div>` : ''}
      <button class="btn primary" onclick="UI.applyTaskEdit()">Apply</button>
      <button class="btn danger" onclick="UI.deleteTask()">Delete</button>
      <div style="flex-basis:100%"></div>
      <div>
        <label>Predecessors</label>
        ${myDeps.map(d => `<span class="chip">${esc(taskById(d.pred)?.name || d.pred)} ${d.type}${d.lag ? '+' + d.lag + 'd' : ''}
          <a href="#" onclick="UI.removeDep('${d.pred}','${d.succ}');return false">✕</a></span>`).join(' ') || '<span class="chip grey">none</span>'}
      </div>
      <div><label>Add predecessor</label>
        <select id="ed-pred">${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select>
        <select id="ed-deptype" style="width:60px"><option>FS</option><option>SS</option><option>FF</option><option>SF</option></select>
        <input id="ed-lag" type="number" value="0" style="width:56px" title="lag (days)">
        <button class="btn small" onclick="UI.addDepFromEditor()">Add</button>
      </div>
      <div><label>Assigned</label>${asg.map(n => `<span class="chip">${esc(n)}</span>`).join(' ') || '<span class="chip grey">nobody</span>'}</div>
    </div>
  </div>`;
}

// ───────────────────────── Status ─────────────────────────

function sentimentOf(text) {
  return /worried|cagey|anxious|slip|behind|risk/i.test(text) ? -1 : /on track|great|ahead|good/i.test(text) ? 1 : 0;
}

function renderStatus() {
  const roll = projectRollup(currentProject);
  const sc = roll.sc;
  const base = latestBaselineSched();

  const milestones = plan().tasks.filter(t => t.kind === 'milestone').map(t => {
    const cur = sc.tasks[t.id], b = base?.tasks[t.id];
    // Without a baseline there is nothing to be "on plan" against — say so
    // rather than showing a green "on plan" derived from a zero default.
    const variance = !b ? '<span class="chip grey">no baseline</span>'
      : cur.es - b.es > 0 ? `<span class="chip red">+${cur.es - b.es}d</span>`
      : cur.es - b.es < 0 ? `<span class="chip green">${cur.es - b.es}d</span>`
      : '<span class="chip green">on plan</span>';
    return `<tr><td>${esc(t.name)}</td><td>${b ? fmtShort(b.startDate) : '—'}</td><td>${fmtShort(cur.startDate)}</td><td>${variance}</td></tr>`;
  }).join('');

  const risks = S.risks.filter(r => r.projectId === currentProject && r.status !== 'closed')
    .sort((a, b) => b.probability * b.impact - a.probability * a.impact).slice(0, 3);
  const ais = S.actionItems.filter(a => a.projectId === currentProject && a.status === 'open');
  const checkins = S.checkIns.filter(c => c.projectId === currentProject);
  const anxious = checkins.some(c => sentimentOf(c.body) < 0);

  return `
    <div class="statgrid">
      <div class="stat"><div class="l">RAG (computed)</div><div class="v"><span class="chip ${roll.rag}">${roll.rag}</span></div></div>
      <div class="stat" title="delivered progress ÷ progress the plan expected by today, duration-weighted">
        <div class="l">Schedule performance</div><div class="v">${roll.spi == null ? '—' : roll.spi.toFixed(2)}</div></div>
      <div class="stat"><div class="l">Complete / expected</div><div class="v">${Math.round(roll.pct * 100)}% <span style="font-size:13px;color:var(--muted2)">/ ${Math.round(roll.plannedPct * 100)}%</span></div></div>
      <div class="stat"><div class="l">Finish vs baseline</div><div class="v">${roll.slip == null ? '—' : (roll.slip > 0 ? '+' : '') + roll.slip + 'd'}</div></div>
      <div class="stat"><div class="l">Open / overdue actions</div><div class="v">${ais.length} / <span style="color:var(--red)">${roll.overdue}</span></div></div>
    </div>
    <div class="panel"><h3>Why this RAG</h3>
      <div style="font-size:13px">${roll.reasons.map(r => `· ${esc(r)}`).join('<br>')}</div>
      <div style="font-size:12px;color:var(--muted2);margin-top:6px">
        Computed from schedule, baseline slip, open risk scores and overdue actions — the same rollup the Portfolio
        and Details tabs use. ${roll.hasBaseline ? '' : 'No baseline taken yet, so slip and schedule performance measure against the current plan.'}</div></div>
    <div class="panel"><h3>Milestones vs baseline</h3>
      <table><tr><th>Milestone</th><th>Baseline</th><th>Current</th><th>Variance</th></tr>${milestones || '<tr><td colspan=4>none</td></tr>'}</table></div>
    <div class="panel"><h3>Top risks</h3>
      ${risks.map(r => `<div>· <b>${esc(r.title)}</b> <span class="chip ${scoreClass(r.probability * r.impact)}">P${r.probability}×I${r.impact}=${r.probability * r.impact}</span> <span class="chip grey">${r.status}</span></div>`).join('') || 'none'}</div>
    <div class="panel"><h3>Check-ins <span style="font-weight:400;color:var(--muted2);font-size:12px">(sentiment is a keyword mock — the real thing is LLM-classified with quoted evidence)</span></h3>
      ${checkins.map(c => { const s = sentimentOf(c.body); return `<div style="margin-bottom:6px"><b>${esc(c.author)}</b> <span class="chip grey">${fmtShort(c.date)}</span> <span class="chip ${s < 0 ? 'red' : s > 0 ? 'green' : 'grey'}">${s < 0 ? 'anxious' : s > 0 ? 'positive' : 'neutral'}</span><br>${esc(c.body)}</div>`; }).join('') || 'none'}
      ${roll.rag === 'green' && anxious ? '<div class="chip red">⚠ computed RAG is Green but check-ins read anxious — divergence flag</div>' : ''}</div>
    ${S.approvedReport ? `<div class="panel"><h3>Approved weekly report</h3><b>RAG:</b> ${S.approvedReport.rag} · <b>Highlights:</b> ${S.approvedReport.highlights.join('; ')} · <b>Lowlights:</b> ${S.approvedReport.lowlights.join('; ')}<br><i>${esc(S.approvedReport.sentiment)}</i></div>` : ''}`;
}

// ───────────────────────── Risks ─────────────────────────

const scoreClass = (s) => (s >= 12 ? 'red' : s >= 6 ? 'amber' : 'green');
const RISK_CATEGORIES = ['technical', 'vendor', 'resource', 'schedule', 'financial', 'compliance', 'organizational'];
const OWNER_OPTIONS = () => S.resources.map(r => r.name);

function renderRisks() {
  const risks = S.risks.filter(r => r.projectId === currentProject)
    .sort((a, b) => b.probability * b.impact - a.probability * a.impact);
  const num = (id, field, val) => `<input type="number" min="1" max="5" value="${val}" style="width:44px"
      onchange="UI.setRiskField('${id}','${field}',this.value)">`;
  return `
    <div class="panel"><h3>Risk register</h3>
    <table><tr><th>Risk</th><th>Category</th><th>P</th><th>I</th><th>Score</th><th>Status</th><th>Owner</th><th>Source</th><th></th></tr>
    ${risks.map(r => {
      const s = r.probability * r.impact;
      const closedish = r.status === 'closed' || r.status === 'realized';
      return `<tr${closedish ? ' style="opacity:.6"' : ''}>
      <td><b>${esc(r.title)}</b>
        <br><input value="${esc(r.mitigation || '')}" placeholder="mitigation…" style="width:96%;font-size:12px"
             onchange="UI.setRiskField('${r.id}','mitigation',this.value)"></td>
      <td><select onchange="UI.setRiskField('${r.id}','category',this.value)">
        ${['', ...RISK_CATEGORIES].map(c => `<option value="${c}" ${c === r.category ? 'selected' : ''}>${c || '—'}</option>`).join('')}</select></td>
      <td>${num(r.id, 'probability', r.probability)}</td><td>${num(r.id, 'impact', r.impact)}</td>
      <td><span class="chip ${scoreClass(s)}">${s}</span></td>
      <td><span class="chip grey">${r.status}</span></td>
      <td><select onchange="UI.setRiskField('${r.id}','owner',this.value)">
        ${['', ...OWNER_OPTIONS()].map(o => `<option value="${o}" ${o === r.owner ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select></td>
      <td>${r.source === 'agent' ? '<span class="chip">🤖 agent</span>' : 'human'}</td>
      <td>${closedish
        ? `<button class="btn small" onclick="UI.riskStatus('${r.id}','open')">reopen</button>`
        : `<button class="btn small" onclick="UI.riskStatus('${r.id}','mitigating')">mitigating</button>
           <button class="btn small" onclick="UI.riskStatus('${r.id}','closed')">close</button>
           <button class="btn small" onclick="UI.riskStatus('${r.id}','realized')">realized</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan=9 style="color:var(--muted2)">Register is empty.</td></tr>'}
    </table>
    <div style="font-size:12px;color:var(--muted2);margin-top:8px">
      Closing a risk as <b>realized</b> (rather than just closing it) is what makes this register minable by the
      Risk Agent later — it is the label that turns history into training data.</div></div>
    <div class="panel"><h3>Add risk</h3>
      <div class="detail">
        <div><label>Title</label><input id="rk-title" style="width:260px" placeholder="what could go wrong"></div>
        <div><label>Category</label><select id="rk-cat">${RISK_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>
        <div><label>Owner</label><select id="rk-owner"><option value="">—</option>${OWNER_OPTIONS().map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
        <div><label>Probability 1–5</label><input id="rk-p" type="number" min="1" max="5" value="3"></div>
        <div><label>Impact 1–5</label><input id="rk-i" type="number" min="1" max="5" value="3"></div>
        <div style="flex-basis:100%"></div>
        <div><label>Mitigation</label><input id="rk-mit" style="width:420px" placeholder="what we will do about it"></div>
        <button class="btn primary" onclick="UI.addRisk()">Add</button>
      </div></div>`;
}

// ───────────────────────── Action items ─────────────────────────

function renderActions() {
  const ais = S.actionItems.filter(a => a.projectId === currentProject);
  const taskOpts = sel => leaves().map(t =>
    `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  return `
    <div class="panel"><h3>Action items</h3>
    <table><tr><th>Item</th><th>Owner</th><th>Due</th><th>Status</th><th>Blocks</th><th></th></tr>
    ${ais.map(a => {
      const overdue = a.status === 'open' && a.due && a.due < todayStr;
      const blocks = (a.blockedTaskIds || []).map(id => taskById(id)?.name).filter(Boolean);
      const done = a.status !== 'open';
      return `<tr${done ? ' style="opacity:.6"' : ''}>
        <td><b>${esc(a.title)}</b> ${a.source === 'agent' ? '<span class="chip">🤖</span>' : ''}</td>
        <td><select onchange="UI.setActionField('${a.id}','owner',this.value)">
          ${['', ...OWNER_OPTIONS()].map(o => `<option value="${o}" ${o === a.owner ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select></td>
        <td><input type="date" value="${a.due || ''}" onchange="UI.setActionField('${a.id}','due',this.value)" style="width:120px">
            ${overdue ? '<span class="chip red">overdue</span>' : ''}</td>
        <td><span class="chip grey">${a.status}</span></td>
        <td>${blocks.map(b => `<span class="chip">${esc(b)}</span>`).join(' ') || '—'}</td>
        <td>${a.status === 'open' ? `
          <button class="btn small" onclick="UI.aiImpact('${a.id}')">impact</button>
          <button class="btn small" onclick="UI.aiRemind('${a.id}')">remind</button>
          <button class="btn small" onclick="UI.aiDone('${a.id}')">done</button>`
        : `<button class="btn small" onclick="UI.setActionField('${a.id}','status','open')">reopen</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan=6 style="color:var(--muted2)">No action items yet.</td></tr>'}
    </table></div>
    ${impactResult ? `<div class="panel" style="border-color:#fcd34d">
      <h3>Impact if "${esc(impactResult.title)}" slips
        <input type="number" min="1" max="60" value="${impactSlipDays}" style="width:52px"
               onchange="UI.setImpactSlip('${impactResult.id}',this.value)"> working days</h3>
      ${impactResult.html}
      <div style="font-size:12px;color:var(--muted2);margin-top:6px">
        Computed by re-running the engine with the blocked tasks pushed out — the same walk the Action Item Agent
        uses in its overdue+2 escalation email. Change the number to test a different assumption.</div></div>` : ''}
    <div class="panel"><h3>Add action item</h3>
      <div class="detail">
        <div><label>Title</label><input id="ai-title" style="width:280px" placeholder="what needs doing"></div>
        <div><label>Owner</label><select id="ai-owner"><option value="">—</option>${OWNER_OPTIONS().map(o => `<option>${esc(o)}</option>`).join('')}</select></div>
        <div><label>Due</label><input id="ai-due" type="date" value="${todayStr}"></div>
        <div><label>Blocks task (optional)</label><select id="ai-blocks"><option value="">—</option>${taskOpts()}</select></div>
        <button class="btn primary" onclick="UI.addActionItem()">Add</button>
      </div>
      <div style="font-size:12px;color:var(--muted2);margin-top:8px">
        Linking an item to the task it blocks is what makes the impact walk possible. "remind" queues email to the
        Outbox (sandbox: captured, never sent). The automatic ladder is agent-run: T-3 → due → +2 with impact → +7 escalate.</div></div>`;
}

// ───────────────────────── Directory & people pickers ─────────────────────────
// The directory stands in for LDAP/Entra/Okta. `account: 'directory'` marks
// people who can be NAMED but never log in (sponsors, SMEs, vendor contacts)
// — they must not consume a license seat.

const personById = id => S.people.find(p => p.id === id);
const personName = id => personById(id)?.name ?? '—';
const personLine = id => {
  const p = personById(id);
  return p ? `${p.name}<span class="pmeta"> · ${esc(p.title)}${p.account === 'directory' ? ' · no login' : ''}</span>` : '—';
};

/** Single-select person picker. */
function personSelect(selId, onchange, allowBlank = true) {
  const byDept = {};
  S.people.forEach(p => { (byDept[p.dept] ||= []).push(p); });
  return `<select onchange="${onchange}">
    ${allowBlank ? `<option value="">—</option>` : ''}
    ${Object.entries(byDept).map(([dept, ps]) => `<optgroup label="${esc(dept)}">
      ${ps.map(p => `<option value="${p.id}" ${p.id === selId ? 'selected' : ''}>${esc(p.name)} — ${esc(p.title)}</option>`).join('')}
    </optgroup>`).join('')}
  </select>`;
}

/** Multi-select as chips + an add dropdown; avoids a fiddly multi-select box. */
function personChips(ids, addHandler, removeHandler) {
  const chosen = new Set(ids || []);
  return `<div class="chiplist">
    ${(ids || []).map(id => `<span class="chip person">${personLine(id)}
      <a href="#" onclick="${removeHandler}('${id}');return false" title="remove">✕</a></span>`).join('') || '<span class="chip grey">nobody yet</span>'}
    <select onchange="${addHandler}(this.value); this.value='';">
      <option value="">+ add…</option>
      ${S.people.filter(p => !chosen.has(p.id)).map(p => `<option value="${p.id}">${esc(p.name)} — ${esc(p.title)}</option>`).join('')}
    </select></div>`;
}

// ───────────────────────── Modal dialogs ─────────────────────────

let modal = null;   // { title, bodyHtml, onSave, saveLabel, wide }

function openModal(spec) { modal = spec; renderModal(); }
function closeModal() { modal = null; renderModal(); }

function renderModal() {
  const host = $('#modal');
  if (!modal) { host.innerHTML = ''; host.classList.remove('open'); return; }
  host.classList.add('open');
  // Editing dialogs lock the backdrop: a stray click outside must never
  // discard typing. Only the explicit buttons close them.
  host.innerHTML = `<div class="modal-backdrop"${modal.lockBackdrop ? '' : ' onclick="UI.modalCancel()"'}></div>
    <div class="modal ${modal.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><b>${esc(modal.title)}</b>
        <a class="modal-x" onclick="UI.modalCancel()" title="cancel">✕</a></div>
      <div class="modal-body">${modal.bodyHtml}</div>
      <div class="modal-foot">
        <span id="modal-err" class="modal-err"></span>
        <button class="btn" onclick="UI.modalCancel()">Cancel</button>
        <button class="btn primary" onclick="UI.modalSave()">${esc(modal.saveLabel || 'Save')}</button>
      </div>
    </div>`;
  setTimeout(() => host.querySelector('input,textarea,select')?.focus(), 0);
}

const modalErr = msg => { const e = $('#modal-err'); if (e) e.textContent = msg; };

// Draft state for the create dialogs (people multi-selects need to persist
// across re-renders of the modal body).
let draft = null;

const nextId = (kind) => {
  S.seq[kind] = (S.seq[kind] || 0) + 1;
  return `${kind === 'program' ? 'PRG' : 'PRJ'}-${String(S.seq[kind]).padStart(4, '0')}`;
};

// ───────────────────────── Attribute definitions ─────────────────────────
// DECLARED attributes (a human states them) are editable here.
// COMPUTED attributes (engine/rollup owns them) are shown read-only below
// the form — never both. Target dates are declared *intent*; scheduled
// dates are computed *reality*; the variance between them is the signal.

const PROJECT_ATTRS = [
  ['Identity', [
    ['description', 'Short description', 'textarea'],
    ['scopeStatement', 'Scope statement', 'textarea'],
  ]],
  ['Classification', [
    ['investmentType', 'Investment type', 'select', ['run', 'grow', 'transform']],
    ['methodology', 'Methodology', 'select', ['waterfall', 'agile', 'hybrid']],
    ['priority', 'Priority', 'select', ['critical', 'high', 'medium', 'low']],
    ['phase', 'Stage gate', 'select', ['initiation', 'planning', 'execution', 'closing', 'closed']],
  ]],
  ['Commitment (declared intent)', [
    ['targetStartDate', 'Target start', 'date'],
    ['targetFinishDate', 'Target finish', 'date'],
  ]],
  ['Financial tracking', [
    ['budget', 'Baseline budget (BAC)', 'number'],
    ['acwp', 'Actual cost (ACWP)', 'number'],
    ['contingencyReserve', 'Contingency reserve', 'number'],
    ['currency', 'Currency', 'select', ['USD', 'EUR', 'GBP', 'INR']],
    ['costType', 'Capex / Opex', 'select', ['capex', 'opex', 'mixed']],
  ]],
  ['Value & governance', [
    ['expectedBenefit', 'Expected benefit', 'text'],
    ['benefitType', 'Benefit type', 'select', ['cost-saving', 'cost-avoidance', 'revenue', 'risk-reduction', 'compliance']],
    ['riskTolerance', 'Risk tolerance', 'select', ['low', 'medium', 'high']],
    ['complianceFlags', 'Compliance flags', 'text', 'SOX, GDPR, PCI…'],
  ]],
  ['External systems', [
    ['jiraProjectKey', 'Jira project key', 'text'],
    ['confluenceSpace', 'Confluence space', 'text'],
  ]],
];

const PROGRAM_ATTRS = [
  ['Identity', [
    ['description', 'Description', 'textarea'],
    ['strategicObjectives', 'Strategic objectives', 'textarea'],
  ]],
  ['Classification', [
    ['strategicTheme', 'Strategic theme', 'text'],
    ['status', 'Status', 'select', ['proposed', 'active', 'on_hold', 'closed']],
    ['priority', 'Priority', 'select', ['critical', 'high', 'medium', 'low']],
  ]],
  ['Commitment (declared intent)', [
    ['startDate', 'Target start', 'date'],
    ['targetEndDate', 'Target end', 'date'],
  ]],
  ['Financial', [
    ['budget', 'Approved total budget', 'number'],
    ['ytdSpend', 'Year-to-date spend', 'number'],
    ['currency', 'Currency', 'select', ['USD', 'EUR', 'GBP', 'INR']],
    ['fundingSource', 'Funding source', 'select', S.fundingSources],
    ['roiTargetPct', 'ROI target %', 'number'],
    ['governanceCadence', 'Steering cadence', 'select', ['weekly', 'monthly', 'quarterly']],
  ]],
];

function attrForm(kind, id, spec, attrs) {
  return spec.map(([group, fields]) => `<div class="attrgrp"><h4>${esc(group)}</h4><div class="attrs">` +
    fields.map(([k, label, type, extra]) => {
      const v = attrs[k] ?? '';
      const oc = `UI.setAttr('${kind}','${id}','${k}',this.value)`;
      let input;
      if (type === 'select') input = `<select onchange="${oc}">${['', ...extra].map(o => `<option value="${o}" ${o === v ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select>`;
      else if (type === 'textarea') input = `<textarea rows="2" onchange="${oc}" placeholder="${esc(extra || '')}">${esc(v)}</textarea>`;
      else input = `<input type="${type === 'number' ? 'number' : type}" value="${esc(v)}" placeholder="${esc(extra || '')}" onchange="${oc}">`;
      return `<label class="attr ${type === 'textarea' ? 'wide' : ''}"><span>${esc(label)}</span>${input}</label>`;
    }).join('') + `</div></div>`).join('');
}

const money = (n, cur) => n ? `${cur || 'USD'} ${Number(n).toLocaleString()}` : '—';

function renderProjectDetails() {
  const proj = S.projects.find(p => p.id === currentProject);
  proj.attrs = proj.attrs || {};
  const a = proj.attrs;
  const roll = projectRollup(currentProject);
  const prog = S.programs.find(g => g.id === proj.programId);
  // Declared intent vs computed reality — the governance signal.
  const tgt = a.targetFinishDate;
  const variance = tgt && roll.finish ? Math.round((Engine.parseDate(roll.finish) - Engine.parseDate(tgt)) / 86400000) : null;
  /**
   * Cost performance, not raw burn. "26% spent" means nothing on its own —
   * it is good news at 40% delivered and bad news at 10%. This is delivered
   * progress ÷ budget consumed: above 1.00 means we are getting more
   * delivery than we are paying for. (Replaces the bare burn % — an
   * invented metric flagged as an invented metric.)
   */
  const burnPct = a.budget ? (a.actualCost || 0) / a.budget : null;
  const cpi = burnPct ? roll.pct / burnPct : null;

  return `<div class="panel"><h3>Computed — engine &amp; rollup own these (read-only)</h3>
      <div class="statgrid">
        <div class="stat"><div class="l">Scheduled finish</div><div class="v">${roll.finish ? fmtShort(roll.finish) : '—'}</div></div>
        <div class="stat"><div class="l">vs target finish</div><div class="v" style="color:${variance > 0 ? 'var(--red)' : 'var(--green)'}">${variance == null ? '—' : (variance > 0 ? `+${variance}d late` : `${Math.abs(variance)}d early`)}</div></div>
        <div class="stat"><div class="l">Progress</div><div class="v">${Math.round(roll.pct * 100)}%</div></div>
        <div class="stat"><div class="l">Rolled-up RAG</div><div class="v"><span class="chip ${roll.rag}">${roll.rag}</span></div></div>
        <div class="stat" title="delivered progress ÷ budget consumed · above 1.00 = more delivery than spend">
          <div class="l">Cost performance</div>
          <div class="v" style="color:${cpi == null ? 'inherit' : cpi < 0.9 ? 'var(--red)' : cpi < 1 ? 'var(--amber)' : 'var(--green)'}">${cpi == null ? '—' : cpi.toFixed(2)}</div></div>
        <div class="stat"><div class="l">Tasks / open risks</div><div class="v">${roll.tasks} / ${roll.risks}</div></div>
      </div>
      <div style="font-size:12px;color:var(--muted2);margin-top:8px">
        Budget ${money(a.budget, a.currency)} · spent ${money(a.actualCost, a.currency)}
        ${burnPct == null ? '' : `(${Math.round(burnPct * 100)}% consumed for ${Math.round(roll.pct * 100)}% delivered)`} ·
        program: ${prog ? esc(prog.name) : 'standalone'}
        <br>RAG reasons: ${roll.reasons.map(esc).join(' · ')}</div>
    </div>
    <div class="panel"><h3>Declared attributes — ${esc(proj.name)}
      <span class="chip grey">${esc(a.projectId || '')}</span> ${lifecycleChip(proj)}</h3>
      <div class="attrs">
        <label class="attr"><span>Name</span><input value="${esc(proj.name)}" onchange="UI.setAttr('project','${proj.id}','name',this.value)"></label>
        <label class="attr"><span>Project ID (generated)</span><input value="${esc(a.projectId || '')}" readonly class="ro"></label>
        <label class="attr"><span>Status</span><select onchange="UI.setAttr('project','${proj.id}','status',this.value)">
          ${['draft', 'active', 'on_hold', 'done', 'cancelled'].map(s => `<option ${s === proj.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="attr"><span>Program (one only)</span><select onchange="UI.moveProject('${proj.id}',this.value)">
          ${livePrograms().map(g => `<option value="${g.id}" ${g.id === proj.programId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
          <option value="" ${!proj.programId ? 'selected' : ''}>— standalone —</option></select></label>
      </div>
      ${proj.status === 'cancelled' ? `<div class="chip red" style="margin-top:8px">Cancelled: ${esc(proj.cancelReason || '')}${proj.cancelNote ? ` — ${esc(proj.cancelNote)}` : ''}</div>` : ''}

      <div class="attrgrp"><h4>Execution team</h4><div class="attrs">
        <label class="attr"><span>Project manager</span>${personSelect(a.projectManagerId, `UI.setAttr('project','${proj.id}','projectManagerId',this.value)`)}</label>
        <label class="attr"><span>Executive sponsor</span>${personSelect(a.sponsorId, `UI.setAttr('project','${proj.id}','sponsorId',this.value)`)}</label>
        <div class="attr wide"><span>Team leads</span>${personChips(a.teamLeadIds, `UI.addTeamMember.bind(null,'${proj.id}','teamLeadIds')`, `UI.removeTeamMember.bind(null,'${proj.id}','teamLeadIds')`)}</div>
        <div class="attr wide"><span>Cross-functional representatives</span>${personChips(a.crossFunctionalIds, `UI.addTeamMember.bind(null,'${proj.id}','crossFunctionalIds')`, `UI.removeTeamMember.bind(null,'${proj.id}','crossFunctionalIds')`)}</div>
        <div class="attr wide"><span>Subject-matter experts</span>${personChips(a.smeIds, `UI.addTeamMember.bind(null,'${proj.id}','smeIds')`, `UI.removeTeamMember.bind(null,'${proj.id}','smeIds')`)}</div>
      </div></div>

      ${attrForm('project', proj.id, PROJECT_ATTRS, a)}
    </div>
    ${docsPanel('project', proj.id)}
    <div class="panel"><h3>Lifecycle</h3>
      <div class="toolbar">
        ${proj.archivedAt
          ? `<button class="btn" onclick="UI.unarchive('project','${proj.id}')">Reopen</button>`
          : `<button class="btn" onclick="UI.closeProject('${proj.id}')">Close &amp; archive</button>
             <button class="btn" onclick="UI.cancelProject('${proj.id}')">Cancel project…</button>`}
        <button class="btn danger" onclick="UI.deleteEntity('project','${proj.id}')">Backup &amp; delete</button>
      </div>
      <div style="font-size:12px;color:var(--muted2)">
        Close requires every task at 100%. Cancel requires a reason and preserves the schedule and registers for
        learning. Delete downloads a JSON backup, then soft-deletes — restorable, and the audit trail survives.</div></div>`;
}

function renderProgramDetails(pgId) {
  const pg = S.programs.find(g => g.id === pgId);
  if (!pg) return '';
  pg.attrs = pg.attrs || {};
  const kids = S.projects.filter(p => p.programId === pg.id).map(p => projectRollup(p.id)).filter(Boolean);
  const childBudget = S.projects.filter(p => p.programId === pg.id).reduce((s, p) => s + (p.attrs?.budget || 0), 0);
  const childActual = S.projects.filter(p => p.programId === pg.id).reduce((s, p) => s + (p.attrs?.actualCost || 0), 0);
  const finish = kids.length ? kids.map(k => k.finish).sort().slice(-1)[0] : null;
  return `<div class="panel"><h3>Program — ${esc(pg.name)} <a href="#" style="font-size:12px;font-weight:400" onclick="UI.selectProgram(null);return false">✕ close</a></h3>
      <div class="statgrid">
        <div class="stat"><div class="l">Projects</div><div class="v">${kids.length}</div></div>
        <div class="stat"><div class="l">Latest finish (rolled up)</div><div class="v">${finish ? fmtShort(finish) : '—'}</div></div>
        <div class="stat"><div class="l">Σ project budget</div><div class="v" style="font-size:16px">${money(childBudget, pg.attrs.currency)}</div></div>
        <div class="stat"><div class="l">Σ actual</div><div class="v" style="font-size:16px">${money(childActual, pg.attrs.currency)}</div></div>
      </div>
      <div class="attrs" style="margin-top:10px">
        <label class="attr"><span>Name</span><input value="${esc(pg.name)}" onchange="UI.setAttr('program','${pg.id}','name',this.value)"></label>
        <label class="attr"><span>Program ID (generated)</span><input value="${esc(pg.attrs.programId || '')}" readonly class="ro"></label>
      </div>
      <div class="attrgrp"><h4>Leadership &amp; stakeholders</h4><div class="attrs">
        <label class="attr"><span>Program manager (owner)</span>${personSelect(pg.attrs.programManagerId, `UI.setAttr('program','${pg.id}','programManagerId',this.value)`)}</label>
        <label class="attr"><span>Executive sponsor</span>${personSelect(pg.attrs.sponsorId, `UI.setAttr('program','${pg.id}','sponsorId',this.value)`)}</label>
        <div class="attr wide"><span>Core business units impacted</span>
          <div class="chiplist">${S.businessUnits.map(bu => `
            <label class="chip ${(pg.attrs.businessUnits || []).includes(bu) ? 'sel' : ''}">
              <input type="checkbox" ${(pg.attrs.businessUnits || []).includes(bu) ? 'checked' : ''}
                onchange="UI.toggleProgramBU('${pg.id}','${esc(bu)}')"> ${esc(bu)}</label>`).join('')}</div></div>
      </div></div>
      ${attrForm('program', pg.id, PROGRAM_ATTRS, pg.attrs)}
    </div>
    ${docsPanel('program', pg.id)}
    <div class="panel"><h3>Lifecycle</h3>
      <div class="toolbar">
        <button class="btn" onclick="UI.newProject('${pg.id}')">+ Project in this program</button>
        ${pg.archivedAt
          ? `<button class="btn" onclick="UI.unarchive('program','${pg.id}')">Reopen</button>`
          : `<button class="btn" onclick="UI.closeProgram('${pg.id}')">Close &amp; archive</button>`}
        <button class="btn danger" onclick="UI.deleteEntity('program','${pg.id}')">Backup &amp; delete</button>
      </div>
      <div style="font-size:12px;color:var(--muted2)">
        Closing is blocked while active projects remain — close or cancel each one first so every project keeps its
        own outcome and reason.</div></div>`;
}

// ───────────────────────── Create dialogs ─────────────────────────

function programDialogBody() {
  const d = draft;
  return `
    <div class="attrgrp"><h4>Program identity</h4><div class="attrs">
      <label class="attr"><span>Program name *</span><input id="f-name" value="${esc(d.name)}" placeholder="e.g. Security Uplift"></label>
      <label class="attr"><span>Program ID (generated)</span><input value="${d.generatedId}" readonly class="ro" title="assigned automatically and never changes"></label>
      <label class="attr wide"><span>Description</span><textarea id="f-description" rows="2">${esc(d.description)}</textarea></label>
      <label class="attr wide"><span>Strategic objectives</span><textarea id="f-strategicObjectives" rows="2"
        placeholder="what this program exists to achieve">${esc(d.strategicObjectives)}</textarea></label>
      <div class="attr wide"><span>Linked OKR objectives</span>
        <div class="chiplist">${S.okrs.filter(o => !o.parentId).map(o => `
          <label class="chip ${d.linkedObjectiveIds.includes(o.id) ? 'sel' : ''}">
            <input type="checkbox" ${d.linkedObjectiveIds.includes(o.id) ? 'checked' : ''}
              onchange="UI.draftToggle('linkedObjectiveIds','${o.id}')"> ${esc(o.title)}</label>`).join('')}</div></div>
    </div></div>

    <div class="attrgrp"><h4>Leadership &amp; stakeholders</h4><div class="attrs">
      <label class="attr"><span>Program manager (owner) *</span>${personSelect(d.programManagerId, "UI.draftSet('programManagerId',this.value)")}</label>
      <label class="attr"><span>Executive sponsor</span>${personSelect(d.sponsorId, "UI.draftSet('sponsorId',this.value)")}</label>
      <div class="attr wide"><span>Core business units impacted</span>
        <div class="chiplist">${S.businessUnits.map(bu => `
          <label class="chip ${d.businessUnits.includes(bu) ? 'sel' : ''}">
            <input type="checkbox" ${d.businessUnits.includes(bu) ? 'checked' : ''}
              onchange="UI.draftToggle('businessUnits','${esc(bu)}')"> ${esc(bu)}</label>`).join('')}</div></div>
    </div></div>

    <div class="attrgrp"><h4>Financial</h4><div class="attrs">
      <label class="attr"><span>Approved total budget</span><input id="f-budget" type="number" value="${d.budget ?? ''}"></label>
      <label class="attr"><span>YTD spend</span><input id="f-ytdSpend" type="number" value="${d.ytdSpend ?? ''}"></label>
      <label class="attr"><span>Currency</span><select id="f-currency">${['USD', 'EUR', 'GBP', 'INR'].map(c => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Funding source</span><select id="f-fundingSource">
        <option value="">—</option>${S.fundingSources.map(f => `<option ${f === d.fundingSource ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <label class="attr"><span>ROI target %</span><input id="f-roiTargetPct" type="number" step="0.1" value="${d.roiTargetPct ?? ''}"></label>
      <label class="attr"><span>Steering cadence</span><select id="f-governanceCadence">${['weekly', 'monthly', 'quarterly'].map(c => `<option ${c === d.governanceCadence ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Target start</span><input id="f-startDate" type="date" value="${d.startDate}"></label>
      <label class="attr"><span>Target end</span><input id="f-targetEndDate" type="date" value="${d.targetEndDate}"></label>
    </div></div>`;
}

function projectDialogBody() {
  const d = draft;
  return `
    <div class="attrgrp"><h4>Project identity</h4><div class="attrs">
      <label class="attr"><span>Project name *</span><input id="f-name" value="${esc(d.name)}" placeholder="e.g. ERP Upgrade"></label>
      <label class="attr"><span>Project ID (generated)</span><input value="${d.generatedId}" readonly class="ro"></label>
      <label class="attr"><span>Parent program</span><select id="f-programId">
        <option value="">— standalone —</option>
        ${S.programs.filter(g => !g.archivedAt).map(g => `<option value="${g.id}" ${g.id === d.programId ? 'selected' : ''}>${esc(g.attrs?.programId || '')} ${esc(g.name)}</option>`).join('')}</select></label>
      <label class="attr"><span>Project start (schedule origin)</span><input id="f-startDate" type="date" value="${d.startDate}"></label>
      <label class="attr wide"><span>Scope statement</span><textarea id="f-scopeStatement" rows="3"
        placeholder="What is in scope, and explicitly what is out of scope.">${esc(d.scopeStatement)}</textarea></label>
    </div></div>

    <div class="attrgrp"><h4>Execution team</h4><div class="attrs">
      <label class="attr"><span>Project manager *</span>${personSelect(d.projectManagerId, "UI.draftSet('projectManagerId',this.value)")}</label>
      <label class="attr"><span>Executive sponsor</span>${personSelect(d.sponsorId, "UI.draftSet('sponsorId',this.value)")}</label>
      <div class="attr wide"><span>Team leads</span>${personChips(d.teamLeadIds, 'UI.draftAddPerson.bind(null,\'teamLeadIds\')', 'UI.draftRemovePerson.bind(null,\'teamLeadIds\')')}</div>
      <div class="attr wide"><span>Cross-functional representatives</span>${personChips(d.crossFunctionalIds, 'UI.draftAddPerson.bind(null,\'crossFunctionalIds\')', 'UI.draftRemovePerson.bind(null,\'crossFunctionalIds\')')}</div>
      <div class="attr wide"><span>Subject-matter experts (SMEs)</span>${personChips(d.smeIds, 'UI.draftAddPerson.bind(null,\'smeIds\')', 'UI.draftRemovePerson.bind(null,\'smeIds\')')}</div>
    </div></div>

    <div class="attrgrp"><h4>Financial tracking</h4><div class="attrs">
      <label class="attr"><span>Baseline budget (BAC)</span><input id="f-budget" type="number" value="${d.budget ?? ''}"></label>
      <label class="attr"><span>Actual cost (ACWP)</span><input id="f-acwp" type="number" value="${d.acwp ?? ''}"></label>
      <label class="attr"><span>Contingency reserve</span><input id="f-contingencyReserve" type="number" value="${d.contingencyReserve ?? ''}"></label>
      <label class="attr"><span>Currency</span><select id="f-currency">${['USD', 'EUR', 'GBP', 'INR'].map(c => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Capex / Opex</span><select id="f-costType">${['capex', 'opex', 'mixed'].map(c => `<option ${c === d.costType ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    </div></div>

    <div class="attrgrp"><h4>Classification &amp; commitment</h4><div class="attrs">
      <label class="attr"><span>Investment type</span><select id="f-investmentType">${['', 'run', 'grow', 'transform'].map(c => `<option ${c === d.investmentType ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Methodology</span><select id="f-methodology">${['', 'waterfall', 'agile', 'hybrid'].map(c => `<option ${c === d.methodology ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Priority</span><select id="f-priority">${['critical', 'high', 'medium', 'low'].map(c => `<option ${c === d.priority ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="attr"><span>Business unit</span><select id="f-businessUnit"><option value="">—</option>${S.businessUnits.map(b => `<option ${b === d.businessUnit ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <label class="attr"><span>Target start</span><input id="f-targetStartDate" type="date" value="${d.targetStartDate}"></label>
      <label class="attr"><span>Target finish</span><input id="f-targetFinishDate" type="date" value="${d.targetFinishDate}"></label>
    </div></div>`;
}

// ───────────────────────── Documents ─────────────────────────

function docsPanel(ownerType, ownerId) {
  const docs = S.documents.filter(d => d.ownerType === ownerType && d.ownerId === ownerId);
  return `<div class="panel"><h3>Documents</h3>
    <table><tr><th>Name</th><th>Description</th><th>Type</th><th>Added</th><th></th></tr>
    ${docs.map(d => `<tr>
      <td><b>${d.kind === 'link' ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</b></td>
      <td style="color:var(--muted2)">${esc(d.description || '')}</td>
      <td>${d.kind === 'link' ? '<span class="chip">🔗 link</span>' : `<span class="chip">📄 file${d.sizeKb ? ` · ${d.sizeKb}KB` : ''}</span>`}</td>
      <td style="font-size:12px;color:var(--muted2)">${esc(personName(d.addedBy))}<br>${fmtShort(d.addedAt)}</td>
      <td><button class="btn small danger" onclick="UI.removeDoc('${d.id}')">remove</button></td></tr>`).join('')
      || '<tr><td colspan=5 style="color:var(--muted2)">No documents attached.</td></tr>'}
    </table>
    <div class="detail" style="margin-top:10px">
      <div><label>Name *</label><input id="doc-name" style="width:200px" placeholder="e.g. Business Case"></div>
      <div><label>Description (optional)</label><input id="doc-desc" style="width:240px"></div>
      <div><label>Link URL</label><input id="doc-url" style="width:240px" placeholder="https://confluence…"></div>
      <div><label>…or upload</label><input id="doc-file" type="file"></div>
      <button class="btn primary" onclick="UI.addDoc('${ownerType}','${ownerId}')">Attach</button>
    </div>
    <div style="font-size:12px;color:var(--muted2);margin-top:6px">
      Attach a link (Confluence/SharePoint — where charters usually already live) or upload a file.
      Prototype stores uploads in the browser and caps them at 1&nbsp;MB; production puts them in object
      storage with versioning and virus scanning.</div></div>`;
}

// ───────────────────────── Portfolio / rollups ─────────────────────────
// Rollups are computed bottom-up from the engine, never hand-entered
//. A project belongs to at most ONE program.

/**
 * THE single rollup. Every tab reads RAG, progress, SPI and slip from
 * here — previously Status computed its own RAG with a different formula
 * from the one Portfolio/Details used, and the seeded project.rag was a
 * third value that nothing could edit. One computation, one answer.
 */
function projectRollup(pid) {
  const p = S.plans[pid];
  const proj = S.projects.find(x => x.id === pid);
  if (!p) return null;
  const sc = Engine.compute(p);
  const lv = p.tasks.filter(t => t.kind !== 'summary');
  const totalDur = lv.reduce((s, t) => s + (t.duration || 0), 0);
  const pct = totalDur ? lv.reduce((s, t) => s + (t.pct || 0) / 100 * (t.duration || 0), 0) / totalDur : 0;

  const bl = (S.namedBaselines[pid] || []).slice(-1)[0];
  const slip = bl ? sc.projectFinish - bl.sched.projectFinish : null;

  // Schedule performance: delivered progress ÷ progress the plan expected
  // by today, both duration-weighted. Measured against the latest baseline
  // when one exists, else against the current schedule.
  const ref = bl ? bl.sched : sc;
  const todayOff = todayStr >= p.start ? Engine.dateToOffset(p.start, todayStr) : 0;
  const plannedPct = totalDur ? lv.reduce((s, t) => {
    const r = ref.tasks[t.id];
    if (!r || !r.dur) return s;
    return s + Math.min(1, Math.max(0, (todayOff - r.es) / r.dur)) * (t.duration || 0);
  }, 0) / totalDur : 0;
  const spi = plannedPct > 0 ? pct / plannedPct : null;

  const risks = S.risks.filter(r => r.projectId === pid && r.status !== 'closed');
  const overdue = S.actionItems.filter(a => a.projectId === pid && a.status === 'open' && a.due < todayStr);
  const topRiskScore = Math.max(0, ...risks.map(r => r.probability * r.impact));

  // Why each project is the color it is — shown in the UI so the rollup
  // is auditable rather than a magic light.
  const reasons = [];
  if (slip > 5) reasons.push(`finish slipped ${slip}d vs baseline`);
  else if (slip > 0) reasons.push(`finish slipped ${slip}d`);
  if (spi != null && spi < 0.8) reasons.push(`schedule performance ${spi.toFixed(2)}`);
  else if (spi != null && spi < 0.95) reasons.push(`schedule performance ${spi.toFixed(2)}`);
  if (topRiskScore >= 16) reasons.push(`open risk scoring ${topRiskScore}`);
  else if (topRiskScore >= 12) reasons.push(`open risk scoring ${topRiskScore}`);
  if (overdue.length > 2) reasons.push(`${overdue.length} overdue action items`);
  else if (overdue.length) reasons.push(`${overdue.length} overdue action item(s)`);

  const rag = (slip > 5 || (spi != null && spi < 0.8) || topRiskScore >= 16 || overdue.length > 2) ? 'red'
    : (slip > 0 || (spi != null && spi < 0.95) || topRiskScore >= 12 || overdue.length > 0) ? 'amber' : 'green';

  return {
    proj, sc, pct, spi, plannedPct, slip, hasBaseline: !!bl,
    risks: risks.length, overdue: overdue.length, rag,
    reasons: reasons.length ? reasons : ['no negative signals'],
    tasks: p.tasks.length, finish: sc.finishDate,
  };
}

const RAG_RANK = { green: 0, amber: 1, red: 2 };

const lifecycleChip = (ent) =>
  ent.deletedAt ? '<span class="chip red">deleted</span>'
  : ent.status === 'cancelled' ? `<span class="chip red" title="${esc(ent.cancelReason || '')}">cancelled</span>`
  : ent.archivedAt ? '<span class="chip grey">archived</span>' : '';

function projectRowActions(p) {
  if (p.deletedAt) return `<button class="btn small" onclick="UI.restoreEntity('project','${p.id}')">restore</button>`;
  if (p.archivedAt) return `<button class="btn small" onclick="UI.unarchive('project','${p.id}')">reopen</button>
    <button class="btn small danger" onclick="UI.deleteEntity('project','${p.id}')">delete</button>`;
  return `<button class="btn small" onclick="UI.closeProject('${p.id}')" title="requires all tasks complete">close</button>
    <button class="btn small" onclick="UI.cancelProject('${p.id}')">cancel</button>
    <button class="btn small danger" onclick="UI.deleteEntity('project','${p.id}')">delete</button>`;
}

function renderPortfolio() {
  const rollups = {};
  liveProjects().forEach(p => { rollups[p.id] = projectRollup(p.id); });

  const progRows = livePrograms().map(pg => {
    const kids = liveProjects().filter(p => p.programId === pg.id).map(p => rollups[p.id]).filter(Boolean);
    const rag = kids.length ? Object.keys(RAG_RANK).find(k => RAG_RANK[k] === Math.max(...kids.map(k2 => RAG_RANK[k2.rag]))) : 'green';
    const pct = kids.length ? kids.reduce((s, k) => s + k.pct, 0) / kids.length : 0;
    const finish = kids.length ? kids.map(k => k.finish).sort().slice(-1)[0] : null;
    const projRow = k => `<tr class="projrow"${k.proj.archivedAt || k.proj.deletedAt ? ' style="opacity:.55"' : ''}>
        <td style="padding-left:26px">↳ <span class="chip grey">${esc(k.proj.attrs?.projectId || '')}</span>
          <a href="#" onclick="UI.openProject('${k.proj.id}');return false">${esc(k.proj.name)}</a> ${lifecycleChip(k.proj)}</td>
        <td><span class="chip ${k.rag}">${k.rag}</span></td>
        <td>${Math.round(k.pct * 100)}%</td>
        <td>${k.finish ? fmtShort(k.finish) : '—'}</td>
        <td>${k.slip == null ? '<span class="chip grey">no baseline</span>' : k.slip > 0 ? `<span class="chip red">+${k.slip}d</span>` : '<span class="chip green">on plan</span>'}</td>
        <td>${k.tasks}</td><td>${k.risks}</td><td>${k.overdue ? `<span class="chip red">${k.overdue}</span>` : 0}</td>
        <td>${esc(personName(k.proj.attrs?.projectManagerId))}</td>
        <td>${projectRowActions(k.proj)}</td>
      </tr>`;
    const rows = kids.map(projRow).join('');
    return `<tr class="progrow">
        <td><span class="chip grey">${esc(pg.attrs?.programId || '')}</span>
          <a href="#" onclick="UI.selectProgram('${pg.id}');return false"><b>${esc(pg.name)}</b></a> ${lifecycleChip(pg)}</td>
        <td><span class="chip ${rag}">${rag}</span></td>
        <td>${Math.round(pct * 100)}%</td><td>${finish ? fmtShort(finish) : '—'}</td>
        <td colspan="3" class="muted">${kids.length} project(s) rolled up</td>
        <td class="muted">${esc(personName(pg.attrs?.programManagerId))}</td>
        <td>${pg.archivedAt
          ? `<button class="btn small" onclick="UI.unarchive('program','${pg.id}')">reopen</button>`
          : `<button class="btn small" onclick="UI.newProject('${pg.id}')">+ project</button>
             <button class="btn small" onclick="UI.closeProgram('${pg.id}')">close</button>`}
          <button class="btn small danger" onclick="UI.deleteEntity('program','${pg.id}')">delete</button></td>
      </tr>${rows}`;
  }).join('');

  const standalone = liveProjects().filter(p => !p.programId).map(p => rollups[p.id]).filter(Boolean)
    .map(k => `<tr class="projrow"${k.proj.archivedAt ? ' style="opacity:.55"' : ''}>
      <td style="padding-left:26px">↳ <span class="chip grey">${esc(k.proj.attrs?.projectId || '')}</span>
        <a href="#" onclick="UI.openProject('${k.proj.id}');return false">${esc(k.proj.name)}</a> ${lifecycleChip(k.proj)}</td>
      <td><span class="chip ${k.rag}">${k.rag}</span></td><td>${Math.round(k.pct * 100)}%</td><td>${fmtShort(k.finish)}</td>
      <td>${k.slip == null ? '<span class="chip grey">no baseline</span>' : k.slip > 0 ? `<span class="chip red">+${k.slip}d</span>` : '<span class="chip green">on plan</span>'}</td>
      <td>${k.tasks}</td><td>${k.risks}</td><td>${k.overdue || 0}</td>
      <td>${esc(personName(k.proj.attrs?.projectManagerId))}</td>
      <td>${projectRowActions(k.proj)}</td></tr>`).join('');

  const deleted = S.projects.filter(p => p.deletedAt).concat(S.programs.filter(g => g.deletedAt));

  return `${selectedProgram ? renderProgramDetails(selectedProgram) : ''}
    <div class="toolbar">
      <button class="btn primary" onclick="UI.newProgram()">+ New program</button>
      <button class="btn" onclick="UI.newProject()">+ New project</button>
      <span class="spacer"></span>
      <span class="chip grey">${liveProjects().filter(p => !p.archivedAt).length} active · ${liveProjects().filter(p => p.archivedAt).length} archived</span>
    </div>
    <div class="panel"><h3>${esc(S.portfolios[0].name)} — portfolio rollup</h3>
      <table><tr><th>Program / Project</th><th>RAG</th><th>Progress</th><th>Finish</th><th>Slip</th><th>Tasks</th><th>Risks</th><th>Overdue</th><th>Manager</th><th>Actions</th></tr>
      ${progRows}${standalone ? `<tr class="progrow"><td colspan="10"><b>Standalone projects</b></td></tr>${standalone}` : ''}</table>
      <div style="font-size:12px;color:var(--muted2);margin-top:8px">
        RAG, progress and finish dates roll up bottom-up from the engine — never hand-entered. Program RAG = worst child.
        <b>close</b> requires every task complete · <b>cancel</b> requires a reason · <b>delete</b> downloads a JSON
        backup then soft-deletes (restorable, audit trail preserved). Closing a program is blocked while it still has
        active projects — each one deserves its own outcome.</div>
    </div>
    ${deleted.length ? `<div class="panel"><h3>Recently deleted (restorable)</h3>
      ${deleted.map(e => `<div style="font-size:13px;margin-bottom:4px">
        <span class="chip red">deleted</span> ${esc(e.name)}
        <button class="btn small" onclick="UI.restoreEntity('${e.attrs?.projectId ? 'project' : 'program'}','${e.id}')">restore</button></div>`).join('')}
      <div style="font-size:12px;color:var(--muted2)">In production these purge automatically after a retention window.</div></div>` : ''}`;
}

// ───────────────────────── OKRs (ideation sketch) ─────────────────────────

function renderOKRs() {
  const rollups = {};
  liveProjects().forEach(p => { rollups[p.id] = projectRollup(p.id); });
  const progDelivery = pgId => {
    const kids = S.projects.filter(p => p.programId === pgId).map(p => rollups[p.id]).filter(Boolean);
    return kids.length ? kids.reduce((s, k) => s + k.pct, 0) / kids.length : 0;
  };
  const progName = id => S.programs.find(p => p.id === id)?.name || id;

  const krRow = kr => {
    const outcome = kr.target ? Math.min(100, Math.round(kr.current / kr.target * 100)) : 0;
    const delivery = kr.programIds.length
      ? Math.round(kr.programIds.reduce((s, id) => s + progDelivery(id), 0) / kr.programIds.length * 100) : null;
    return `<tr><td style="padding-left:20px">${esc(kr.title)}</td>
      <td>${kr.current}${kr.unit} / ${kr.target}${kr.unit}</td>
      <td style="width:140px"><div class="meter"><div style="width:${outcome}%"></div></div></td>
      <td>${delivery == null ? '<span class="chip grey">no program</span>' : `<span class="chip ${delivery >= 70 ? 'green' : delivery >= 30 ? 'amber' : 'red'}">${delivery}% delivered</span>`}</td>
      <td>${kr.programIds.map(id => `<span class="chip">${esc(progName(id))}</span>`).join(' ') || '—'}</td></tr>`;
  };

  const objBlock = (o, indent) => {
    const kids = S.okrs.filter(x => x.parentId === o.id);
    return `<div class="card" style="margin-left:${indent}px">
      <div><span class="chip ${o.tier === 'executive' ? 'amber' : 'grey'}">${o.tier}</span>
        <b>${esc(o.title)}</b> <span class="muted" style="font-size:12px">· ${esc(o.owner)} · ${esc(o.period)}</span></div>
      <table style="margin-top:6px"><tr><th>Key result</th><th>Actual</th><th>Outcome</th><th>Delivery (from programs)</th><th>Linked programs</th></tr>
        ${o.keyResults.map(krRow).join('')}</table>
    </div>${kids.map(k => objBlock(k, indent + 24)).join('')}`;
  };

  return `<div class="panel"><h3>OKRs — executive → org, programs linked to key results</h3>
      ${S.okrs.filter(o => !o.parentId).map(o => objBlock(o, 0)).join('')}
    </div>
    <div class="panel" style="font-size:12px;color:var(--muted2)">
      <b>Sketch for ideation — not yet in the domain model.</b> Two different progress notions are shown deliberately:
      <b>Outcome</b> (the KR's own measure — usually from a business system, entered or integrated) and
      <b>Delivery</b> (rolled up from the linked programs' schedules — computed by the engine).
      The interesting product question is how they relate: delivery at 100% with outcome at 40% is exactly the
      "we shipped it and it didn't move the needle" signal a PMO director wants surfaced.</div>`;
}

// ───────────────────────── Chat log ─────────────────────────
// Mock of the chat_utterance table: every utterance logged with routing
// outcome; unanswerable ones flagged feature_request=Y for later mining.

function renderChatLog() {
  const frs = S.chatLog.filter(c => c.fr);
  return `<div class="panel"><h3>Chat utterance log (mock of chat_utterance table)</h3>
    <table><tr><th>Time</th><th>Utterance</th><th>Routed toolset</th><th>Answered</th><th>feature_request</th><th></th></tr>
    ${S.chatLog.map((c, i) => `<tr>
      <td><span class="chip grey">${c.at}</span></td>
      <td><b>${esc(c.text)}</b></td>
      <td>${c.toolset === '—' ? '—' : `<span class="chip">${c.toolset}</span>`}</td>
      <td>${c.answered ? '<span class="chip green">Y</span>' : '<span class="chip red">N</span>'}</td>
      <td>${c.fr ? '<span class="chip amber">Y</span>' : ''}${c.reviewed ? ' <span class="chip grey">reviewed</span>' : ''}</td>
      <td>${c.fr && !c.reviewed ? `<button class="btn small" onclick="UI.frReviewed(${i})">→ feature list</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan=6 style="color:var(--muted2)">No utterances yet — ask the chat something.</td></tr>'}
    </table></div>
    <div class="panel" style="color:var(--muted2);font-size:12px">
      ${frs.length} feature-request candidate(s). Product design: every utterance → chat_utterance row
      (org_id, user_id, utterance, toolsets_offered, tool_used, answered, feature_request, created_at).
      Doubles as the router learning loop — misroutes become new registry example
      utterances; unanswerable queries become feature-mining data. PMO admin reviews and promotes to the feature list.</div>`;
}

// ───────────────────────── Agent inbox ─────────────────────────

function renderInbox() {
  const items = S.agentInbox;
  return `<div class="panel"><h3>Agent proposals — propose, don't impose; every one carries evidence</h3>
    ${items.map(p => `<div class="card" style="${p.status !== 'proposed' ? 'opacity:.55' : ''}">
      <div class="agent">${esc(p.agent)} <span class="chip grey">${p.status}</span></div>
      <div style="margin:4px 0"><b>${p.kind === 'report' ? 'Weekly status report draft' : esc(p.proposal.title)}</b>
        ${p.kind === 'risk' ? ` <span class="chip amber">P${p.proposal.probability}×I${p.proposal.impact}</span>` : ''}
        ${p.kind === 'action-item' ? ` <span class="chip grey">${esc(p.proposal.owner)} · due ${fmtShort(p.proposal.due)}</span>` : ''}
        ${p.kind === 'report' ? `<br><span style="font-size:12px">RAG ${p.proposal.rag} · ▲ ${p.proposal.highlights.join('; ')} · ▼ ${p.proposal.lowlights.join('; ')}<br><i>${esc(p.proposal.sentiment)}</i></span>` : ''}
      </div>
      <div class="evidence">Evidence: ${esc(p.evidence)}</div>
      ${p.status === 'proposed' ? `<button class="btn primary small" onclick="UI.approve('${p.id}')">Approve</button>
        <button class="btn small" onclick="UI.reject('${p.id}')">Reject</button>`
        : p.status === 'rejected' && p.rejectionReason
          ? `<div style="font-size:12px;color:var(--muted2)">Rejected: ${esc(p.rejectionReason)}</div>` : ''}
    </div>`).join('') || 'Inbox empty'}
  </div>`;
}

// ───────────────────────── UI actions ─────────────────────────

window.UI = {
  tab(id) { currentTab = id; render(); },
  selectTask(id) { selectedTask = id; render(); },

  applyTaskEdit() {
    const t = taskById(selectedTask);
    if (!t) return;
    if (t.kind === 'task') {
      const d = parseInt($('#ed-dur').value, 10), p = parseInt($('#ed-pct').value, 10);
      if (d > 0 && d !== t.duration) { audit('update-task', `${t.name} duration ${t.duration}→${d}d`); t.duration = d; }
      t.pct = isNaN(p) ? t.pct : Math.min(100, Math.max(0, p));
    }
    render(); toast('Engine recomputed');
  },
  deleteTask() {
    const t = taskById(selectedTask);
    if (!t) return;
    // Collect the WHOLE subtree — deleting only direct children orphans
    // grandchildren, and the parent-walk then dereferences a missing task.
    const doomed = new Set([t.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of plan().tasks) {
        if (!doomed.has(x.id) && x.parentId && doomed.has(x.parentId)) { doomed.add(x.id); grew = true; }
      }
    }
    const n = doomed.size;
    if (!confirm(`Delete "${t.name}"${n > 1 ? ` and its ${n - 1} subtask(s)` : ''}? (destructive)`)) return;
    plan().tasks = plan().tasks.filter(x => !doomed.has(x.id));
    plan().deps = plan().deps.filter(d => !doomed.has(d.pred) && !doomed.has(d.succ));
    S.assignments = S.assignments.filter(a => !doomed.has(a.taskId));
    audit('delete-task', `${t.name}${n > 1 ? ` (+${n - 1} subtasks)` : ''}`);
    selectedTask = null; render();
  },
  addDepFromEditor() {
    const pred = $('#ed-pred').value, type = $('#ed-deptype').value, lag = parseInt($('#ed-lag').value, 10) || 0;
    plan().deps.push({ pred, succ: selectedTask, type, lag });
    audit('add-dependency', `${taskById(pred)?.name} →${type} ${taskById(selectedTask)?.name}`);
    render(); toast('Dependency added — recomputed');
  },
  removeDep(pred, succ) {
    plan().deps = plan().deps.filter(d => !(d.pred === pred && d.succ === succ));
    audit('remove-dependency', `${pred}→${succ}`);
    render();
  },
  addTask() {
    const name = prompt('Task name?'); if (!name) return;
    const dur = parseInt(prompt('Duration (working days)?', '5'), 10) || 5;
    const id = 'x' + Math.random().toString(36).slice(2, 7);
    plan().tasks.push({ id, name, kind: 'task', parentId: null, duration: dur, pct: 0 });
    audit('create-task', `${name} (${dur}d)`);
    selectedTask = id; render();
  },
  addMilestone() {
    const name = prompt('Milestone name?'); if (!name) return;
    const id = 'x' + Math.random().toString(36).slice(2, 7);
    plan().tasks.push({ id, name, kind: 'milestone', parentId: null, pct: 0 });
    audit('create-milestone', name);
    selectedTask = id; render();
  },

  // ── undo / baselines ──
  undo() {
    if (baselineView != null) return toast('🔒 Read-only baseline view — go back to the current version to edit');
    while (U.length) {
      const e = U.pop();
      const cur = JSON.stringify({ plan: S.plans[e.projectId], assignments: S.assignments });
      if (cur !== e.json) {
        const st = JSON.parse(e.json);
        S.plans[e.projectId] = st.plan;
        S.assignments = st.assignments;
        // The change may belong to another project — show what actually
        // moved rather than silently reverting an off-screen plan.
        if (e.projectId !== currentProject) {
          const other = S.projects.find(p => p.id === e.projectId);
          currentProject = e.projectId;
          selectedTask = null;
          toast(`Undid a change in "${other?.name ?? 'another project'}" — switched to it`);
        }
        audit('undo', 'reverted last change');
        break;
      }
    }
    render();
  },
  takeBaseline() {
    const list = S.namedBaselines[currentProject] = S.namedBaselines[currentProject] || [];
    const name = prompt('Baseline name?', 'Baseline ' + (list.length + 1));
    if (!name) return;
    list.push({ name, takenAt: Engine.fmtDate(new Date()), plan: structuredClone(plan()), sched: sched() });
    audit('take-baseline', name);
    render(); toast(`Baseline "${name}" captured`);
  },
  selectBaseline(v) {
    baselineView = v === '' ? null : +v;
    selectedTask = null;
    render();
    if (baselineView != null) toast('🔒 Read-only baseline view — nothing here can be edited');
  },
  revertBaseline() {
    const list = S.namedBaselines[currentProject] || [];
    if (baselineView == null || !list[baselineView]) return toast('Select a baseline first');
    const b = list[baselineView];
    if (!confirm(`Make baseline "${b.name}" (${b.takenAt}) the CURRENT version?\nThe current version will be replaced (undoable in this session).`)) return;
    snapshot();
    const outgoingTaskIds = new Set(plan().tasks.map(t => t.id));
    S.plans[currentProject] = structuredClone(b.plan);
    const restoredTaskIds = new Set(plan().tasks.map(t => t.id));
    // Only drop assignments belonging to THIS project's replaced tasks —
    // filtering the global list against one project's ids would delete
    // every other project's assignments.
    S.assignments = S.assignments.filter(a => !outgoingTaskIds.has(a.taskId) || restoredTaskIds.has(a.taskId));
    selectedTask = null;
    baselineView = null;   // back to the (new) current version — editable
    audit('revert-baseline', `"${b.name}" promoted to current version`);
    render(); toast(`"${b.name}" is now the current version — editable. Undo to go back.`);
  },

  // ── task notes ──
  /**
   * Notes are free text on a task — the context a duration and a date can
   * never carry ("waiting on the vendor's confirmation, see CHG-004").
   * Capped at NOTES_MAX so the column stays a note field rather than
   * becoming a document store.
   */
  openNotes(id) {
    const t = taskById(id);
    if (!t) return;
    const text = t.notes ?? '';
    openModal({
      title: `Notes — ${t.name}`,
      kind: 'notes',
      targetId: id,
      saveLabel: 'OK',
      // The dialog must survive a stray click outside it.
      lockBackdrop: true,
      bodyHtml: `
        <textarea id="note-text" class="notearea" maxlength="${NOTES_MAX}" rows="12"
          placeholder="Context that the schedule itself cannot carry — assumptions, blockers, decisions, who to chase."
          oninput="UI.noteCount()">${esc(text)}</textarea>
        <div class="notefoot">
          <span id="note-count">${text.length} / ${NOTES_MAX}</span>
          <span class="notehint">Closes only on OK or Cancel.</span>
        </div>`,
    });
  },
  noteCount() {
    const ta = $('#note-text'), out = $('#note-count');
    if (!ta || !out) return;
    const n = ta.value.length;
    out.textContent = `${n} / ${NOTES_MAX}`;
    out.className = n >= NOTES_MAX ? 'at-limit' : n > NOTES_MAX * 0.9 ? 'near-limit' : '';
  },

  // ── WBS structure editing ──
  addAbove(id) {
    const t = taskById(id);
    const [start] = subtreeBlock(id);
    const nt = { id: 'x' + Math.random().toString(36).slice(2, 7), name: 'New task', kind: 'task', parentId: t.parentId, duration: 3, pct: 0 };
    plan().tasks.splice(start, 0, nt);
    audit('create-task', `"${nt.name}" above "${t.name}"`);
    render();
    focusName(nt.id);
  },
  setPreds(id, v) {
    const ts = plan().tasks;
    const newDeps = [];
    for (const tok of v.split(/[,;]+/).map(x => x.trim()).filter(Boolean)) {
      const m = tok.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\d+)?d?$/i);
      const target = m && ts[+m[1] - 1];
      if (!m || !target) { toast(`Couldn't parse "${tok}" — format: rowNumber + type + lag, e.g. 3FS+2`); return render(); }
      if (target.id === id) { toast('A task cannot depend on itself'); return render(); }
      if (target.kind === 'summary') { toast(`Row ${m[1]} is a group — link to its subtasks instead`); return render(); }
      newDeps.push({ pred: target.id, succ: id, type: (m[2] || 'FS').toUpperCase(), lag: +(m[3] || 0) });
    }
    plan().deps = plan().deps.filter(d => d.succ !== id).concat(newDeps);
    audit('set-predecessors', `"${taskById(id).name}" ← [${v || 'none'}]`);
    render();
  },

  addBelow(id) {
    const t = taskById(id);
    const [, end] = subtreeBlock(id);
    const nt = { id: 'x' + Math.random().toString(36).slice(2, 7), name: 'New task', kind: 'task', parentId: t.parentId, duration: 3, pct: 0 };
    plan().tasks.splice(end, 0, nt);
    audit('create-task', `"${nt.name}" below "${t.name}"`);
    render();
    focusName(nt.id);
  },
  addGroup() {
    const nt = { id: 'x' + Math.random().toString(36).slice(2, 7), name: 'New group', kind: 'summary', parentId: null };
    if (selectedTask && taskById(selectedTask)) {
      const root = topLevelAncestor(selectedTask);
      const [, end] = subtreeBlock(root.id);
      plan().tasks.splice(end, 0, nt);
    } else plan().tasks.push(nt);
    audit('create-group', nt.name);
    render();
    focusName(nt.id);
  },
  indent(id) {
    const t = taskById(id), ts = plan().tasks;
    const idx = ts.findIndex(x => x.id === id);
    let sib = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (ts[i].parentId === t.parentId) { sib = ts[i]; break; }
      if (ts[i].id === t.parentId) break;
    }
    if (!sib) return toast('No task above at this level to indent under');
    if (sib.kind === 'milestone') return toast("Can't make a subtask of a milestone");
    if (sib.kind !== 'summary') { sib.kind = 'summary'; toast(`"${sib.name}" became a group (duration now rolls up)`); }
    t.parentId = sib.id;
    audit('indent', `"${t.name}" → subtask of "${sib.name}"`);
    render();
  },
  outdent(id) {
    const t = taskById(id);
    if (!t.parentId) return toast('Already at top level');
    const parent = taskById(t.parentId), ts = plan().tasks;
    const [s, e] = subtreeBlock(id);
    const moving = ts.splice(s, e - s);
    const [, pe] = subtreeBlock(parent.id);
    moving[0].parentId = parent.parentId ?? null;
    ts.splice(pe, 0, ...moving);
    audit('outdent', `"${t.name}" ← out of "${parent.name}"`);
    render();
  },
  renameTask(id, v) {
    const t = taskById(id);
    if (!v.trim() || v === t.name) return;
    audit('rename', `"${t.name}" → "${v.trim()}"`);
    t.name = v.trim();
    render();
  },
  dragStart(e, id) { dragId = id; e.dataTransfer.effectAllowed = 'move'; },
  dragOver(e) { e.preventDefault(); e.currentTarget.classList.add('droptarget'); },
  dragLeave(e) { e.currentTarget.classList.remove('droptarget'); },
  drop(e, targetId) {
    e.preventDefault();
    e.currentTarget.classList.remove('droptarget');
    if (!dragId || dragId === targetId) return;
    const ts = plan().tasks;
    const [s, en] = subtreeBlock(dragId);
    if (ts.slice(s, en).some(x => x.id === targetId)) return toast("Can't drop a task into its own subtree");
    const moving = ts.splice(s, en - s);
    const target = taskById(targetId);
    const [, te] = subtreeBlock(targetId);
    moving[0].parentId = target.parentId ?? null;
    ts.splice(te, 0, ...moving);
    audit('move-task', `"${moving[0].name}" after "${target.name}"`);
    dragId = null;
    render();
  },

  // ── inline grid editors — all writes are engine INPUTS, dates recompute ──
  cellDur(id, v) {
    const t = taskById(id), d = Math.max(1, parseInt(v, 10) || 1);
    audit('update-task', `${t.name} duration ${t.duration}→${d}d`);
    t.duration = d; render(); toast('Recomputed');
  },
  cellPct(id, v) {
    const t = taskById(id);
    t.pct = Math.min(100, Math.max(0, parseInt(v, 10) || 0)); render();
  },
  cellStart(id, v) {
    if (!v) return;
    const t = taskById(id);
    const off = Engine.dateToOffset(plan().start, v);
    t.constraint = { type: 'SNET', offset: off };
    audit('update-task', `${t.name} start → ${v} (SNET constraint)`);
    render();
    const actual = sched().tasks[id].startDate;
    toast(actual !== v ? `Dependencies keep "${t.name}" at ${fmtShort(actual)} — SNET ${fmtShort(v)} set (📌)` : 'Start pinned (SNET) — recomputed');
  },
  cellFinish(id, v) {
    if (!v) return;
    const t = taskById(id);
    const es = sched().tasks[id].es;
    const newDur = Engine.dateToOffset(plan().start, v) - es + 1;
    if (newDur < 1) { toast('Finish before start — ignored'); render(); return; }
    audit('update-task', `${t.name} finish → ${v} (duration ${t.duration}→${newDur}d)`);
    t.duration = newDur; render();
  },
  cellRes(id, v) {
    const t = taskById(id);
    S.assignments = S.assignments.filter(a => a.taskId !== id);
    if (v) {
      S.assignments.push({ taskId: id, resourceId: v, units: 100 });
      audit('assign', `${S.resources.find(r => r.id === v).name} → ${t.name}`);
    } else audit('unassign', t.name);
    render();
  },
  clearConstraint(id) {
    const t = taskById(id);
    if (!t.constraint) return;
    const when = fmtShort(Engine.fmtDate(Engine.offsetToDate(plan().start, t.constraint.offset)));
    if (!confirm(`Remove the ${t.constraint.type} (${when}) constraint from "${t.name}"?\nThe task returns to ASAP scheduling — its start may move earlier.`)) return;
    delete t.constraint;
    audit('update-task', `${t.name} constraint cleared → ASAP`);
    render(); toast('Constraint cleared — back to ASAP');
  },
  openProject(id) { currentProject = id; selectedTask = null; baselineView = null; currentTab = 'gantt'; render(); },
  selectProgram(id) { selectedProgram = id; render(); },
  addTeamMember(pid, key, personId) {
    if (!personId) return;
    const p = S.projects.find(x => x.id === pid);
    (p.attrs[key] ||= []).push(personId);
    audit('update-project', `${p.name}: added ${personName(personId)} to ${key}`);
    render();
  },
  removeTeamMember(pid, key, personId) {
    const p = S.projects.find(x => x.id === pid);
    p.attrs[key] = (p.attrs[key] || []).filter(x => x !== personId);
    audit('update-project', `${p.name}: removed ${personName(personId)} from ${key}`);
    render();
  },
  toggleProgramBU(pgId, bu) {
    const g = S.programs.find(x => x.id === pgId);
    const arr = (g.attrs.businessUnits ||= []);
    const i = arr.indexOf(bu);
    if (i >= 0) arr.splice(i, 1); else arr.push(bu);
    audit('update-program', `${g.name}: business units → ${arr.join(', ') || 'none'}`);
    render();
  },
  setAttr(kind, id, key, value) {
    const ent = kind === 'project' ? S.projects.find(x => x.id === id) : S.programs.find(x => x.id === id);
    if (!ent) return;
    const numeric = ['budget', 'actualCost'].includes(key);
    const val = numeric ? (value === '' ? null : Number(value)) : value;
    if (key === 'name' || key === 'status') { ent[key] = val; }
    else { ent.attrs = ent.attrs || {}; ent.attrs[key] = val; }
    audit(`update-${kind}`, `${ent.name}: ${key} → ${val ?? '—'}`);
    render();
  },
  // ── create dialogs ──
  newProgram() {
    draft = {
      generatedId: `PRG-${String((S.seq.program || 0) + 1).padStart(4, '0')}`,
      name: '', description: '', strategicObjectives: '', linkedObjectiveIds: [],
      programManagerId: '', sponsorId: '', businessUnits: [],
      budget: null, ytdSpend: null, currency: 'USD', fundingSource: '', roiTargetPct: null,
      governanceCadence: 'monthly', startDate: todayStr, targetEndDate: '',
    };
    openModal({ title: 'New program', bodyHtml: programDialogBody(), saveLabel: 'Create program', wide: true, kind: 'program' });
  },
  newProject(programId) {
    draft = {
      generatedId: `PRJ-${String((S.seq.project || 0) + 1).padStart(4, '0')}`,
      name: '', scopeStatement: '', programId: programId || '',
      projectManagerId: '', sponsorId: '', teamLeadIds: [], crossFunctionalIds: [], smeIds: [],
      budget: null, acwp: null, contingencyReserve: null, currency: 'USD', costType: 'capex',
      investmentType: '', methodology: '', priority: 'medium', businessUnit: '',
      startDate: todayStr, targetStartDate: todayStr, targetFinishDate: '',
    };
    openModal({ title: 'New project', bodyHtml: projectDialogBody(), saveLabel: 'Create project', wide: true, kind: 'project' });
  },
  /** Person/multi-select edits re-render the dialog, so text inputs are
   *  captured into the draft first — otherwise typing is lost. */
  draftCapture() {
    if (!modal) return;
    document.querySelectorAll('#modal [id^="f-"]').forEach(el => {
      const key = el.id.slice(2);
      draft[key] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
    });
  },
  draftSet(key, value) { this.draftCapture(); draft[key] = value; this.redrawModal(); },
  draftToggle(key, value) {
    this.draftCapture();
    const arr = draft[key] || (draft[key] = []);
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
    this.redrawModal();
  },
  draftAddPerson(key, id) { if (!id) return; this.draftCapture(); (draft[key] ||= []).push(id); this.redrawModal(); },
  draftRemovePerson(key, id) { this.draftCapture(); draft[key] = (draft[key] || []).filter(x => x !== id); this.redrawModal(); },
  redrawModal() {
    modal.bodyHtml = modal.kind === 'program' ? programDialogBody() : projectDialogBody();
    renderModal();
  },
  modalCancel() { draft = null; closeModal(); },
  modalSave() {
    if (modal.kind === 'info') return this.modalCancel();
    if (modal.kind === 'notes') {
      const t = taskById(modal.targetId);
      const text = ($('#note-text')?.value ?? '').slice(0, NOTES_MAX);
      const had = !!t.notes;
      if (text.trim()) t.notes = text; else delete t.notes;
      audit('update-task', `${t.name}: notes ${text.trim() ? (had ? 'updated' : 'added') : 'cleared'}`);
      closeModal(); render();
      return;
    }
    this.draftCapture();
    const d = draft;
    if (modal.kind === 'cancel') {
      const proj = S.projects.find(p => p.id === modal.targetId);
      proj.status = 'cancelled';
      proj.cancelReason = d.reason;
      proj.cancelNote = d.note;
      proj.cancelledAt = todayStr;
      proj.archivedAt = todayStr;
      S.actionItems.filter(a => a.projectId === proj.id && a.status === 'open')
        .forEach(a => { a.status = 'cancelled'; });
      audit('cancel-project', `${proj.name} — ${d.reason}`);
      draft = null; closeModal(); render();
      toast(`"${proj.name}" cancelled — reason recorded`);
      return;
    }
    if (!d.name?.trim()) return modalErr('Name is required');
    if (modal.kind === 'program') {
      if (!d.programManagerId) return modalErr('Program manager is required');
      const id = 'pg' + Math.random().toString(36).slice(2, 7);
      S.programs.push({
        id, portfolioId: S.portfolios[0].id, name: d.name.trim(),
        attrs: {
          programId: nextId('program'), description: d.description, strategicObjectives: d.strategicObjectives,
          linkedObjectiveIds: d.linkedObjectiveIds, programManagerId: d.programManagerId, sponsorId: d.sponsorId,
          businessUnits: d.businessUnits, status: 'active', priority: 'medium',
          budget: d.budget, ytdSpend: d.ytdSpend, currency: d.currency,
          fundingSource: d.fundingSource, roiTargetPct: d.roiTargetPct,
          governanceCadence: d.governanceCadence, startDate: d.startDate, targetEndDate: d.targetEndDate,
        },
      });
      audit('create-program', `${d.name.trim()}`);
      selectedProgram = id;
      draft = null; closeModal(); render(); toast(`Program created`);
    } else {
      if (!d.projectManagerId) return modalErr('Project manager is required');
      const id = 'p' + Math.random().toString(36).slice(2, 7);
      S.projects.push({
        id, programId: d.programId || null, name: d.name.trim(), status: 'draft',
        attrs: {
          projectId: nextId('project'), scopeStatement: d.scopeStatement,
          projectManagerId: d.projectManagerId, sponsorId: d.sponsorId,
          teamLeadIds: d.teamLeadIds, crossFunctionalIds: d.crossFunctionalIds, smeIds: d.smeIds,
          businessUnit: d.businessUnit, investmentType: d.investmentType, methodology: d.methodology,
          priority: d.priority, phase: 'initiation',
          targetStartDate: d.targetStartDate, targetFinishDate: d.targetFinishDate,
          budget: d.budget, acwp: d.acwp, contingencyReserve: d.contingencyReserve,
          currency: d.currency, costType: d.costType,
        },
      });
      S.plans[id] = { start: d.startDate || todayStr, tasks: [], deps: [] };
      audit('create-project', d.name.trim());
      draft = null; closeModal();
      currentProject = id; currentTab = 'details'; render();
      toast('Project created — add the schedule in the Gantt tab');
    }
  },

  // ── lifecycle: close/archive, cancel, delete ──

  /**
   * Close & archive a project. Requires the work to actually be finished:
   * every task 100% complete. Incomplete tasks are listed rather than
   * hand-waved, and the PM is offered the honest alternative (cancel).
   */
  closeProject(pid) {
    const proj = S.projects.find(p => p.id === pid);
    const open = (S.plans[pid]?.tasks || []).filter(t => t.kind !== 'summary' && (t.pct || 0) < 100);
    if (open.length) {
      return openModal({
        title: `Cannot close "${proj.name}" yet`, saveLabel: 'OK', kind: 'info',
        bodyHtml: `<p>${open.length} task(s) are not complete:</p>
          <ul style="max-height:220px;overflow:auto">${open.slice(0, 25).map(t => `<li>${esc(t.name)} — ${t.pct || 0}%</li>`).join('')}
          ${open.length > 25 ? `<li>…and ${open.length - 25} more</li>` : ''}</ul>
          <p style="color:var(--muted2);font-size:13px">Finish them, or <b>cancel</b> the project with a reason if the
          work is not going to be completed. Closing a project with unfinished work would corrupt the historical
          record the agents learn from.</p>`,
      });
    }
    if (!confirm(`Close and archive "${proj.name}"? It becomes read-only and drops out of active lists.`)) return;
    proj.status = 'done'; proj.archivedAt = todayStr;
    audit('close-project', proj.name);
    render(); toast(`"${proj.name}" closed and archived`);
  },

  cancelProject(pid) {
    const proj = S.projects.find(p => p.id === pid);
    draft = { reason: S.cancelReasons[0], note: '' };
    openModal({
      title: `Cancel "${proj.name}"`, saveLabel: 'Cancel project', kind: 'cancel', targetId: pid,
      bodyHtml: `<div class="attrs">
        <label class="attr"><span>Reason *</span><select id="f-reason">
          ${S.cancelReasons.map(r => `<option>${esc(r)}</option>`).join('')}</select></label>
        <label class="attr wide"><span>Notes</span><textarea id="f-note" rows="3"
          placeholder="context for the record — this is what the Risk Agent mines later"></textarea></label>
      </div>
      <p style="color:var(--muted2);font-size:13px">Cancelling keeps the schedule, risks and history intact for
      learning — it does not delete anything. Open action items are closed as cancelled.</p>`,
    });
  },

  /** Program close is BLOCKED while active children exist. */
  closeProgram(pgId) {
    const pg = S.programs.find(g => g.id === pgId);
    const active = S.projects.filter(p => p.programId === pgId && !p.archivedAt && p.status !== 'cancelled' && p.status !== 'done');
    if (active.length) {
      return openModal({
        title: `Cannot close "${pg.name}" yet`, saveLabel: 'OK', kind: 'info',
        bodyHtml: `<p>${active.length} project(s) are still active:</p>
          <ul>${active.map(p => `<li><b>${esc(p.name)}</b> — ${esc(p.status)}</li>`).join('')}</ul>
          <p style="color:var(--muted2);font-size:13px">Close or cancel each project first. Each one deserves its own
          outcome and, where cancelled, its own reason — a program-level button that silently cancels several
          projects destroys exactly the history we want to learn from.</p>`,
      });
    }
    if (!confirm(`Close and archive program "${pg.name}"?`)) return;
    pg.attrs = pg.attrs || {}; pg.attrs.status = 'closed'; pg.archivedAt = todayStr;
    audit('close-program', pg.name);
    selectedProgram = null;
    render(); toast(`Program "${pg.name}" closed and archived`);
  },

  /** Backup-then-soft-delete: downloads a JSON export, then hides the row. */
  deleteEntity(kind, id) {
    const ent = kind === 'project' ? S.projects.find(p => p.id === id) : S.programs.find(g => g.id === id);
    if (!ent) return;
    const children = kind === 'program' ? S.projects.filter(p => p.programId === id && !p.deletedAt) : [];
    if (children.length) return toast(`"${ent.name}" still has ${children.length} project(s) — move or delete them first`);
    if (!confirm(`Delete ${kind} "${ent.name}"?\n\nA JSON backup downloads first. The ${kind} is soft-deleted — an admin can restore it, and the audit trail is preserved.`)) return;

    const backup = kind === 'project'
      ? {
          exportedAt: new Date().toISOString(), kind, entity: ent, plan: S.plans[id],
          risks: S.risks.filter(r => r.projectId === id),
          actionItems: S.actionItems.filter(a => a.projectId === id),
          meetingNotes: S.meetingNotes.filter(m => m.projectId === id),
          checkIns: S.checkIns.filter(c => c.projectId === id),
          documents: S.documents.filter(d => d.ownerType === 'project' && d.ownerId === id),
          baselines: S.namedBaselines[id] || [],
        }
      : { exportedAt: new Date().toISOString(), kind, entity: ent, documents: S.documents.filter(d => d.ownerType === 'program' && d.ownerId === id) };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(ent.attrs?.projectId || ent.attrs?.programId || ent.name).replace(/\W+/g, '-')}-backup.json`;
    a.click();
    URL.revokeObjectURL(a.href);

    ent.deletedAt = new Date().toISOString();
    audit(`delete-${kind}`, `${ent.name} (backup downloaded, soft-deleted)`);
    if (kind === 'project' && currentProject === id) {
      currentProject = S.projects.find(p => !p.deletedAt)?.id ?? null;
      currentTab = 'portfolio';
    }
    if (kind === 'program') selectedProgram = null;
    render(); toast(`Backup downloaded · ${kind} soft-deleted (restorable)`);
  },

  restoreEntity(kind, id) {
    const ent = kind === 'project' ? S.projects.find(p => p.id === id) : S.programs.find(g => g.id === id);
    if (!ent) return;
    delete ent.deletedAt;
    audit(`restore-${kind}`, ent.name);
    render(); toast(`${kind} restored`);
  },

  unarchive(kind, id) {
    const ent = kind === 'project' ? S.projects.find(p => p.id === id) : S.programs.find(g => g.id === id);
    if (!ent) return;
    delete ent.archivedAt;
    if (kind === 'project') ent.status = 'active'; else ent.attrs.status = 'active';
    audit(`unarchive-${kind}`, ent.name);
    render(); toast(`${kind} reopened`);
  },

  // ── documents ──
  addDoc(ownerType, ownerId) {
    const name = $('#doc-name').value.trim();
    const url = $('#doc-url').value.trim();
    const file = $('#doc-file').files?.[0];
    if (!name) return toast('Give the document a name');
    if (!url && !file) return toast('Attach a link or choose a file');
    const base = {
      id: 'd' + Date.now(), ownerType, ownerId, name,
      description: $('#doc-desc').value.trim(),
      addedBy: CURRENT_USER, addedAt: todayStr,
    };
    if (url) {
      S.documents.push({ ...base, kind: 'link', url });
      audit('attach-document', `${name} (link)`);
      render(); toast('Link attached');
      return;
    }
    if (file.size > 1024 * 1024) return toast('Prototype caps uploads at 1MB (browser storage) — attach a link instead');
    const reader = new FileReader();
    reader.onload = () => {
      S.documents.push({ ...base, kind: 'file', dataUrl: reader.result, sizeKb: Math.round(file.size / 1024), filename: file.name });
      audit('attach-document', `${name} (file ${file.name})`);
      render(); toast('File attached');
    };
    reader.readAsDataURL(file);
  },
  removeDoc(id) {
    const d = S.documents.find(x => x.id === id);
    if (!d || !confirm(`Remove document "${d.name}"?`)) return;
    S.documents = S.documents.filter(x => x.id !== id);
    audit('remove-document', d.name);
    render();
  },
  moveProject(pid, pgId) {
    const p = S.projects.find(x => x.id === pid);
    p.programId = pgId || null;
    audit('move-project', `${p.name} → ${pgId ? S.programs.find(g => g.id === pgId).name : 'standalone'}`);
    render();
  },
  toggleLinks() { showLinks = !showLinks; render(); },
  setZoom(z) { zoom = z; render(); },
  toggleCP() {
    cpOnly = !cpOnly;
    render();
    if (cpOnly) {
      const n = sched().criticalPath.length;
      toast(`Critical path only — ${n} task(s) with zero float. Row numbers still match the full plan; reordering is off while filtered.`);
    }
  },
  genBigProject() {
    const t0 = performance.now();
    const p = genBigPlan();
    if (!S.projects.find(x => x.id === 'pbig'))
      S.projects.push({ id: 'pbig', programId: 'pg1', name: 'Perf Test — 1,200 rows', status: 'active' });
    S.plans.pbig = p;
    currentProject = 'pbig'; selectedTask = null; baselineView = null;
    render();
    toast(`Generated ${p.tasks.length} rows / ${p.deps.length} links in ${(performance.now() - t0).toFixed(0)}ms — now edit a duration and watch the perf badge (bottom-left)`);
  },
  setProjectStart(v) {
    if (!v) return;
    audit('update-project', `start ${plan().start} → ${v}`);
    plan().start = v;
    render(); toast('Project start moved — whole schedule recomputed');
  },

  riskStatus(id, status) {
    const r = S.risks.find(x => x.id === id);
    r.status = status;
    audit('update-risk', `${r.title} → ${status}`);
    if (status === 'realized') toast('Marked realized — this is what makes the register minable later');
    render();
  },
  addRisk() {
    const title = $('#rk-title').value.trim();
    if (!title) return toast('Give the risk a title');
    const clamp = v => Math.min(5, Math.max(1, +v || 3));
    S.risks.push({
      id: 'rk' + Date.now(), projectId: currentProject, title,
      category: $('#rk-cat').value, owner: $('#rk-owner').value,
      probability: clamp($('#rk-p').value), impact: clamp($('#rk-i').value),
      status: 'open', source: 'human', mitigation: $('#rk-mit').value.trim(),
    });
    audit('create-risk', title);
    render(); toast('Risk added');
  },
  setRiskField(id, field, value) {
    const r = S.risks.find(x => x.id === id);
    if (!r) return;
    r[field] = (field === 'probability' || field === 'impact') ? Math.min(5, Math.max(1, +value || 1)) : value;
    audit('update-risk', `${r.title}: ${field} → ${r[field]}`);
    render();
  },
  addActionItem() {
    const title = $('#ai-title').value.trim();
    if (!title) return toast('Give the action item a title');
    const blocks = $('#ai-blocks').value;
    S.actionItems.push({
      id: 'a' + Date.now(), projectId: currentProject, title,
      owner: $('#ai-owner').value, due: $('#ai-due').value || todayStr,
      status: 'open', source: 'manual', blockedTaskIds: blocks ? [blocks] : [],
    });
    audit('create-action-item', title);
    render(); toast('Action item added');
  },
  setActionField(id, field, value) {
    const a = S.actionItems.find(x => x.id === id);
    if (!a) return;
    a[field] = value;
    audit('update-action-item', `${a.title}: ${field} → ${value || '—'}`);
    render();
  },
  setImpactSlip(id, days) {
    impactSlipDays = Math.min(60, Math.max(1, parseInt(days, 10) || 5));
    this.aiImpact(id);
  },

  aiDone(id) { const a = S.actionItems.find(x => x.id === id); a.status = 'done'; audit('action-done', a.title); render(); },
  aiRemind(id) {
    const a = S.actionItems.find(x => x.id === id);
    audit('remind', `email → ${a.owner}`);
    toast(`📧 Reminder to ${a.owner} queued to Outbox (sandbox: captured, not sent)`);
  },
  aiImpact(id) {
    const a = S.actionItems.find(x => x.id === id);
    const blocked = (a.blockedTaskIds || []).filter(tid => taskById(tid));
    if (!blocked.length) {
      impactResult = { id, title: a.title, html: 'Not linked to any task, so there is nothing to walk. Link it to the task it blocks.' };
      render(); return;
    }
    const imp = Engine.impactOf(plan(), blocked, impactSlipDays);
    const ms = imp.milestoneDeltas.filter(m => m.deltaDays);
    impactResult = {
      id, title: a.title,
      html: `Blocks <b>${imp.downstream.length}</b> downstream task(s): ${imp.downstream.map(d => esc(d.name)).join(', ') || '—'}<br>`
        + (ms.length ? ms.map(m => `<b>${esc(m.name)}</b> moves <span class="chip red">+${m.deltaDays}d</span>`).join(' · ') + '<br>' : 'No milestone moves.<br>')
        + `Project finish: <b>${imp.finishDeltaDays > 0 ? '+' + imp.finishDeltaDays + 'd' : 'unchanged'}</b>`,
    };
    render();
  },

  frReviewed(i) {
    S.chatLog[i].reviewed = true;
    audit('feature-request', `promoted: "${S.chatLog[i].text}"`);
    render(); toast('Marked reviewed → feature list');
  },

  approve(id) {
    const p = S.agentInbox.find(x => x.id === id);
    p.status = 'approved';
    if (p.kind === 'action-item') S.actionItems.push({ id: 'a' + Date.now(), projectId: 'p1', title: p.proposal.title, owner: p.proposal.owner, due: p.proposal.due, status: 'open', blockedTaskIds: p.proposal.blockedTaskIds || [], source: 'agent' });
    if (p.kind === 'risk') S.risks.push({ id: 'rk' + Date.now(), projectId: 'p1', title: p.proposal.title, category: p.proposal.category, probability: p.proposal.probability, impact: p.proposal.impact, status: 'open', owner: '', source: 'agent', mitigation: '' });
    if (p.kind === 'report') S.approvedReport = p.proposal;
    audit('approve-proposal', `${p.agent}: ${p.kind}`);
    render(); toast('Approved — applied and audited as human-approved');
  },
  reject(id) {
    const p = S.agentInbox.find(x => x.id === id);
    // The reason is the point: rejections are the eval corpus that tells
    // us WHY an agent was wrong.
    const reason = prompt(`Why is this ${p.kind} proposal wrong?\n(Recorded — rejection reasons train the agent evals.)`, '');
    if (reason === null) return;
    p.status = 'rejected';
    p.rejectionReason = reason.trim() || '(no reason given)';
    audit('reject-proposal', `${p.agent}: ${p.kind} — ${p.rejectionReason}`);
    render(); toast('Rejected — reason recorded for the eval corpus');
  },
};

// Every plan-mutating UI action snapshots first — this is what Undo walks back.
// (Product design: command-pattern undo derived from the audit_event stream.)
['applyTaskEdit', 'deleteTask', 'addDepFromEditor', 'removeDep', 'addTask', 'addMilestone',
  'addGroup', 'addBelow', 'addAbove', 'indent', 'outdent', 'renameTask', 'drop', 'setPreds',
  'cellDur', 'cellPct', 'cellStart', 'cellFinish', 'cellRes', 'clearConstraint', 'setProjectStart'].forEach(k => {
  const f = window.UI[k];
  window.UI[k] = (...a) => { snapshot(); return f(...a); };
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.target.matches('input,select,textarea')) {
    e.preventDefault();
    window.UI.undo();
  }
});

// ───────────────────────── Chat (mock router + fake LLM) ─────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function addMsg(cls, html) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.innerHTML = html;
  $('#msgs').appendChild(div);
  $('#msgs').scrollTop = $('#msgs').scrollHeight;
  return div;
}

function fuzzyTasks(q) {
  q = q.toLowerCase().replace(/task$/, '').trim();
  const toks = q.split(/\s+/).filter(Boolean);
  const scored = leaves().map(t => {
    const name = t.name.toLowerCase();
    let s = name.includes(q) ? 10 : 0;
    toks.forEach(tok => { if (name.includes(tok)) s += 1; });
    return { t, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return { match: null };
  if (scored.length > 1 && scored[1].s === scored[0].s) return { ambiguous: scored.filter(x => x.s === scored[0].s).map(x => x.t) };
  return { match: scored[0].t };
}

function diffHtml(diff) {
  const rows = diff.changed.filter(c => c.datesChanged && c.kind !== 'summary').slice(0, 6).map(c =>
    `<tr><td>${esc(c.name)}</td><td>${fmtShort(c.before.startDate)}–${fmtShort(c.before.finishDate)}</td><td>→</td>
     <td class="${c.after.ef > c.before.ef ? 'worse' : ''}">${fmtShort(c.after.startDate)}–${fmtShort(c.after.finishDate)}</td></tr>`).join('');
  const more = diff.changed.length > 6 ? `<span class="diff-line">…and ${diff.changed.length - 6} more</span>` : '';
  const ms = diff.milestoneDeltas.map(m => `<span class="diff-line worse">◆ ${esc(m.name)} slips +${m.deltaDays}d</span>`).join('');
  return `<table>${rows}</table>${more}${ms}
    <span class="diff-line">${diff.newlyCritical ? `<b class="worse">${diff.newlyCritical} task(s) newly critical.</b> ` : ''}Project finish ${diff.finishDeltaDays > 0 ? `<b class="worse">+${diff.finishDeltaDays}d</b>` : diff.finishDeltaDays < 0 ? `<b>${diff.finishDeltaDays}d (earlier)</b>` : 'unchanged'}.</span>`;
}

function gate(description, html, apply) {
  pendingAction = { apply, description };
  addMsg('bot', `<b>${esc(description)}</b><br>${html}
    <span class="confirmrow"><button class="btn primary small" onclick="confirmPending(true)">Confirm</button>
    <button class="btn small" onclick="confirmPending(false)">Cancel</button></span>`);
}

window.confirmPending = ok => {
  if (!pendingAction) return;
  const p = pendingAction; pendingAction = null;
  if (ok) { snapshot(); baselineView = null; p.apply(); audit('chat-write', p.description); addMsg('bot', '✅ Done — recomputed & audited (channel: chat). Undoable from the Gantt toolbar.'); render(); }
  else addMsg('bot', 'Cancelled — nothing changed.');
};

function clarifyTask(cands) {
  addMsg('bot', `Which task did you mean?<br>${cands.map(t => `· ${esc(t.name)}`).join('<br>')}<br><i>(clarify() — the router never guesses a write target)</i>`);
}

const ROUTES = [
  {
    re: /(?:push|delay|slip|move)\s+(.+?)\s+(?:out\s+|by\s+|back\s+)?(\d+)\s*d/i, toolset: 'schedule-edit',
    run(m) {
      const f = fuzzyTasks(m[1]);
      if (f.ambiguous) return clarifyTask(f.ambiguous);
      if (!f.match) return addMsg('bot', `Couldn't find a task matching "${esc(m[1])}".`);
      const n = +m[2];
      const cur = sched().tasks[f.match.id];
      const diff = Engine.whatIf(plan(), p => { p.tasks.find(t => t.id === f.match.id).constraint = { type: 'SNET', offset: cur.es + n }; });
      gate(`Push "${f.match.name}" out ${n} working day(s)`, diffHtml(diff),
        () => { taskById(f.match.id).constraint = { type: 'SNET', offset: cur.es + n }; });
    },
  },
  {
    re: /duration\s+(?:of\s+)?(.+?)\s+to\s+(\d+)/i, toolset: 'schedule-edit',
    run(m) {
      const f = fuzzyTasks(m[1]);
      if (f.ambiguous) return clarifyTask(f.ambiguous);
      if (!f.match) return addMsg('bot', `Couldn't find a task matching "${esc(m[1])}".`);
      const n = +m[2];
      const diff = Engine.whatIf(plan(), p => { p.tasks.find(t => t.id === f.match.id).duration = n; });
      gate(`Change "${f.match.name}" duration to ${n}d`, diffHtml(diff), () => { taskById(f.match.id).duration = n; });
    },
  },
  {
    re: /add\s+(?:a\s+)?dependency\s+(?:between\s+|from\s+)?(.+?)\s+(?:->|→|and|to)\s+(.+)/i, toolset: 'schedule-edit',
    run(m) {
      const a = fuzzyTasks(m[1]), b = fuzzyTasks(m[2]);
      if (a.ambiguous) return clarifyTask(a.ambiguous);
      if (b.ambiguous) return clarifyTask(b.ambiguous);
      if (!a.match || !b.match) return addMsg('bot', `Couldn't resolve both tasks.`);
      const diff = Engine.whatIf(plan(), p => { p.deps.push({ pred: a.match.id, succ: b.match.id, type: 'FS', lag: 0 }); });
      gate(`Add dependency: "${a.match.name}" →FS "${b.match.name}"`, diffHtml(diff),
        () => plan().deps.push({ pred: a.match.id, succ: b.match.id, type: 'FS', lag: 0 }));
    },
  },
  {
    re: /assign\s+(.+?)\s+to\s+(.+)/i, toolset: 'assignments',
    run(m) {
      const res = S.resources.find(r => r.name.toLowerCase().includes(m[1].toLowerCase()));
      const f = fuzzyTasks(m[2]);
      if (!res) return addMsg('bot', `No resource matching "${esc(m[1])}". Resources: ${S.resources.map(r => r.name).join(', ')}.`);
      if (f.ambiguous) return clarifyTask(f.ambiguous);
      if (!f.match) return addMsg('bot', `Couldn't find task "${esc(m[2])}".`);
      gate(`Assign ${res.name} to "${f.match.name}" at 100%`, '<span class="diff-line">No schedule impact (duration-driven v1).</span>',
        () => S.assignments.push({ taskId: f.match.id, resourceId: res.id, units: 100 }));
    },
  },
  {
    // Added 2026-08-07 after a router miss ("what tasks are assigned to Priya")
    // — the misroute→new-example-utterance learning loop.
    re: /assigned to|working on|(?:tasks|workload)\s+(?:of|for)\b/i, toolset: 'assignments',
    run(m) {
      // resolve the resource by scanning the utterance for known names —
      // deterministic name resolution, never in the model's head
      const txt = m.input.toLowerCase();
      const res = S.resources.find(r => txt.includes(r.name.toLowerCase().split(' ')[0]));
      if (!res) return addMsg('bot', `Whose tasks? Resources: ${S.resources.map(r => r.name).join(', ')}. <i>(clarify())</i>`);
      const sc = sched();
      const lines = S.assignments.filter(a => a.resourceId === res.id)
        .map(a => taskById(a.taskId)).filter(Boolean)
        .map(t => `· <b>${esc(t.name)}</b> — ${fmtShort(sc.tasks[t.id].startDate)} → ${fmtShort(sc.tasks[t.id].finishDate)}${sc.tasks[t.id].critical ? ' <span class="worse">(critical)</span>' : ''}`);
      addMsg('bot', lines.length ? `${esc(res.name)}'s tasks:<br>${lines.join('<br>')}` : `${esc(res.name)} has no assignments in this project.`);
    },
  },
  {
    re: /critical\s*path/i, toolset: 'schedule-read',
    run() {
      const sc = sched();
      addMsg('bot', `Critical path (${sc.criticalPath.length} tasks), finish ${fmtShort(sc.finishDate)}:<br>` +
        sc.criticalPath.map(id => `· ${esc(taskById(id).name)}`).join('<br>'));
      currentTab = 'gantt'; render();
    },
  },
  {
    re: /milestone/i, toolset: 'schedule-read',
    run() {
      const sc = sched();
      addMsg('bot', plan().tasks.filter(t => t.kind === 'milestone')
        .map(t => `◆ ${esc(t.name)} — ${fmtShort(sc.tasks[t.id].startDate)}${sc.tasks[t.id].critical ? ' (critical)' : ''}`).join('<br>') || 'No milestones.');
    },
  },
  {
    re: /how are we doing|health|status\b|doing\?/i, toolset: 'status-metrics',
    run() {
      const sc = sched();
      const base = latestBaselineSched();
      const delta = base ? sc.projectFinish - base.projectFinish : 0;
      const overdue = S.actionItems.filter(a => a.projectId === currentProject && a.status === 'open' && a.due < todayStr);
      const topRisk = S.risks.filter(r => r.projectId === currentProject && r.status !== 'closed').sort((a, b) => b.probability * b.impact - a.probability * a.impact)[0];
      addMsg('bot', `Finish ${fmtShort(sc.finishDate)} (${delta > 0 ? `<b class="worse">+${delta}d vs baseline</b>` : 'on baseline'}). ` +
        `${sc.criticalPath.length} tasks critical. ${overdue.length} overdue action item(s).` +
        (topRisk ? ` Top risk: "${esc(topRisk.title)}" (score ${topRisk.probability * topRisk.impact}).` : '') +
        `<br><i>Numbers from engine/SQL — the LLM only narrates.</i>`);
      currentTab = 'status'; render();
    },
  },
  {
    re: /action items|overdue|follow up/i, toolset: 'action-items',
    run() {
      const ais = S.actionItems.filter(a => a.projectId === currentProject && a.status === 'open');
      addMsg('bot', ais.map(a => `· <b>${esc(a.title)}</b> — ${esc(a.owner)}, due ${fmtShort(a.due)}${a.due < todayStr ? ' <b class="worse">(overdue)</b>' : ''}`).join('<br>') || 'No open action items.');
      currentTab = 'actions'; render();
    },
  },
  {
    re: /(?:add|create|log)\s+(?:a\s+)?risk[:\s]+(.+)/i, toolset: 'risks',
    run(m) {
      gate(`Create risk: "${m[1]}" (P3×I3 default)`, '',
        () => S.risks.push({ id: 'rk' + Date.now(), projectId: currentProject, title: m[1], category: 'general', probability: 3, impact: 3, status: 'open', owner: '', source: 'human', mitigation: '' }));
    },
  },
  {
    re: /risks?\b/i, toolset: 'risks',
    run() {
      const rs = S.risks.filter(r => r.projectId === currentProject && r.status !== 'closed').sort((a, b) => b.probability * b.impact - a.probability * a.impact);
      addMsg('bot', rs.map(r => `· <b>${esc(r.title)}</b> P${r.probability}×I${r.impact}=${r.probability * r.impact} (${r.status})`).join('<br>') || 'Register is empty.');
      currentTab = 'risks'; render();
    },
  },
  {
    re: /draft.*report|weekly report|exec summary/i, toolset: 'reporting',
    run() {
      addMsg('bot', 'Queued the Reporting Agent — a draft proposal will appear in the Agent Inbox for your review. (v1: reports are draft/view only; you send them yourself.)');
      setTimeout(() => {
        S.agentInbox.push({ id: 'ar' + Date.now(), agent: 'Reporting Agent', kind: 'report', status: 'proposed', proposal: { rag: 'amber', highlights: ['Build phase progressing'], lowlights: ['Storage vendor risk unresolved'], sentiment: 'Sentiment stable-to-anxious.', asks: ['Vendor escalation'] }, evidence: 'Sources: current schedule, open risks, check-ins.' });
        render(); toast('🤖 Reporting Agent proposal arrived in Inbox');
      }, 1500);
    },
  },
];

async function handleUtterance(text) {
  addMsg('user', esc(text));
  const think = addMsg('sys', 'thinking…');
  await sleep(450);
  const route = ROUTES.find(r => r.re.test(text));
  think.textContent = route ? `routed → ${route.toolset} (${route === ROUTES[0] ? 'keyword fast path' : 'semantic'})` : 'router unsure → route_help()';
  // chat_utterance log: answered = routed; unroutable → feature_request = Y
  S.chatLog.unshift({ at: new Date().toLocaleTimeString(), text, toolset: route ? route.toolset : '—', answered: !!route, fr: !route });
  renderShell();
  if (currentTab === 'chatlog') render();
  await sleep(450);
  if (!route) {
    addMsg('bot', `I can help with:<br>· <b>schedule</b> — "push DB migration out 3 days", "critical path", "milestones"<br>· <b>status</b> — "how are we doing?"<br>· <b>risks</b> — "add risk: …", "show risks"<br>· <b>action items</b> — "show overdue"<br>· <b>assignments</b> — "assign Priya to pilot"<br>· <b>reporting</b> — "draft the weekly report"<br><br><i>📋 Logged with feature_request=Y — see the Chat Log tab. Unanswerable questions become feature-list candidates.</i>`);
    return;
  }
  route.run(text.match(route.re));
}

$('#chatform').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#chatinput').value.trim();
  if (!v) return;
  $('#chatinput').value = '';
  handleUtterance(v);
});

const SUGGESTIONS = ['how are we doing?', 'push DB migration out 3 days', 'critical path', 'milestones', 'assign Priya to app wave 1', 'add risk: CAB window not approved', 'draft the weekly report', 'show overdue'];
$('#suggest').innerHTML = SUGGESTIONS.map(s => `<button onclick="document.getElementById('chatinput').value='${s}';document.getElementById('chatform').requestSubmit()">${s}</button>`).join('');

addMsg('bot', 'Hi — I\'m the chat surface mock (regex router standing in for Gemma + the hybrid tool router). Try a suggestion below. Writes always show a what-if preview first.');
render();
