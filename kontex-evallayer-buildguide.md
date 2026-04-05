# Kontex Eval Layer UI — Build Guide

Read this guide alongside `kontex-dashboard/CLAUDE.md`. Every sprint assumes:
- The backend eval layer (Sprints 9–10 of `kontex-backend-2.0-buildguide.md`) is running and serving eval data
- The dashboard is fully wired (`kontex-dashboard-2.0-buildguide.md` complete)
- All existing pages (Sessions, Signals, Timeline, Diff, Search, Usage) are untouched

**Starting state:** No eval data surfaces anywhere in the UI.  
**Ending state:** Inline eval health on Sessions table and Timeline. Dedicated Evaluations page with snapshot scores, flags feed, evaluator config, and trajectory charts.

**Prerequisite:** Backend eval layer (Sprints 12–13 of `kontex-eval-backend-buildguide.md`) must be running before any UI sprint is executed.

**Additive only — no existing pages are modified except for the two inline indicator additions (UI-1).**

---

## Stack

| Concern | Choice |
|---|---|
| Framework | React 19 + Vite |
| Styling | Tailwind CSS — custom colors in `tailwind.config.js` |
| Data fetching | @tanstack/react-query v5 via `apiFetch` |
| State | Zustand — `sessionStore` + `uiStore` |
| Navigation | React Router v7 — `useNavigate` + `<NavLink>` |
| Charts | Inline SVG — no external chart library |
| Auth | `kontex_api_key` in localStorage · `Authorization: Bearer` header |

### Color Reference (Tailwind → Eval Concepts)

| Eval concept | Tailwind class |
|---|---|
| Good score (≥0.7 / 4–5) | `text-teal` `bg-teal/10` `border-teal/20` |
| Warn score (0.4–0.7 / 3) | `text-amber` `bg-amber/10` `border-amber/20` |
| Poor score (<0.4 / 1–2) | `text-red` `bg-red/10` `border-red/20` |
| Null / no data | `text-subtle/60` `bg-border` |
| Flagged item | `bg-red/5` `border-red/25` |
| Surface | `bg-surface` (#111113) |
| Inset surface | `bg-[#0D0D0F]` |
| Sunken | `bg-border` (#1E1E22) |

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| UI-1 | Inline eval health indicators | `EvalScoreBadge`, `EvalHealthBar`, SessionList column, Timeline row |
| UI-2 | Evaluations page | `EvaluationsPage`, score table, flags feed, evaluator config panel |
| UI-3 | Trajectory charts | `TrajectoryChart` SVG, trajectory tab, filter toggle |

---

# Sprint UI-1 — Inline Eval Health Indicators

**Goal:** Without opening any new page, a user glancing at the Sessions table or Timeline immediately sees eval health. One compact signal per snapshot. Zero new pages this sprint.

**Done criteria:**
- [ ] `src/hooks/useEvals.js` created with `useSessionEvals` and `useEvalFlags`
- [ ] `EvalScoreBadge.jsx` renders a colored badge for a single score
- [ ] `EvalHealthBar.jsx` renders a compact 8-bar strip
- [ ] Sessions table: "Eval health" column renders the strip for each session's most recent snapshot
- [ ] Timeline: each snapshot entry shows the health strip below the token/source line
- [ ] Clicking a health strip navigates to `/evaluations` with that session active
- [ ] Graceful empty/loading states — no console errors when no eval data exists
- [ ] No layout shifts on any existing page

---

## Prompt UI-1.1 — Eval hooks

```
Create src/hooks/useEvals.js.

All hooks use apiFetch from src/api/client.js and useQuery/useMutation from @tanstack/react-query.
Follow the exact pattern in src/hooks/useKontexAPI.js.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../api/client"

// Evals for a single snapshot
export function useSnapshotEvals(snapshotId) {
  return useQuery({
    queryKey: ["snapshot-evals", snapshotId],
    queryFn: () => apiFetch(`/v1/snapshots/${snapshotId}/evals`),
    enabled: !!snapshotId,
    staleTime: 60_000,
  })
}

// All evals for a session (one item per snapshot, ordered by createdAt desc)
// Response shape: [{ snapshotId, createdAt, evals: EvalRun[] }]
export function useSessionEvals(sessionId) {
  return useQuery({
    queryKey: ["session-evals", sessionId],
    queryFn: () => apiFetch(`/v1/sessions/${sessionId}/evals`),
    enabled: !!sessionId,
    staleTime: 60_000,
  })
}

// Trajectory time-series per trajectory evaluator
// Response shape: [{ evaluatorId, trend, summary, points: [{ snapshotId, score, createdAt }] }]
export function useSessionEvalsTrajectory(sessionId, enabled = true) {
  return useQuery({
    queryKey: ["session-evals-trajectory", sessionId],
    queryFn: () => apiFetch(`/v1/sessions/${sessionId}/evals/trajectory`),
    enabled: !!sessionId && enabled,
    staleTime: 120_000,
  })
}

// All flagged evals for the authenticated user
// Optional sessionId scopes to that session
export function useEvalFlags(sessionId) {
  const params = sessionId ? `?session_id=${sessionId}` : ""
  return useQuery({
    queryKey: ["eval-flags", sessionId ?? "all"],
    queryFn: () => apiFetch(`/v1/evals/flags${params}`),
    staleTime: 30_000,
  })
}

// Evaluator registry (for display names and descriptions)
export function useEvaluators() {
  return useQuery({
    queryKey: ["evaluators"],
    queryFn: () => apiFetch("/v1/evaluators"),
    staleTime: 300_000,
  })
}

// Current evaluator config (enabled/disabled + thresholds)
export function useEvalConfig() {
  return useQuery({
    queryKey: ["eval-config"],
    queryFn: () => apiFetch("/v1/eval-config"),
    staleTime: 60_000,
  })
}

// Update evaluator config (toggle enabled, set threshold)
export function useUpdateEvalConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch("/v1/eval-config", { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-config"] }),
  })
}

// Trigger a manual eval re-run for a snapshot
// body: { tier: "deterministic" | "llm_judge" | "all" }
export function useRunEvals(snapshotId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => apiFetch(`/v1/snapshots/${snapshotId}/evals/run`, { method: "POST", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["snapshot-evals", snapshotId] })
    },
  })
}
```

---

## Prompt UI-1.2 — EvalScoreBadge component

```
Create src/components/evals/EvalScoreBadge.jsx.

Props:
  score        number | null
  evaluatorId  string
  size         "xs" | "sm" | "md"   (default "sm")
  showLabel    boolean               (default false)

Short label map (evaluatorId → label):
  token_efficiency        → "efficiency"
  tool_call_success_rate  → "tools"
  task_completion_rate    → "completion"
  latency_per_turn        → "latency"
  cost_per_task           → "cost"
  loop_detection          → "loop"
  context_bloat           → "bloat"
  rollback_frequency      → "rollbacks"
  task_adherence          → "task"
  reasoning_quality       → "reasoning"
  tool_selection_quality  → "tool sel."
  response_groundedness   → "grounded"
  instruction_following   → "instruct."
  hallucination_risk      → "halluc."

Color logic:
  If score is null:
    → <span className="font-mono text-subtle/60">—</span>

  If score is 0–1 float (deterministic):
    < 0.4    → text-red bg-red/10 border border-red/20
    0.4–0.7  → text-amber bg-amber/10 border border-amber/20
    ≥ 0.7    → text-teal bg-teal/10 border border-teal/20
    Display: Math.round(score * 100) + "%"

  If score is 1–5 integer (LLM judge):
    ≤ 2  → red colors
    3    → amber colors
    4–5  → teal colors
    Display: score + "/5"

Size Tailwind classes:
  xs: "text-[9px] px-1 py-0 rounded-sm"
  sm: "text-[10px] px-1.5 py-0.5 rounded-sm"   ← default
  md: "text-[11px] px-2 py-0.5 rounded"

Always apply: font-mono

If showLabel is true, prefix with the short label and a space.

Example output for sm, score 0.5:
  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm text-amber bg-amber/10 border border-amber/20">
    50%
  </span>
```

---

## Prompt UI-1.3 — EvalHealthBar component

```
Create src/components/evals/EvalHealthBar.jsx.

A compact horizontal strip of 8 small bars — one per deterministic evaluator.
Designed to fit inline in a table row or timeline entry (~128px total width).

Props:
  evals      Array<{ evaluatorId: string, score: number | null, flagged: boolean }>
             Pass empty array [] when no data (renders dashes, not an error).
  onBarClick function(evaluatorId) — called when a single bar is clicked
  loading    boolean — show skeleton bars

FIXED BAR ORDER (always render in this sequence):
  1. token_efficiency
  2. tool_call_success_rate
  3. task_completion_rate
  4. latency_per_turn      ← lower is better, invert for display
  5. cost_per_task         ← lower is better, invert for display
  6. loop_detection        ← 1 = clean (good), 0 = loop detected (bad)
  7. context_bloat         ← lower is better, invert for display
  8. rollback_frequency    ← lower is better, invert for display

Inversion normalizers (display only, never modify stored score):
  latency_per_turn:  normalizer = 2000   displayScore = Math.max(0, 1 - rawScore / 2000)
  cost_per_task:     normalizer = 0.10   displayScore = Math.max(0, 1 - rawScore / 0.10)
  context_bloat:     normalizer = 1.0    displayScore = Math.max(0, 1 - rawScore)
  rollback_frequency:normalizer = 5      displayScore = Math.max(0, 1 - rawScore / 5)

Color per bar (use displayScore for color thresholds):
  displayScore ≥ 0.7  → bg-teal
  displayScore 0.4–0.7 → bg-amber
  displayScore < 0.4  → bg-red
  score is null       → bg-border (neutral)

Bar height:
  height = (displayScore ?? 0) * 14  (px, inline style)
  minimum height 2px if score = 0
  height 4px if score is null

Layout:
  <div className="flex items-end gap-0.5 h-4">
    {8 bar divs, each:}
    <div
      className="w-2.5 rounded-t-sm cursor-pointer {colorClass}"
      style={{ height: `${barHeight}px` }}
      title="{evaluatorId}: {displayValue}"
      onClick={() => onBarClick(evaluatorId)}
    />
  </div>

After the 8 bars, if any eval has flagged === true:
  <div className="w-1 h-1 rounded-full bg-red ml-1 flex-shrink-0"
       title="{n} evaluator(s) flagged" />

Loading state (loading prop is true):
  8 bars at height 4px with bg-border and animate-pulse, no flag dot.

Empty state (evals is empty array):
  <span className="font-mono text-[10px] text-subtle/60">—</span>

Wrap everything in: <div className="flex items-center gap-1">
```

---

## Prompt UI-1.4 — Add Eval health column to Sessions table

```
Modify src/components/sessions/SessionList.jsx.

1. Import EvalHealthBar from "../evals/EvalHealthBar"
   Import useSessionEvals from "../../hooks/useEvals"
   Import useNavigate from "react-router-dom"

2. Extract each table row into a sub-component SessionRow (if not already) so each row
   can independently call useSessionEvals for its session id.
   If rows are already mapped inline, extract: const SessionRow = ({ session }) => { ... }

3. Inside SessionRow:
   const navigate = useNavigate()
   const { data: evalsData, isLoading } = useSessionEvals(session.id)

   // Most recent snapshot evals (first item in response, ordered desc)
   const latestEvals = evalsData?.[0]?.evals ?? []

4. Add header cell after the "Signals" column:
   <div className="px-5 py-3 text-xs font-sans text-subtle uppercase tracking-wide">
     Eval health
   </div>

5. Add data cell in each row after the signals cell:
   <div className="px-5 py-3">
     <div
       className="cursor-pointer"
       onClick={() => navigate('/evaluations')}
     >
       <EvalHealthBar
         evals={latestEvals}
         loading={isLoading}
         onBarClick={() => navigate('/evaluations')}
       />
     </div>
   </div>

6. The Sessions table uses CSS grid for columns. Update the grid definition to add
   one more column (~140px) after the signals column. Find the existing grid-cols
   definition on the table header and add the new column. Match whatever pattern
   the existing columns use (Tailwind grid or inline style grid-template-columns).

No existing column widths change — only the new column is added.
```

---

## Prompt UI-1.5 — Add eval health strip to Timeline page

```
Modify src/pages/TimelinePage.jsx.

1. Import EvalHealthBar from "../components/evals/EvalHealthBar"
   Import EvalScoreBadge from "../components/evals/EvalScoreBadge"
   Import useSessionEvals from "../hooks/useEvals"

2. After the existing sessionId is resolved (from URL params or store), add:
   const { data: evalsData } = useSessionEvals(sessionId)

   Build a lookup map ONCE — do not call useSessionEvals per timeline entry:
   const evalsMap = useMemo(() => {
     const map = new Map()
     if (evalsData) {
       evalsData.forEach(entry => map.set(entry.snapshotId, entry.evals))
     }
     return map
   }, [evalsData])

3. For each snapshot timeline entry (not signal events — check entry type before rendering):
   Find where the token count / source / enriched line renders.
   Below that line, add:

   {(() => {
     const entryEvals = evalsMap.get(snapshot.id) ?? []
     if (entryEvals.length === 0) return null
     const topJudge = entryEvals.find(e =>
       e.evaluatorId === "task_adherence" || e.evaluatorId === "instruction_following"
     )
     return (
       <div className="mt-1.5 flex items-center gap-2">
         <EvalHealthBar evals={entryEvals} />
         {topJudge?.score != null && (
           <EvalScoreBadge
             score={topJudge.score}
             evaluatorId={topJudge.evaluatorId}
             size="xs"
             showLabel
           />
         )}
       </div>
     )
   })()}

4. Signal entries (non-snapshot entries): do NOT add eval bars.
   Identify snapshot entries vs. signal entries by the existing type/discriminator
   already used in the timeline rendering logic.

One useSessionEvals call for the whole page. Never call it per-entry.
```

---

---

# Sprint UI-2 — Evaluations Page

**Goal:** A dedicated Evaluations page accessible from the sidebar. Shows all eval scores for the active session's snapshots, a filterable flags feed, and per-snapshot LLM judge reasoning with a config panel for enabling/disabling evaluators.

**Done criteria:**
- [ ] `Evaluations` nav item added to Sidebar under Diagnostics with flagged count badge
- [ ] Route `/evaluations` renders `EvaluationsPage`
- [ ] Stat row: 4 cards (avg tool success, loop detections, avg LLM judge, flagged count)
- [ ] Snapshot score table: all 8 deterministic scores + LLM judge column per row
- [ ] Clicking a row expands accordion with `EvalBar` (left) and `EvalReasoningBlock` (right)
- [ ] "Re-run evals" button triggers `useRunEvals` mutation and refreshes that row
- [ ] Flags feed tab shows flagged evals; scope toggle refetches
- [ ] Config panel slide-in opens on "Configure evaluators" button, PATCH fires on toggle/threshold change
- [ ] All sections have loading and empty states
- [ ] No existing page is modified (except Sidebar nav and App.jsx routes)

---

## Prompt UI-2.1 — Add route + Sidebar nav item

```
1. Modify src/App.jsx (or wherever Routes are defined):

   import EvaluationsPage from "./pages/EvaluationsPage"

   Inside <Routes>:
   <Route path="/evaluations" element={<EvaluationsPage />} />

2. Modify src/components/layout/Sidebar.jsx:

   Import useEvalFlags from "../../hooks/useEvals"
   Import NavLink from "react-router-dom"

   At the top of the Sidebar component (or inside, after existing hooks):
   const { data: flags } = useEvalFlags()
   const flagCount = flags?.length ?? 0

   Under the Diagnostics section, after the "Diff view" nav item, add:
   <NavLink
     to="/evaluations"
     className={({ isActive }) =>
       `flex items-center gap-2 px-4 py-2 text-sm font-sans cursor-pointer transition-colors
        ${isActive
          ? "bg-[#00E5CC15] text-teal border-l-2 border-teal"
          : "text-subtle hover:text-text hover:bg-surface border-l-2 border-transparent"
        }`
     }
   >
     Evaluations
     {flagCount > 0 && (
       <span className="ml-auto text-[10px] font-mono bg-amber/20 text-amber px-1.5 py-0.5 rounded-sm">
         {flagCount}
       </span>
     )}
   </NavLink>

   Match the exact className pattern of the existing nav items — look at how Signals,
   Timeline, and Diff are styled and copy that pattern exactly.
```

---

## Prompt UI-2.2 — EvalBar component

```
Create src/components/evals/EvalBar.jsx.

A single horizontal bar showing one deterministic evaluator's score.
Used inside the accordion detail panel (8 instances per expanded snapshot row).

Props:
  evaluatorId  string
  score        number | null
  flagged      boolean
  meta         object | null   ← from EvalRun.meta field

Display name map:
  token_efficiency        → "Token efficiency"
  tool_call_success_rate  → "Tool success rate"
  task_completion_rate    → "Task completion"
  latency_per_turn        → "Latency / turn"
  cost_per_task           → "Cost per task"
  loop_detection          → "Loop detection"
  context_bloat           → "Context bloat"
  rollback_frequency      → "Rollback count"

Formatted value (right side of bar):
  token_efficiency        → Math.round(score * 100) + "%" or "—"
  tool_call_success_rate  → Math.round(score * 100) + "%" or "—"
  task_completion_rate    → Math.round(score * 100) + "%" or "—"
  latency_per_turn        → meta?.estimatedMs ? (meta.estimatedMs).toLocaleString() + " ms" : score ? Math.round(score) + " ms" : "—"
  cost_per_task           → meta?.costUsd ? "$" + meta.costUsd.toFixed(4) : score ? "$" + score.toFixed(4) : "—"
  loop_detection          → score === 1 ? "clean" : score === 0 ? "loop detected" : "—"
  context_bloat           → meta?.growthRatio != null ? "+" + Math.round(meta.growthRatio * 100) + "%" : score != null ? Math.round(score * 100) + "%" : "—"
  rollback_frequency      → meta?.rollbackCount != null ? String(meta.rollbackCount) : score != null ? String(Math.round(score)) : "—"

Bar fill width (display only — same inversion logic as EvalHealthBar):
  Higher-is-better (efficiency, tools, completion, loop): fillPct = (score ?? 0) * 100
  Lower-is-better (latency, cost, bloat, rollbacks): fillPct = Math.max(0, (1 - normalizedScore)) * 100
  null score: fillPct = 0

Color:
  displayScore ≥ 0.7 → bg-teal
  displayScore 0.4–0.7 → bg-amber
  displayScore < 0.4  → bg-red
  null → bg-border (full width, muted)

Layout:
  <div className="flex items-center gap-2.5 mb-1.5">
    <span className="font-mono text-[10px] text-subtle w-32 flex-shrink-0">
      {displayName}
    </span>
    <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300 {colorClass}"
        style={{ width: `${fillPct}%` }}
      />
    </div>
    <span className="font-mono text-[10px] text-subtle w-16 text-right flex-shrink-0">
      {formattedValue}
    </span>
    {flagged && (
      <div className="w-3.5 h-3.5 rounded-full bg-red/10 border border-red/30
                      flex items-center justify-center flex-shrink-0"
           title="Flagged">
        <span className="text-red text-[8px] font-mono">!</span>
      </div>
    )}
  </div>
```

---

## Prompt UI-2.3 — EvalReasoningBlock component

```
Create src/components/evals/EvalReasoningBlock.jsx.

A card showing one LLM judge evaluator's score and its reasoning text.
Used inside the accordion detail panel (up to 6 per expanded snapshot row).

Props:
  evaluatorId  string
  score        number | null   (1–5 scale)
  label        string | null   ("poor"|"fair"|"good"|"excellent" | "low"|"medium"|"high")
  reasoning    string | null
  flagged      boolean

Display name map:
  task_adherence          → "Task adherence"
  reasoning_quality       → "Reasoning quality"
  tool_selection_quality  → "Tool selection"
  response_groundedness   → "Response groundedness"
  instruction_following   → "Instruction following"
  hallucination_risk      → "Hallucination risk"

Rendering:
  Base container:
    className="rounded bg-border/40 border border-border p-2.5 mb-1.5"
    If flagged: className="rounded border border-red/25 bg-red/5 p-2.5 mb-1.5"

  Header row (flex, items-center, gap-2, mb-1 if reasoning present):
    <span className="font-mono text-[10px] text-subtle flex-1">{displayName}</span>
    Score badge (reuse EvalScoreBadge):
      - For all evaluators except hallucination_risk: score (1–5) or "no data"
      - For hallucination_risk: use label ("low"|"medium"|"high")
        map label to colors: low → teal, medium → amber, high → red
        render as a badge showing the label text

  Reasoning block (if reasoning is not null):
    <p className="text-xs text-subtle leading-relaxed border-t border-border pt-1.5 mt-1">
      {reasoning}
    </p>
```

---

## Prompt UI-2.4 — FlagsFeed component

```
Create src/components/evals/FlagsFeed.jsx.

A list of flagged evaluations. Reuses the visual style of SignalsPage signal items.

Props:
  sessionId   string | null   ← if provided, scopes to that session

Internal state:
  const [scope, setScope] = useState("session")  // "session" | "all"

Data:
  const { data: flags, isLoading } = useEvalFlags(scope === "session" ? sessionId : null)

Tier badge label map:
  DETERMINISTIC → "deterministic"
  LLM_JUDGE     → "llm judge"
  TRAJECTORY    → "trajectory"

Each flagged eval renders as (copy the DOM structure from SignalsPage.jsx signal items exactly):
  - Icon div with severity color (red for DETERMINISTIC, amber for LLM_JUDGE / TRAJECTORY)
  - Body:
    - Title: evaluator display name + tier badge + EvalScoreBadge if score present
    - Meta: snapshot label · snapshot ID · timeAgo(createdAt)
    - Reasoning text if present (text-xs text-subtle)
    - Formatted meta if present (e.g. "loop detected: read_file ×3")
  - onClick: navigate to /evaluations and scroll to that snapshotId

Scope toggle:
  A button that cycles "This session" ↔ "All sessions"
  className="text-xs font-sans text-subtle hover:text-text cursor-pointer"

Empty state:
  <EmptyState
    title="No flagged evaluations"
    subtitle="All scores within configured thresholds."
  />
  (import EmptyState from "../shared/EmptyState")

Loading state: 3 skeleton rows (h-12 bg-surface rounded animate-pulse mb-2)
```

---

## Prompt UI-2.5 — EvalConfigPanel component

```
Create src/components/evals/EvalConfigPanel.jsx.

A slide-in panel from the right — mirrors RollbackDrawer.jsx exactly for overlay and animation.

Props:
  open     boolean
  onClose  function

Internal state:
  const { data: config } = useEvalConfig()
  const { data: evaluators } = useEvaluators()
  const updateConfig = useUpdateEvalConfig()

Layout (copy RollbackDrawer.jsx structural pattern):
  Fixed overlay (when open): onClick backdrop → onClose
  Panel: fixed right-0 top-0 bottom-0 w-[360px] bg-surface border-l border-border z-50
  Transition: translate-x-full → translate-x-0 (Tailwind transition-transform)

Header:
  <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
    <span className="font-sans font-medium text-base text-text flex-1">Evaluator config</span>
    <button className="text-subtle hover:text-text text-sm" onClick={onClose}>✕ Close</button>
  </div>

Body (scrollable, overflow-y-auto, flex-1):
  Group evaluators by tier: Deterministic | LLM Judge | Trajectory
  (evaluators array from useEvaluators has a tier field)

  For each tier group:
    <div className="px-5 py-3">
      <div className="text-[9px] font-mono uppercase tracking-widest text-subtle/60 mb-3">
        {tierName}
      </div>
      {evaluatorsInTier.map(ev => <EvalConfigRow ... />)}
    </div>
    <div className="border-t border-border" />

EvalConfigRow (inline sub-component):
  <div className="flex items-start gap-3 py-2.5 border-b border-border/50">
    <div className="flex-1">
      <div className="text-sm font-sans text-text mb-0.5">{ev.displayName}</div>
      <div className="text-xs text-subtle leading-snug">{ev.description}</div>
      {ev.tier === "LLM_JUDGE" && (
        <div className="flex items-center gap-2 mt-2">
          <span className="font-mono text-[10px] text-subtle/60">Flag if below</span>
          <input
            type="number" min="1" max="5" step="0.5"
            defaultValue={config?.find(c => c.evaluatorId === ev.id)?.threshold ?? 3}
            className="w-14 bg-border border border-border/50 rounded px-2 py-0.5
                       font-mono text-[10px] text-text focus:outline-none focus:border-teal/40"
            onBlur={e => updateConfig.mutate({ evaluatorId: ev.id, threshold: Number(e.target.value) })}
          />
          <span className="font-mono text-[10px] text-subtle/60">/5</span>
        </div>
      )}
    </div>
    Toggle switch (see below)
  </div>

Toggle switch (no external lib — pure Tailwind):
  const enabled = config?.find(c => c.evaluatorId === ev.id)?.enabled ?? true

  <button
    role="switch"
    aria-checked={enabled}
    onClick={() => updateConfig.mutate({ evaluatorId: ev.id, enabled: !enabled })}
    className={`relative inline-flex h-5 w-8 flex-shrink-0 rounded-full border transition-colors
                ${enabled
                  ? "bg-teal/20 border-teal/30"
                  : "bg-border border-border/50"
                }`}
  >
    <span className={`inline-block h-3.5 w-3.5 rounded-full transition-transform mt-0.5
                      ${enabled
                        ? "translate-x-3.5 bg-teal"
                        : "translate-x-0.5 bg-subtle/60"
                      }`}
    />
  </button>

Optimistic UI: fire mutation immediately on toggle/blur. No save button.
```

---

## Prompt UI-2.6 — EvaluationsPage

```
Create src/pages/EvaluationsPage.jsx.

This is the main evaluations page. It follows the same layout pattern as
src/pages/SignalsPage.jsx and src/pages/UsagePage.jsx.

IMPORTS:
  useNavigate, useSearchParams from "react-router-dom"
  useSessionEvals, useEvalFlags, useEvalConfig, useRunEvals from "../hooks/useEvals"
  useSessions (or equivalent from useTrpc.js) to determine active session
  EvalScoreBadge, EvalHealthBar, EvalBar, EvalReasoningBlock, FlagsFeed, EvalConfigPanel
    from "../components/evals/*"
  EmptyState from "../components/shared/EmptyState"

STATE:
  const [activeTab, setActiveTab] = useState("scores")   // "scores" | "flags" | "trajectory"
  const [trajectoryLoaded, setTrajectoryLoaded] = useState(false)
  const [expandedRow, setExpandedRow] = useState(null)   // snapshotId | null
  const [configOpen, setConfigOpen] = useState(false)

  // Active session: prefer URL param, fall back to Zustand activeSessionId
  const [searchParams] = useSearchParams()
  const { activeSessionId } = useSessionStore()
  const sessionId = searchParams.get("session") ?? activeSessionId

DATA LOADING (parallel):
  const { data: sessionEvals, isLoading: evalsLoading } = useSessionEvals(sessionId)
  const { data: flags } = useEvalFlags(sessionId)
  const { data: evalConfig } = useEvalConfig()
  // Trajectory: lazy — only load when tab is first activated
  const { data: trajectory, refetch: loadTrajectory } = useSessionEvalsTrajectory(sessionId, trajectoryLoaded)

TAB ACTIVATION:
  function activateTab(tab) {
    setActiveTab(tab)
    if (tab === "trajectory" && !trajectoryLoaded) {
      setTrajectoryLoaded(true)
    }
  }

STAT CARDS — derive from sessionEvals:
  Compute these values from sessionEvals (array of { snapshotId, evals: EvalRun[] }):

  const allEvals = sessionEvals?.flatMap(s => s.evals) ?? []
  const toolEvals = allEvals.filter(e => e.evaluatorId === "tool_call_success_rate" && e.score != null)
  const avgToolSuccess = toolEvals.length
    ? Math.round((toolEvals.reduce((s, e) => s + e.score, 0) / toolEvals.length) * 100) + "%"
    : "—"
  const loopDetections = allEvals.filter(e => e.evaluatorId === "loop_detection" && e.label === "loop_detected").length
  const judgeEvals = allEvals.filter(e => e.evaluatorId === "task_adherence" && e.score != null)
  const avgJudge = judgeEvals.length
    ? (judgeEvals.reduce((s, e) => s + e.score, 0) / judgeEvals.length).toFixed(1) + "/5"
    : "—"
  const flaggedCount = allEvals.filter(e => e.flagged).length

  Render 4 stat cards using the same StatCards.jsx visual pattern:
    grid grid-cols-4 gap-3 mb-5
    Each card: bg-surface border border-border rounded-lg p-4
    Accent border-top color: teal / teal / amber / red respectively
    Label: font-mono text-[10px] text-subtle uppercase tracking-wide
    Value: font-mono text-2xl text-text
    Sub:   font-sans text-xs text-subtle

SNAPSHOT SCORE TABLE:

  Header row (bg-surface border-b border-border):
    Snapshot | Tokens | Efficiency | Tools | Loop | Bloat | Cost | LLM Judge | Flags | (expand)
    Use text-xs font-sans text-subtle uppercase tracking-wide for header cells.
    Grid: grid-template-columns: 2fr 80px 70px 70px 70px 70px 70px 90px 60px 40px

  Each row (from sessionEvals, ordered most-recent first):
    <div
      key={entry.snapshotId}
      className="grid border-b border-border hover:bg-surface cursor-pointer px-4 py-3 text-sm"
      style={{ gridTemplateColumns: "..." }}
      onClick={() => setExpandedRow(expandedRow === entry.snapshotId ? null : entry.snapshotId)}
    >
      1. Snapshot: label in text-text font-sans + snapshotId below in font-mono text-[10px] text-subtle
      2. Tokens: tokenTotal formatted e.g. "88.2K" in font-mono text-xs text-subtle
      3–7. EvalScoreBadge for each deterministic evaluator (score or "—")
      8. LLM Judge: EvalScoreBadge for task_adherence
      9. Flags:
           0 → <span className="text-subtle/60">—</span>
           n > 0 → <span className="text-[10px] font-mono bg-red/10 text-red px-1.5 py-0.5 rounded-sm">{n}</span>
      10. Chevron: "↓" (expanded) or "→" (collapsed), text-subtle text-xs

  ACCORDION PANEL (when expandedRow === entry.snapshotId):
    Renders immediately below the row (not a modal):
    <div className="bg-[#0D0D0F] border-b border-border p-4 grid grid-cols-2 gap-5">

      LEFT — Deterministic scores:
        <div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-subtle/60 mb-3">
            Deterministic scores
          </div>
          {8 × EvalBar components}
        </div>

      RIGHT — LLM judge scores:
        <div>
          <div className="font-mono text-[9px] uppercase tracking-widest text-subtle/60 mb-3">
            LLM judge scores
          </div>
          {up to 6 × EvalReasoningBlock components}
        </div>

      FOOTER (grid-column: 1 / -1):
        <div className="flex items-center gap-3 pt-3 border-t border-border">
          <ReRunButton snapshotId={entry.snapshotId} />
          <span className="font-mono text-[10px] text-subtle/60">
            Last evaluated: {new Date(entry.createdAt).toLocaleString()}
          </span>
        </div>
    </div>

ReRunButton (inline sub-component):
  const runEvals = useRunEvals(snapshotId)
  <button
    className="text-xs font-sans bg-surface border border-border rounded px-3 py-1.5
               hover:border-teal/30 hover:text-teal transition-colors"
    disabled={runEvals.isPending}
    onClick={() => runEvals.mutate({ tier: "deterministic" })}
  >
    {runEvals.isPending ? "↺ Running…" : "↺ Re-run evals"}
  </button>

TOPBAR:
  <div className="flex items-center gap-4 px-6 py-4 border-b border-border">
    <h1 className="font-sans font-medium text-base text-text flex-1">
      Evaluations {sessionName ? `— ${sessionName}` : ""}
    </h1>
    <button
      className="text-xs font-sans bg-surface border border-border rounded px-3 py-1.5
                 hover:border-teal/30 hover:text-teal transition-colors"
      onClick={() => setConfigOpen(true)}
    >
      Configure evaluators
    </button>
  </div>

TABS (below topbar):
  <div className="flex gap-0 border-b border-border px-6">
    {["scores", "flags", "trajectory"].map(tab => (
      <button
        key={tab}
        onClick={() => activateTab(tab)}
        className={`px-4 py-3 text-sm font-sans border-b-2 -mb-px transition-colors
                    ${activeTab === tab
                      ? "text-teal border-teal"
                      : "text-subtle border-transparent hover:text-text"
                    }`}
      >
        {tab === "scores" ? "Snapshot scores"
         : tab === "flags" ? `Flags${flags?.length ? ` (${flags.length})` : ""}`
         : "Trajectory"}
      </button>
    ))}
  </div>

TAB CONTENT (px-6 py-5):
  scores tab:    stat cards + snapshot score table (built above)
  flags tab:     <FlagsFeed sessionId={sessionId} />
  trajectory tab: trajectory chart grid (built in Sprint UI-3)

LOADING STATE (evalsLoading):
  Show 3 skeleton rows: <div className="h-12 bg-surface rounded animate-pulse mb-2" />

EMPTY STATE (sessionEvals is empty array):
  <EmptyState
    title="No evaluations yet"
    subtitle="Evaluations run automatically after each snapshot is captured."
  />

SESSION CONTEXT:
  If sessionId is null (user navigates directly without an active session):
    Show a session picker — a <select> populated from useSessions("ACTIVE"),
    onChange → navigate(`/evaluations?session=${id}`)

CONFIG PANEL:
  <EvalConfigPanel open={configOpen} onClose={() => setConfigOpen(false)} />
```

---

---

# Sprint UI-3 — Trajectory Charts

**Goal:** The Trajectory tab on the Evaluations page renders SVG line charts — one per trajectory evaluator. Each chart shows score over snapshots with a trend label and summary. No external chart library.

**Done criteria:**
- [ ] `TrajectoryChart.jsx` renders a responsive SVG line chart
- [ ] Trajectory tab lazy-loads on first activation (single API call)
- [ ] Trend badge (improving / stable / degrading / volatile) color-coded correctly
- [ ] Summary sentence renders below each chart
- [ ] "Insufficient data" empty state when fewer than 3 snapshots
- [ ] Hover tooltip shows snapshot label + score
- [ ] Filter toggle cycles All / Quality only / Cost only (no re-fetch)
- [ ] 2-column grid on wide viewports, 1-column on narrow

---

## Prompt UI-3.1 — TrajectoryChart component

```
Create src/components/evals/TrajectoryChart.jsx.

Props:
  evaluatorId  string
  displayName  string
  trend        "improving" | "degrading" | "stable" | "volatile" | "insufficient_data" | null
  summary      string | null
  points       Array<{ snapshotId: string, score: number, createdAt: string }>

Trend → color map (Tailwind class stems):
  improving:          "teal"
  stable:             "subtle"
  degrading:          "red"
  volatile:           "amber"
  insufficient_data:  "subtle/40"
  null:               "subtle/40"

Trend → badge classes:
  improving:  "bg-teal/10 text-teal border border-teal/20"
  stable:     "bg-border text-subtle border border-border"
  degrading:  "bg-red/10 text-red border border-red/20"
  volatile:   "bg-amber/10 text-amber border border-amber/20"
  insufficient_data / null: "bg-border text-subtle/60 border border-border"

INSUFFICIENT DATA STATE (points.length < 3 or trend === "insufficient_data"):
  <div className="bg-surface border border-border rounded-lg p-6 mb-3 text-center">
    <div className="text-xl text-subtle/40 mb-2">⌁</div>
    <div className="font-mono text-[11px] text-subtle/60">
      Insufficient data — {points.length} snapshot{points.length !== 1 ? "s" : ""} recorded, 3 required
    </div>
  </div>

CHART (points.length ≥ 3):
  Container:
    <div className="bg-surface border border-border rounded-lg p-4 mb-3 relative">

  Header row:
    <div className="flex items-center gap-2 mb-3">
      <span className="font-mono text-[11px] font-medium text-subtle flex-1">{displayName}</span>
      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm uppercase tracking-wide {trendBadgeClasses}">
        {trend ?? "unknown"}
      </span>
    </div>

  SVG chart:
    <div className="relative" style={{ height: "120px" }}>
      <svg
        viewBox="0 0 400 120"
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseLeave={() => setTooltip(null)}
      >
        {SVG content — see below}
      </svg>
      {tooltip && <TooltipDiv ... />}
    </div>

  SVG rendering (JavaScript inside the component):
    PAD = { top: 10, right: 16, bottom: 28, left: 36 }
    chartW = 400 - PAD.left - PAD.right   // 348
    chartH = 120 - PAD.top - PAD.bottom   // 82

    scores = points.map(p => p.score)
    rawMin = Math.min(...scores)
    rawMax = Math.max(...scores)
    pad = (rawMax - rawMin) * 0.1 || 0.1
    yMin = Math.max(0, rawMin - pad)
    yMax = Math.min(5, rawMax + pad)    // cap at 5 for LLM judge

    toX = (i) => PAD.left + (i / (points.length - 1)) * chartW
    toY = (score) => PAD.top + chartH - ((score - yMin) / (yMax - yMin)) * chartH

    GRIDLINES (3, at 25/50/75% of Y range):
      [0.25, 0.5, 0.75].map(pct => {
        const yVal = yMin + (yMax - yMin) * pct
        const yPos = toY(yVal)
        return (
          <>
            <line x1={PAD.left} x2={400-PAD.right} y1={yPos} y2={yPos}
                  stroke="#1E1E22" strokeWidth="0.5" />
            <text x={PAD.left - 4} y={yPos + 3} textAnchor="end"
                  fontSize="8" fill="#6B6B7A" fontFamily="IBM Plex Mono">
              {yVal.toFixed(1)}
            </text>
          </>
        )
      })

    LINE PATH:
      const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i)},${toY(p.score)}`).join(" ")
      // Stroke color: map trendColor → actual hex
      const strokeColor = {
        teal:     "#00E5CC",
        subtle:   "#6B6B7A",
        red:      "#FF4D4D",
        amber:    "#F5A623",
      }[trendColorStem] ?? "#6B6B7A"
      <path d={d} fill="none" stroke={strokeColor} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />

    AREA FILL (subtle gradient — use a unique gradient id):
      const areaD = d + ` L ${toX(points.length-1)},${PAD.top+chartH} L ${toX(0)},${PAD.top+chartH} Z`
      <defs>
        <linearGradient id={`grad-${evaluatorId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#grad-${evaluatorId})`} />

    DATA POINT CIRCLES:
      points.map((p, i) => (
        <circle
          key={p.snapshotId}
          cx={toX(i)} cy={toY(p.score)} r="3"
          fill="#111113" stroke={strokeColor} strokeWidth="1.5"
          style={{ cursor: "pointer" }}
          onMouseEnter={(e) => setTooltip({
            x: toX(i),
            y: toY(p.score),
            label: p.snapshotId.slice(-6),
            score: p.score,
          })}
        />
      ))

    X-AXIS LABELS (max 5, evenly spaced):
      Show up to 5 labels. Pick indices: [0, floor(n/4), floor(n/2), floor(3n/4), n-1]
        (deduplicate if n < 5)
      For each: abbreviated time string
        today → "HH:MM"
        this week → "ddd HH:MM" (Mon, Tue, etc.)
        else → "D MMM"
      <text x={toX(i)} y="116" textAnchor="middle" fontSize="8"
            fill="#6B6B7A" fontFamily="IBM Plex Mono">{timeLabel}</text>

  TOOLTIP (state: { x, y, label, score } | null):
    const TooltipDiv = positioned absolute via percentage-based top/left on the container div:
    <div
      style={{
        position: "absolute",
        left: `${(tooltip.x / 400) * 100}%`,
        top: `${(tooltip.y / 120) * 100}%`,
        transform: "translate(-50%, -110%)",
        pointerEvents: "none",
        zIndex: 10,
      }}
      className="bg-border border border-border/80 rounded px-2 py-1
                 font-mono text-[10px] text-text whitespace-nowrap"
    >
      {tooltip.label} · {tooltip.score.toFixed(2)}
    </div>

  SUMMARY (below SVG, if summary is not null):
    <p className="text-xs text-subtle leading-relaxed border-t border-border pt-2 mt-2">
      {summary}
    </p>
```

---

## Prompt UI-3.2 — Trajectory tab content

```
Add trajectory tab content inside EvaluationsPage.jsx.

This renders inside the "trajectory" tab pane — the existing tab switching
shows/hides tabs by checking activeTab === "trajectory".

DISPLAY ORDER (fixed):
  1. quality_trend
  2. workflow_convergence
  3. rollback_recovery
  4. cost_efficiency_curve
  5. tool_learning

FILTER STATE (add to EvaluationsPage state):
  const [trajFilter, setTrajFilter] = useState("all")  // "all" | "quality" | "cost"

  const QUALITY_IDS = ["quality_trend", "rollback_recovery", "tool_learning"]
  const COST_IDS    = ["cost_efficiency_curve", "workflow_convergence"]

  function cycleTrajFilter() {
    setTrajFilter(f => f === "all" ? "quality" : f === "quality" ? "cost" : "all")
  }

RENDER:
  <div>
    {/* Header */}
    <div className="flex items-center justify-between mb-4">
      <h2 className="font-sans font-medium text-sm text-text">Trajectory — quality over time</h2>
      <button
        className="text-xs font-sans text-subtle hover:text-text transition-colors"
        onClick={cycleTrajFilter}
      >
        {trajFilter === "all" ? "All evaluators" : trajFilter === "quality" ? "Quality only" : "Cost only"} ↕
      </button>
    </div>

    {/* Loading state */}
    {!trajectoryLoaded || !trajectory ? (
      <div className="grid grid-cols-2 gap-3">
        {[1,2,3,4].map(i => (
          <div key={i} className="bg-surface border border-border rounded-lg h-40 animate-pulse" />
        ))}
      </div>
    ) : trajectory.length === 0 ? (
      <EmptyState
        title="No trajectory data yet"
        subtitle="Trajectory evaluators require at least 3 snapshots in this session."
      />
    ) : (
      <div className="grid grid-cols-2 gap-3">
        {DISPLAY_ORDER.map(evalId => {
          const item = trajectory.find(t => t.evaluatorId === evalId)
          if (!item) return null
          const hidden = trajFilter === "quality" && !QUALITY_IDS.includes(evalId)
                      || trajFilter === "cost"    && !COST_IDS.includes(evalId)
          return (
            <div key={evalId} className={hidden ? "hidden" : ""}>
              <TrajectoryChart
                evaluatorId={item.evaluatorId}
                displayName={TRAJ_DISPLAY_NAMES[item.evaluatorId] ?? item.evaluatorId}
                trend={item.trend}
                summary={item.summary}
                points={item.points}
              />
            </div>
          )
        })}
      </div>
    )}
  </div>

TRAJ_DISPLAY_NAMES map:
  quality_trend        → "Overall quality trend"
  workflow_convergence → "Workflow convergence"
  rollback_recovery    → "Rollback recovery"
  cost_efficiency_curve → "Cost efficiency curve"
  tool_learning        → "Tool learning curve"

Responsive: add CSS media query or Tailwind responsive prefix to switch grid to 1-column below 700px:
  className="grid grid-cols-1 md:grid-cols-2 gap-3"
  (where md maps to min-width 768px in Tailwind — close enough to 700px)
```

---

## Prompt UI-3.3 — Final wiring + navigateToSnapshot

```
Complete the evaluation layer by wiring cross-page navigation and verifying all states.

1. navigateToSnapshot(snapshotId) — implement in EvaluationsPage:

   function navigateToSnapshot(snapshotId) {
     setActiveTab("scores")
     setExpandedRow(snapshotId)
     // After state update, scroll to the row
     setTimeout(() => {
       const el = document.getElementById(`eval-row-${snapshotId}`)
       if (el) {
         el.scrollIntoView({ behavior: "smooth", block: "center" })
         // Pulse highlight
         el.classList.add("ring-1", "ring-teal/40")
         setTimeout(() => el.classList.remove("ring-1", "ring-teal/40"), 1000)
       }
     }, 50)
   }

   Add id={`eval-row-${entry.snapshotId}`} to each snapshot score row div.
   Pass navigateToSnapshot to FlagsFeed as the onNavigate prop.

2. From SessionList EvalHealthBar strip click → navigate("/evaluations") and set
   activeSessionId in Zustand sessionStore to that session's id before navigating.

3. From Timeline EvalHealthBar strip click → same navigate("/evaluations").

4. Sidebar flag badge refresh: the useEvalFlags() call in Sidebar has staleTime: 30_000.
   When EvaluationsPage mounts, call queryClient.invalidateQueries({ queryKey: ["eval-flags"] })
   so the sidebar count updates immediately when the page is opened.
   import { useQueryClient } from "@tanstack/react-query"
   const qc = useQueryClient()
   useEffect(() => { qc.invalidateQueries({ queryKey: ["eval-flags"] }) }, [])

5. Verify all loading / error / empty states:
   - Each tab section has its own loading skeleton when data is pending
   - Each tab section has an EmptyState when data exists but is empty
   - Each fetch error shows an inline retry link:
       <span className="text-xs font-sans text-subtle">
         Failed to load.{" "}
         <button className="text-teal underline" onClick={() => refetch()}>Retry</button>
       </span>
   - 503 from /v1/evals/* (eval layer not configured): show info message
       "Evaluation layer not yet active — snapshots are being captured but not evaluated."
```

---

## Final Verification Checklist

```
UI-1 — Inline indicators
  □ Sessions table: Eval health column visible, 8-bar strip renders (or "—" if no data)
  □ Timeline: health bar appears below token/source line on snapshot entries
  □ Signal entries in Timeline have NO eval bar
  □ Clicking health bar navigates to /evaluations
  □ Sessions with no eval data show "—" with no console errors

UI-2 — Evaluations page
  □ Sidebar: Evaluations nav item visible under Diagnostics, badge shows flag count
  □ Route /evaluations renders EvaluationsPage without error
  □ Stat cards compute correctly from sessionEvals
  □ Snapshot score table renders with correct column structure
  □ Clicking a row expands accordion with EvalBar and EvalReasoningBlock
  □ LLM judge reasoning text is readable and not truncated unexpectedly
  □ Flags tab: flagged evals listed, scope toggle refetches, empty state renders
  □ Config panel opens on button click, slide-in animation works
  □ Toggle fires PATCH immediately, optimistic UI updates toggle state
  □ Threshold input fires PATCH on blur
  □ Re-run button shows loading state and refreshes the row on success

UI-3 — Trajectory charts
  □ Trajectory tab triggers data load on first activation (not on page load)
  □ SVG line chart renders for each trajectory evaluator with data
  □ Trend badge color matches trend value
  □ Summary text appears below chart
  □ Hovering a data point shows tooltip with snapshot ID slice + score
  □ Insufficient data state shown when < 3 snapshots
  □ Filter toggle cycles All → Quality → Cost and hides/shows charts correctly
  □ 2-column grid on desktop, 1-column on narrow viewport

Cross-cutting
  □ No layout shifts on Sessions, Signals, Timeline, Diff, Search, or Usage pages
  □ All new text uses font-mono or font-sans (no raw font-family inline styles)
  □ All new colors use Tailwind config values — no hardcoded hex except SVG stroke values
  □ All API calls use apiFetch with Bearer header (no direct fetch in components)
  □ No API key values appear in any console.log
  □ Empty and loading states present in every section
  □ Error states show retry option, do not crash other sections
  □ npm run build (Vite) completes without errors
```

---

*Kontex Eval Layer UI Build Guide · v1.0*
*3 UI sprints · 13 prompts*
*Prerequisite: backend eval layer (Sprints 9–10) complete and serving data*
*Stack: React 19 · Vite · Tailwind CSS · React Query v5 · React Router v7 · Zustand*
*Additive only — no existing pages modified except Session table + Timeline inline additions*
