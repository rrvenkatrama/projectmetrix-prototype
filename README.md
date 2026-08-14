# ProjectMetrix — interactive prototype

**[▶ Try it live](https://rrvenkatrama.github.io/projectmetrix-prototype/)**

A working prototype of [ProjectMetrix](https://projectmetrix.dev) — project,
program and portfolio management for enterprise IT teams. Five files of
vanilla JavaScript, no dependencies, no build step. Open `index.html` and it
runs.

It exists to make design decisions tangible: it is far easier to argue about
a scheduling interaction you can click than one described in a document.

## What to try

**Edit the plan.** Change a duration in the grid and watch every downstream
date move. Drag a task to reorder it, indent it to make it a subtask, or
type `3FS+2` in the predecessors column.

**Filter to the critical path.** The plan collapses to the zero-float chain
that actually drives the finish date.

**Ask the assistant.** Open the chat and try *"push DB migration out 3
days"*. Before anything changes, you get the full impact: which tasks move,
which milestones slip, and what it does to the finish date — then you
confirm or cancel. That preview-before-write gate is the point of the whole
interaction.

**Generate 1,200 tasks.** The ⚡ button builds a large plan so you can feel
the engine at scale. The badge in the corner separates engine time from
rendering time.

**Take a baseline, then break the plan.** Save a baseline, push some dates
out, and watch variance appear in the status view — including *why* the
health indicator is the colour it is.

## What is real and what is faked

Being clear about this matters more than looking impressive:

| Real | Simulated |
|---|---|
| Critical path engine — forward/backward pass, four dependency types with lag, working-day calendars, float, cycle detection | The language model. A regex router stands in for real intent classification |
| What-if simulation and impact analysis | The AI agents. Inbox proposals are seeded, not generated |
| Baselines and plan-versus-actual variance | Metrics, which are simple calculations over the demo data |
| Portfolio and program rollups, computed health with reasons | Emails, which show a toast instead of sending |

The scheduling is genuine. Every date, float value and milestone slip you
see is computed by the engine in `engine.js` — a simplified sibling of the
standalone [cpm-scheduling-engine](https://github.com/rrvenkatrama/cpm-scheduling-engine),
which has a full test suite.

## Files

```
index.html   markup and layout
style.css    all styling
engine.js    the CPM scheduling engine
data.js      demo portfolio: 2 programs, 3 projects, people directory
app.js       views, editing, chat, agent inbox, lifecycle
```

State persists to `localStorage`, so your edits survive a refresh. **Reset
demo** in the header restores the seed data.

## Feedback wanted

If you are testing this, please tell me what you found — especially the
parts that annoyed you.

**[Report a bug](https://github.com/rrvenkatrama/projectmetrix-prototype/issues/new?template=bug_report.yml)**
· **[Request a feature](https://github.com/rrvenkatrama/projectmetrix-prototype/issues/new?template=feature_request.yml)**
· **[General feedback](https://github.com/rrvenkatrama/projectmetrix-prototype/issues/new?template=feedback.yml)**
· **[Browse what's already reported](https://github.com/rrvenkatrama/projectmetrix-prototype/issues)**

A GitHub account is needed to post. If you would rather not create one,
email works too — the address is in the issue page's sidebar links.

Feature requests describing the *situation* you were in are worth more than
ones describing a feature, and confusing interactions are bugs. Feedback on
the prototype shapes the real product, so nothing is too small.

## Status

This is a prototype, not the product. It is deliberately quick and dirty in
places — global state, full re-render on every keystroke, no tests — because
its job is to answer design questions quickly, not to be maintained. The
production implementation is a separate, private codebase.

## License

MIT
