# CLAUDE.md — Kontex Dashboard UI

Read this file completely before writing any code. This file provides stable context for every sprint.
The full build guide with all sprint prompts is in `../kontex-ui-buildguide.md`.

---

## What This UI Is

Kontex Dashboard is the **visual cockpit** for the Kontex API backend. It is a read + control interface that surfaces what agents did — their captured context, task graphs, snapshot timelines, and token usage. It is never a chat interface.

> **The one rule that must never be violated:**
> There is no chat input box, ever. The only text input in the entire app is the search query field on the Search page. No textarea, no send button, no conversational UI pattern anywhere.

The backend API is the source of truth. This UI consumes it. All data shapes, status values, and endpoint paths in this file match the implemented backend (Sprints 1–8).

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | React (Vite) |
| Routing | react-router-dom v6 |
| State | Zustand |
| Data fetching | @tanstack/react-query |
| Styling | Tailwind CSS |
| Graph | ReactFlow |
| Icons | lucide-react |
| Time formatting | date-fns |
| Fonts | IBM Plex Mono (data) · DM Sans (labels) |

---

## Design Rules

Apply in every component, every sprint.

**Colors — strict usage:**
```
#0A0A0B  bg          Page background
#111113  surface     Panels, sidebars, table rows (hover)
#1E1E22  border      All borders. Use borders, not shadows.
#3A3A42  muted       Muted borders, skeleton loading
#E8E8ED  text        Primary text
#6B6B7A  subtle      Secondary labels, timestamps, IDs
#00E5CC  teal        ACTIVE status · selected states · links · confirm actions
#F5A623  amber       PAUSED status · rollback/destructive · token deltas · warnings
#FF4D4D  red         FAILED status · errors · revoke confirmations
#2ECC71  green       Success indicators
```

**Typography:**
- `font-mono` (IBM Plex Mono): all token counts, timestamps, file paths, tool names, snapshot IDs, API key values, numeric data
- `font-sans` (DM Sans): all labels, headings, nav items, button text, descriptions

**Layout:**
- No shadows (except rollback drawer backdrop)
- No gradients on backgrounds
- No rounded cards with shadows — borders only
- Dense information, generous micro-spacing

**Status values from API are always UPPERCASE strings:**
- Sessions: `ACTIVE` · `PAUSED` · `COMPLETED`
- Tasks: `PENDING` · `ACTIVE` · `COMPLETED` · `FAILED`
- Snapshot source: `proxy` · `log_watcher` · `mcp` (lowercase)

---

## Project Structure

Fixed. Do not create files outside this structure without explicit instruction.

```
kontex-dashboard/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx
│   │   │   └── TopBar.jsx
│   │   ├── sessions/
│   │   │   ├── SessionList.jsx
│   │   │   ├── SessionRow.jsx
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
│   ├── store/
│   │   ├── sessions.js
│   │   └── ui.js
│   ├── data/
│   │   └── mock.js
│   ├── hooks/
│   │   └── useKontexAPI.js
│   ├── pages/
│   │   ├── Home.jsx
│   │   ├── SessionDetailPage.jsx
│   │   ├── TaskGraphPage.jsx
│   │   ├── SearchPage.jsx
│   │   └── SettingsPage.jsx
│   ├── App.jsx
│   └── main.jsx
├── Dockerfile
├── nginx.conf
├── docker-compose.yml
├── .env
├── .env.example
├── tailwind.config.js
├── vite.config.js
└── package.json
```

---

## Environment Variables

```bash
VITE_KONTEX_API_URL=http://localhost:3000   # local dev
```

> `VITE_*` variables are baked in at Vite build time. They must be passed as Docker build
> args — runtime environment variables have no effect on the built static files.

**Deployment is via Docker.** The project root must contain:
- `Dockerfile` — multi-stage: `node:20-alpine` build → `nginx:alpine` serve
- `nginx.conf` — SPA fallback (`try_files $uri $uri/ /index.html`) + asset caching
- `docker-compose.yml` — builds with `VITE_KONTEX_API_URL` as a build arg, exposes port 8080

```bash
# Local run
docker compose up --build

# Production
VITE_KONTEX_API_URL=https://your-kontex-api.example.com docker compose up --build -d
```

Full Dockerfile, nginx.conf, and docker-compose.yml are in `../kontex-ui-buildguide.md` Section 9.

---

## API Contract

The backend base URL is `VITE_KONTEX_API_URL`. All routes are under `/v1/`.

**Authentication:** `Authorization: Bearer {apiKey}` header on every request.
The key is stored in `localStorage` as `kontex_api_key` (format: `kontex_xxxx...`).

**All errors follow this shape:**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

**Endpoint → response shape quick reference:**

| Endpoint | Response shape |
|---|---|
| `GET /v1/sessions` | `{ data: Session[], nextCursor }` |
| `GET /v1/sessions/:id` | `Session + taskCount` |
| `GET /v1/sessions/:id/snapshots/timeline` | `TimelineEntry[]` |
| `GET /v1/sessions/:id/graph` | `{ nodes, edges }` (ReactFlow-ready) |
| `GET /v1/sessions/:id/diff?from=&to=` | `{ added, removed, token_delta }` |
| `GET /v1/snapshots/:id` | `Snapshot + bundle (ContextBundle)` |
| `POST /v1/snapshots/:id/rollback` | `{ rollback_snapshot_id, source_snapshot_id, label, captured_at, token_total, bundle }` |
| `GET /v1/usage` | `{ total_sessions, active_sessions, total_snapshots, total_tokens_stored, snapshots_this_month, tokens_this_month }` |
| `GET /v1/search?q=` | `SearchResult[]` or `503 { error: "search_unavailable" }` |
| `GET /v1/keys` | `ApiKey[]` — key value NEVER in list |
| `POST /v1/keys` | `{ id, key, label, createdAt }` — key shown here only |
| `DELETE /v1/keys/:id` | `204` |

**ContextBundle shape** (returned inside snapshot responses):
```js
{
  snapshotId, taskId, sessionId, capturedAt, model, tokenTotal,
  source,      // "proxy" | "log_watcher" | "mcp"
  enriched,    // true after log watcher enrichment
  files: [{ path, content?, contentHash, tokenCount }],
  toolCalls: [{ tool, input, output, status, timestamp }],
  messages: [{ role, content, timestamp? }],
  reasoning?,  // string — agent's internal reasoning
  logEvents: [{ type, timestamp, data }]
}
```

**Rollback is append-only.** `POST /v1/snapshots/:id/rollback` creates a new snapshot — it never deletes existing ones. After a successful rollback, append the new snapshot to the timeline; do not remove any existing entries.

---

## Coding Standards

Apply in every file, every sprint.

**Mock data:** All mock data in `src/data/mock.js` must match real API shapes exactly — status values uppercase, field names matching the API (e.g. `tokenTotal` not `tokenCost`, `updatedAt` not `lastActive`). This ensures swapping mocks for real hooks requires no component changes.

**React Query:** All API calls go through hooks in `useKontexAPI.js`. Components never call `fetch` directly.

**Zustand:** UI state (drawer open/closed, active snapshot, sidebar expanded) lives in Zustand stores. Server state (sessions, snapshots) lives in React Query cache.

**No prop drilling:** Use Zustand for shared UI state. Pass only what a component directly renders.

**Error states:** Every data-fetching component handles loading, error, and empty states. Use `EmptyState` for empty. Show a subtle inline error message for fetch failures — no crash screens.

**No inline styles.** Tailwind utility classes only. Custom values only when Tailwind cannot express them.

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 1 | Shell + Session List | Layout, routing, session table with filters |
| 2 | Timeline + Inspector | Snapshot timeline, context bundle viewer |
| 3 | Rollback | Diff display, rollback confirmation, append-only update |
| 4 | Task Graph | ReactFlow graph from `/graph` endpoint |
| 5 | Search + Keys + Usage | Search page, API key management, usage stats |
| 6 | Wiring + Polish | Zustand stores, empty states, final polish |

Complete all done criteria for a sprint before starting the next.
Update the **Current Sprint** section below at the start of each new sprint.

---

## How to Use This File

```bash
cd kontex-dashboard
# CLAUDE.md is here — Claude Code reads it automatically

# Open ../kontex-ui-buildguide.md for the full prompt list
# Navigate to the current sprint section
# Execute prompts in Claude Code in order

# Before starting a new sprint:
# 1. Update the "Current Sprint" section below
# 2. Paste in the sprint goal and prompts from the build guide
# 3. Check off done criteria as you go
```

---

## Integration Phase

This section governs API wiring. Read it alongside `../kontex-wiring-buildguide.md`, which contains the sprint-by-sprint prompts for connecting every component to the real backend.

**Hook conventions:**
- All data-fetching hooks live in `src/hooks/useKontexAPI.js`
- Every hook uses `@tanstack/react-query` (`useQuery` or `useMutation`)
- No component calls `fetch` or `axios` directly — hooks only

**API client:**
- Base fetcher is in `src/api/client.js`
- Reads `VITE_KONTEX_API_URL` from `import.meta.env`
- Reads API key from `localStorage.getItem("kontex_api_key")`
- Sends `Authorization: Bearer {key}` on every request
- Throws `ApiError` (with `.status` and `.code`) on non-2xx responses

**Auth gate:**
- `src/components/auth/ApiKeyGate.jsx` wraps the entire app in `main.jsx`
- If `localStorage.getItem("kontex_api_key")` is falsy → renders a full-screen key entry form
- On submit → stores key, dismisses gate; no page reload needed
- 401 from any API call → clears key, gate reappears (handled in `apiFetch`)

**Mock data:**
- Mock imports are allowed **only** inside `src/data/mock.js`
- Hook files in `src/hooks/` must never import from `src/data/mock.js`
- Once a hook is wired, its corresponding component must not fall back to mock data

**Signals:**
- There is no `/v1/signals` backend endpoint
- Signals are computed **client-side** in `src/utils/signals.js` from timeline data
- Logic: `tokenDelta > 5000` relative to window → `context_bloat`; same tool called 3+ times → `retry_storm`; `tokenTotal > 80000` → `context_limit_proximity`
- `SignalsPage` and `TimelinePage` both derive signal entries using this utility

**Docker / environment:**
- `VITE_*` vars are baked in at Vite build time — **not** available at runtime
- Must be passed as Docker build args: `--build-arg VITE_KONTEX_API_URL=https://...`
- Runtime env vars in `docker-compose.yml` have no effect on the built static bundle

**Integration sprint map:**

| Sprint | Focus | Key deliverables |
|---|---|---|
| W1 | Foundation | `.env.example`, QueryClientProvider, `src/api/client.js`, `ApiKeyGate` |
| W2 | Sessions + Home | `useSessions`, `useSession`, `useUsage`; wire `SessionList`, `StatCards`, Sidebar |
| W3 | Session Detail | `useTimeline`, `useSnapshot`; wire `SnapshotTimeline`, `ContextInspector` |
| W4 | Rollback + Diff | `useRollback`, `useDiff`; wire `RollbackDrawer`, `DiffPage` |
| W5 | Task Graph | `useGraph`; wire `TaskGraph`, `TaskGraphPage` |
| W6 | Search + Keys | `useSearch`, `useKeys`, `useCreateKey`, `useDeleteKey`; wire `SearchPage`, `KeysManager` |
| W7 | Signals + Timeline + Usage | `src/utils/signals.js`; wire `TimelinePage`, `SignalsPage`, `UsagePage` |
| W8 | Error handling + Deploy | `InlineError`, `Dockerfile`, `nginx.conf`, `docker-compose.yml`, final verification |

---

### Sprint 6 — Wiring + Polish

**Prompt 6.1 — Zustand store**
```
Set up Zustand stores:

src/store/sessions.js:
  - State: sessions (from mockSessionsResponse.data), activeSessionId, activeSnapshotId
  - Actions: 
    setSessions(sessions)
    setActiveSession(id)
    setActiveSnapshot(id)
    addSnapshot(snapshot) — appends to session snapshot list (for post-rollback)
    NOTE: rollback NEVER removes existing snapshots — it only adds

src/store/ui.js:
  - State: rollbackDrawerOpen, sidebarExpanded, searchQuery
  - Actions: openRollback, closeRollback, toggleSidebar, setSearchQuery

Wire the RollbackDrawer open/close to the ui store.
Wire SnapshotTimeline selection to sessions store activeSnapshotId.
Wire ContextInspector to read from sessions store based on activeSnapshotId.
```

**Prompt 6.2 — Empty states + loading**
```
Build src/components/shared/EmptyState.jsx:
  Props: icon (lucide component), title, subtitle
  Style: centered, icon in muted color at 32px, title DM Sans medium, subtitle subtle small
  Use it in:
  - SessionList when no sessions match the active filter
  - ContextInspector when no snapshot is selected
    (title: "Select a checkpoint", subtitle: "Choose a snapshot from the timeline to inspect its context state")
  - TaskGraph if nodes is empty
  - SearchResults when no results returned
  - KeysManager when no keys exist

Add skeleton loading rows to SessionList:
  - 3 rows, animated pulse (Tailwind animate-pulse)
  - Show for 1.2 seconds on mount, then replace with real data
  - Skeleton color: #1E1E22
```

**Prompt 6.3 — Final polish pass**
```
Final polish pass across all components:

1. Ensure IBM Plex Mono is applied to: all token counts, timestamps, file paths, tool names,
   status codes, snapshot IDs, API key values
2. Ensure DM Sans is applied to: all labels, headings, nav items, button text
3. Check all borders are using #1E1E22 — no box-shadows except the rollback drawer backdrop
4. Status values are UPPERCASE strings from the API — ensure StatusBadge handles
   "ACTIVE", "PAUSED", "COMPLETED", "PENDING", "FAILED"
5. Ensure teal (#00E5CC) is used only for: ACTIVE status, selected states, links, confirm actions
6. Ensure amber (#F5A623) is used only for: PAUSED status, rollback/destructive actions, token deltas
7. Ensure red (#FF4D4D) is used only for: FAILED status, error states, revoke confirmations
8. Verify no component contains: textarea for chat, send button, or any conversational UI pattern
   (the search input on SearchPage is the only text input in the app)
9. Add a subtle page transition on route change: opacity 0→1 over 150ms using CSS transition
10. Verify the sidebar collapses/expands smoothly on hover with CSS transition on width
```

---
