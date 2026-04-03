# CLAUDE.md — Kontex Dashboard 2.0

Read this file completely before writing any code. Sprint prompts are in `../kontex-dashboard-2.0-buildguide.md` — execute them from there.

---

## What This UI Is

Kontex Dashboard is the **visual cockpit** for the Kontex API backend. It is a read + control interface that surfaces what agents did — session timelines, snapshot bundles, task graphs, diffs, and usage. It is never a chat interface.

> **The one rule that must never be violated:**
> There is no chat input box, ever. The only text input is the search query on the Search page. No textarea, no send button, no conversational UI pattern anywhere.

---

## What Is Already Built

The full UI shell exists in React + Tailwind. All 9 pages render with hardcoded mock data from `src/data/mock.js`. Components are complete — do not redesign them.

**Goal of the integration sprints:** Replace every mock import with real tRPC hooks, REST hooks, or an SSE listener. Component markup does not change.

Pages built:
- `/` — Home (SessionList, StatCards)
- `/session/:id` — SessionDetail (SnapshotTimeline, ContextInspector)
- `/graph` — TaskGraph (ReactFlow)
- `/search` — SearchPage
- `/settings` — SettingsPage (KeysManager)
- `/signals` — SignalsPage
- `/timeline` — TimelinePage
- `/diff` — DiffPage
- `/usage` — UsagePage

---

## Backend 2.0 API Surface

Backend runs at `VITE_KONTEX_API_URL` (default `http://localhost:3000`).

### tRPC — all dashboard reads (primary)

All tRPC calls POST to `/trpc/{procedure}` with `Authorization: Bearer {key}`.

```
trpc/sessions.list           → list sessions (replaces GET /v1/sessions)
trpc/sessions.byId           → single session (replaces GET /v1/sessions/:id)
trpc/sessions.create         → create session (replaces POST /v1/sessions)
trpc/sessions.update         → update session (replaces PATCH /v1/sessions/:id)
trpc/sessions.tasks          → session task tree (replaces GET /v1/sessions/:id/tasks)
trpc/snapshots.listBySession → session snapshots (replaces GET /v1/sessions/:id/snapshots)
trpc/snapshots.byId          → single snapshot (replaces GET /v1/snapshots/:id)
trpc/snapshots.bundle        → ContextBundle (replaces GET /v1/snapshots/:id/bundle)
trpc/snapshots.rollback      → trigger rollback (replaces POST /v1/snapshots/:id/rollback)
trpc/dashboard.graph         → ReactFlow graph (replaces GET /v1/sessions/:id/graph)
trpc/dashboard.diff          → snapshot diff (replaces GET /v1/sessions/:id/diff?from=&to=)
trpc/dashboard.timeline      → timeline entries (replaces GET /v1/sessions/:id/snapshots/timeline)
trpc/dashboard.usage         → usage stats (replaces GET /v1/usage)
```

### REST — keys + search only (not in tRPC)

```
POST   /v1/keys              → create API key (key returned once only)
GET    /v1/keys              → list keys (key value never included)
DELETE /v1/keys/:id          → revoke key (soft delete, returns 204)
GET    /v1/search?q=         → semantic search (may return 503 if Qdrant not configured)
GET    /health               → health check (no auth required)
```

### SSE — real-time session feed

```
GET /sse/session/:id/feed    → text/event-stream
                               Authorization: Bearer {key}
```

Event payload: `data: {JSON}\n\n`

Event types:
- `snapshot_created` — new snapshot captured in session
- `snapshot_enriched` — log-watcher enrichment applied
- `snapshot_embedded` — Qdrant indexing complete

Open on session detail mount, close on unmount. Each session page gets its own connection.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React 19 + Vite |
| Routing | React Router v7 |
| Data fetching | @tanstack/react-query v5 |
| RPC client | @trpc/client + @trpc/react-query |
| State | Zustand |
| Styling | Tailwind CSS |
| Visualization | ReactFlow |
| Icons | lucide-react |
| Time | date-fns |
| Language | JavaScript (JSX) — no TypeScript |

Install tRPC client packages:
```bash
npm install @trpc/client @trpc/react-query @trpc/server
```

---

## Project Structure

Fixed. Do not add files outside this structure without explicit instruction.

```
kontex-dashboard/
├── src/
│   ├── api/
│   │   ├── client.js          ← apiFetch — REST base fetcher with auth
│   │   └── trpc.js            ← tRPC client + React Query integration
│   ├── components/
│   │   ├── auth/
│   │   │   └── ApiKeyGate.jsx ← blocks app until key is stored
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   └── TopBar.jsx
│   │   ├── sessions/
│   │   │   ├── SessionList.jsx
│   │   │   ├── SessionRow.jsx
│   │   │   ├── StatCards.jsx
│   │   │   └── StatusBadge.jsx
│   │   ├── detail/
│   │   │   ├── SessionDetail.jsx
│   │   │   ├── SnapshotTimeline.jsx
│   │   │   └── ContextInspector.jsx
│   │   ├── rollback/
│   │   │   └── RollbackDrawer.jsx
│   │   ├── graph/
│   │   │   └── TaskGraph.jsx
│   │   ├── search/
│   │   │   └── SearchResults.jsx
│   │   ├── keys/
│   │   │   └── KeysManager.jsx
│   │   ├── usage/
│   │   │   └── UsageStats.jsx
│   │   └── shared/
│   │       ├── TokenPill.jsx
│   │       └── EmptyState.jsx
│   ├── hooks/
│   │   ├── useTrpc.js         ← tRPC React Query hooks (all dashboard reads)
│   │   └── useKontexAPI.js    ← REST hooks (keys + search only)
│   ├── sse/
│   │   └── useSessionFeed.js  ← SSE hook for /sse/session/:id/feed
│   ├── utils/
│   │   └── signals.js         ← client-side signal detection from timeline data
│   ├── store/
│   │   ├── sessions.js
│   │   └── ui.js
│   ├── data/
│   │   └── mock.js            ← keep as reference, never import in hooks
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── SessionDetailPage.jsx
│   │   ├── TaskGraphPage.jsx
│   │   ├── SearchPage.jsx
│   │   ├── SettingsPage.jsx
│   │   ├── SignalsPage.jsx
│   │   ├── TimelinePage.jsx
│   │   ├── DiffPage.jsx
│   │   └── UsagePage.jsx
│   ├── App.jsx
│   └── main.jsx
├── Dockerfile
├── nginx.conf
├── .env
├── .env.example
├── package.json
├── tailwind.config.js
└── vite.config.js
```

---

## Design Rules

Apply in every component, every sprint.

**Colors — strict usage:**
```
#0A0A0B  bg          Page background
#111113  surface     Panels, sidebars, table row hover
#1E1E22  border      All borders — use borders, not shadows
#3A3A42  muted       Muted borders, skeleton loading
#E8E8ED  text        Primary text
#6B6B7A  subtle      Secondary labels, timestamps, IDs
#00E5CC  teal        ACTIVE status · selected states · confirm actions
#F5A623  amber       PAUSED status · rollback/destructive · warnings
#FF4D4D  red         FAILED status · errors · revoke confirmations
#2ECC71  green       Success indicators
```

**Typography:**
- `font-mono` (IBM Plex Mono): token counts, timestamps, file paths, tool names, snapshot IDs, API key values, all numeric data
- `font-sans` (DM Sans): labels, headings, nav items, button text, descriptions

**Layout:** No shadows (except rollback drawer backdrop). No gradients on backgrounds. Borders over shadows. Dense information, generous micro-spacing.

**Status values from API are always UPPERCASE:**
- Sessions: `ACTIVE` · `PAUSED` · `COMPLETED`
- Tasks: `PENDING` · `ACTIVE` · `COMPLETED` · `FAILED`
- Snapshot source: `proxy` · `mcp` · `openllmetry` (lowercase)

---

## Coding Standards

**No TypeScript.** Plain JSX throughout. Do not add `.ts` or `.tsx` files.

**No direct fetch in components.** All data goes through `useTrpc.js` (tRPC reads), `useKontexAPI.js` (REST keys + search), or `useSessionFeed.js` (SSE). Components only call hooks.

**No mock imports in wired components.** Once a component is wired, its mock import is removed. `mock.js` itself stays as a reference — never import it from hook files.

**tRPC for all reads.** Use `useTrpc.js` for every procedure listed in the tRPC surface above. Use `apiFetch` REST only for `/v1/keys/*` and `/v1/search`.

**SSE lifecycle.** One connection per session page, managed entirely by `useSessionFeed.js`. Open on mount, close on unmount. Never share a connection across components.

**Auth.** API key stored in `localStorage` as `kontex_api_key`. Injected as `Authorization: Bearer {key}` on every request — REST, tRPC, and SSE. Never log the key value.

**401 handling.** Clear `kontex_api_key` from localStorage and reload — `ApiKeyGate` reappears.

**Loading states.** Use React Query's `isLoading` / `isPending`. Skeleton rows or `—` placeholder. Never a blank flash.

**Error states.** Inline `text-red text-sm font-sans` messages. No crash screens except 401.

**Signals are client-side.** There is no `/v1/signals` endpoint. Signals are computed from timeline data in `src/utils/signals.js`. Logic:
- `tokenDelta > 5000` relative to rolling window → `context_bloat`
- Same tool called 3+ times in window → `retry_storm`
- `tokenTotal > 80,000` → `context_limit_proximity`

**Rollback is append-only.** After `snapshots.rollback` succeeds, append the new snapshot to the timeline — never remove existing entries. The timeline always grows forward.

**React Query key conventions:**
```js
["sessions", status]              // list (status may be null)
["session", sessionId]            // single
["timeline", sessionId]           // timeline
["graph", sessionId]              // graph
["diff", sessionId, from, to]     // diff
["snapshots", sessionId]          // snapshots list
["snapshot", snapshotId]          // single snapshot
["bundle", snapshotId]            // ContextBundle
["usage"]                         // usage stats
["search", q, sessionId]          // search
["keys"]                          // API keys list
```

---

## Environment Variables

```bash
VITE_KONTEX_API_URL=http://localhost:3000
```

Only one env var. API keys are never in `.env` — stored in localStorage at runtime.

`VITE_*` vars are baked at Vite build time. Pass as Docker build args for production:
```bash
docker build --build-arg VITE_KONTEX_API_URL=https://your-api.railway.app .
```

---

## Auth Flow

1. App loads → `ApiKeyGate` checks `localStorage.getItem("kontex_api_key")`
2. Missing → full-screen gate, user enters `kontex_xxxxx` key
3. Gate hits `GET /health` to verify backend reachable
4. Success → key saved, gate dismisses
5. Every subsequent request injects `Authorization: Bearer {key}`
6. 401 received → clear key, reload → gate reappears

---

## ContextBundle Shape

```js
{
  snapshotId, taskId, sessionId, capturedAt, model, tokenTotal,
  source,      // "proxy" | "mcp" | "openllmetry"
  enriched,    // bool
  files: [{ path, content?, contentHash, tokenCount }],
  toolCalls: [{ tool, input, output, status, timestamp }],
  messages: [{ role, content, timestamp? }],
  reasoning?,  // string
  logEvents: [{ type, timestamp, data }]
}
```

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 1 | Foundation | tRPC client, SSE manager, ApiKeyGate, env, QueryClient |
| 2 | Sessions + Home | tRPC sessions + usage hooks, wire Home, StatCards, Sidebar |
| 3 | Session Detail + SSE | tRPC snapshots hooks, SSE feed, wire SessionDetail |
| 4 | Rollback + Diff | tRPC rollback + diff, wire RollbackDrawer + DiffPage |
| 5 | Task Graph | tRPC dashboard.graph, wire TaskGraph |
| 6 | Search + Keys | REST search + keys hooks, wire SearchPage + KeysManager |
| 7 | Timeline + Signals + Usage | tRPC timeline + usage, client-side signals, wire remaining pages |
| 8 | Error handling + Deploy | Error boundaries, Docker, nginx, final verification |

Complete all done criteria before moving to the next sprint.

---

## How to Use

```bash
cd kontex-dashboard
# CLAUDE.md is here — Claude Code reads it automatically

# Open ../kontex-dashboard-2.0-buildguide.md
# Navigate to the current sprint and execute prompts in order

# When resuming: "Read CLAUDE.md. We are on Sprint 3, Prompt 3.2. Continue."
```
