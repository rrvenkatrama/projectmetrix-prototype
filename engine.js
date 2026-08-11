// Mini CPM engine. A simplified sibling of the standalone engine at
// github.com/rrvenkatrama/cpm-scheduling-engine
// Works in whole working days (weekends off), offsets from project start.
// Real engine: working minutes, calendars, all constraint types.
const Engine = (() => {
  const DAY = 86400000;

  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const isWorkday = d => d.getDay() > 0 && d.getDay() < 6;

  // offset = index of working day from project start (0 = first working day)
  function offsetToDate(startStr, offset) {
    let d = parseDate(startStr);
    while (!isWorkday(d)) d = new Date(d.getTime() + DAY);
    let n = 0;
    while (n < offset) {
      d = new Date(d.getTime() + DAY);
      if (isWorkday(d)) n++;
    }
    return d;
  }

  // Memoized offset→date table: one O(calendar-span) walk instead of
  // O(offset) walks per task. This is the "memoize per-calendar day maps"
  // optimization — calendar math dominates CPM cost.
  function dayTable(startStr, maxOffset) {
    const table = new Array(maxOffset + 1);
    let d = parseDate(startStr);
    while (!isWorkday(d)) d = new Date(d.getTime() + DAY);
    table[0] = fmtDate(d);
    let n = 0;
    while (n < maxOffset) {
      d = new Date(d.getTime() + DAY);
      if (isWorkday(d)) table[++n] = fmtDate(d);
    }
    return table;
  }

  function dateToOffset(startStr, dateStr) {
    let d = parseDate(startStr);
    while (!isWorkday(d)) d = new Date(d.getTime() + DAY);
    const target = parseDate(dateStr).getTime();
    let n = 0;
    while (d.getTime() < target) {
      d = new Date(d.getTime() + DAY);
      if (isWorkday(d)) n++;
    }
    return n;
  }

  function compute(plan) {
    const tasks = plan.tasks;
    const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
    const leaves = tasks.filter(t => t.kind !== 'summary');
    const deps = plan.deps.filter(d => byId[d.pred] && byId[d.succ]);
    const diagnostics = [];

    const succs = {}, preds = {}, indeg = {};
    leaves.forEach(t => { succs[t.id] = []; preds[t.id] = []; indeg[t.id] = 0; });
    deps.forEach(d => {
      if (succs[d.pred] && preds[d.succ]) {
        succs[d.pred].push(d); preds[d.succ].push(d); indeg[d.succ]++;
      } else {
        diagnostics.push({ code: 'orphan_dependency', message: `Link ${byId[d.pred]?.name || d.pred} → ${byId[d.succ]?.name || d.succ} ignored (endpoint is a summary task)` });
      }
    });

    // Kahn topological order; cycles reported, never thrown
    const order = [];
    const q = leaves.filter(t => indeg[t.id] === 0).map(t => t.id);
    while (q.length) {
      const id = q.shift();
      order.push(id);
      succs[id].forEach(d => { if (--indeg[d.succ] === 0) q.push(d.succ); });
    }
    if (order.length < leaves.length) {
      diagnostics.push({ code: 'cycle', message: 'Dependency cycle detected — some links ignored in this compute' });
      leaves.forEach(t => { if (!order.includes(t.id)) order.push(t.id); });
    }

    const R = {};
    // forward pass
    order.forEach(id => {
      const t = byId[id];
      const dur = t.kind === 'milestone' ? 0 : (t.duration || 0);
      let es = 0;
      preds[id].forEach(d => {
        const p = R[d.pred];
        if (!p) return;
        const lag = d.lag || 0;
        let cand;
        if (d.type === 'SS') cand = p.es + lag;
        else if (d.type === 'FF') cand = p.ef + lag - dur;
        else if (d.type === 'SF') cand = p.es + lag - dur;
        else cand = p.ef + lag; // FS
        es = Math.max(es, cand);
      });
      if (t.constraint?.type === 'SNET') es = Math.max(es, t.constraint.offset);
      if (t.constraint?.type === 'MSO') {
        if (es > t.constraint.offset) diagnostics.push({ code: 'constraint_conflict', message: `"${t.name}" MSO conflicts with predecessors` });
        es = t.constraint.offset;
      }
      R[id] = { es, ef: es + dur, dur };
    });

    const projectFinish = Math.max(0, ...Object.values(R).map(r => r.ef));

    // backward pass
    [...order].reverse().forEach(id => {
      const r = R[id];
      let lf = projectFinish;
      succs[id].forEach(d => {
        const s = R[d.succ];
        // A successor without late dates yet means `order` was not a valid
        // reverse-topological order — only possible when a cycle was
        // detected and its nodes appended. Skip it rather than propagate
        // NaN through every float on the plan.
        if (!s || !Number.isFinite(s.ls) || !Number.isFinite(s.lf)) return;
        const lag = d.lag || 0;
        let cand;
        if (d.type === 'SS') cand = s.ls - lag + r.dur;
        else if (d.type === 'FF') cand = s.lf - lag;
        else if (d.type === 'SF') cand = s.lf - lag + r.dur;
        else cand = s.ls - lag; // FS
        lf = Math.min(lf, cand);
      });
      r.lf = Number.isFinite(lf) ? lf : projectFinish;
      r.ls = r.lf - r.dur;
      r.float = r.ls - r.es;
      r.critical = r.float <= 0;
      if (r.float < 0) diagnostics.push({ code: 'negative_float', message: `"${byId[id].name}" has negative float (${r.float}d)` });
    });

    // summary rollup (min/max over descendant leaves; critical if any child is)
    const childrenOf = pid => tasks.filter(t => t.parentId === pid);
    function leafDescendants(id) {
      return childrenOf(id).flatMap(c => c.kind === 'summary' ? leafDescendants(c.id) : [c.id]);
    }
    tasks.filter(t => t.kind === 'summary').forEach(s => {
      const ds = leafDescendants(s.id).map(id => R[id]).filter(Boolean);
      if (!ds.length) return;
      const es = Math.min(...ds.map(r => r.es));
      const ef = Math.max(...ds.map(r => r.ef));
      R[s.id] = { es, ef, dur: ef - es, float: 0, critical: ds.some(r => r.critical), summary: true };
    });

    const maxOff = Math.max(projectFinish, ...Object.values(R).map(r => r.ef));
    const table = dayTable(plan.start, maxOff);
    const out = {};
    for (const [id, r] of Object.entries(R)) {
      out[id] = {
        ...r,
        startDate: table[r.es],
        finishDate: table[r.dur > 0 ? r.ef - 1 : r.es],
      };
    }

    const criticalPath = order.filter(id => R[id] && R[id].critical && byId[id].kind !== 'summary');

    return {
      tasks: out,
      projectFinish,
      finishDate: table[Math.max(projectFinish - 1, 0)],
      criticalPath,
      diagnostics,
    };
  }

  // what-if: compute on a mutated copy, return the diff — the write gate's payload
  function whatIf(plan, mutator) {
    const before = compute(plan);
    const p2 = structuredClone(plan);
    mutator(p2);
    const after = compute(p2);
    const changed = [];
    const milestoneDeltas = [];
    for (const t of p2.tasks) {
      const b = before.tasks[t.id], a = after.tasks[t.id];
      if (!b || !a) continue;
      const datesChanged = b.startDate !== a.startDate || b.finishDate !== a.finishDate;
      if (datesChanged || b.critical !== a.critical) {
        changed.push({ id: t.id, name: t.name, kind: t.kind, before: b, after: a, datesChanged });
        if (t.kind === 'milestone' && a.es !== b.es) milestoneDeltas.push({ id: t.id, name: t.name, deltaDays: a.es - b.es });
      }
    }
    return {
      before, after, changed, milestoneDeltas,
      finishDeltaDays: after.projectFinish - before.projectFinish,
      newlyCritical: changed.filter(c => !c.before.critical && c.after.critical).length,
      plan: p2,
    };
  }

  // impactOf: slip the given tasks N days → downstream effect (Action Item Agent's walk)
  function impactOf(plan, taskIds, slipDays) {
    const base = compute(plan);
    const diff = whatIf(plan, p => {
      taskIds.forEach(id => {
        const t = p.tasks.find(x => x.id === id);
        if (t && base.tasks[id]) t.constraint = { type: 'SNET', offset: base.tasks[id].es + slipDays };
      });
    });
    const downstream = diff.changed.filter(c => c.datesChanged && !taskIds.includes(c.id) && c.kind !== 'summary' && c.kind !== 'milestone');
    return { downstream, milestoneDeltas: diff.milestoneDeltas, finishDeltaDays: diff.finishDeltaDays };
  }

  return { compute, whatIf, impactOf, offsetToDate, dateToOffset, dayTable, fmtDate, parseDate };
})();
