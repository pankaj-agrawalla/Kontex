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

# Current Sprint — Sprint 1: Shell, Layout, Session List

**Goal:** Scaffolded React project, dark layout shell with sidebar and top bar, session list table rendering from mock data with status filters.

**Done criteria:**
- [ ] `npm run dev` starts without errors at `http://localhost:5173`
- [ ] Sidebar renders: collapsed 56px, expands to 200px on hover, three nav items
- [ ] Top bar renders: breadcrumb left, token counter right
- [ ] Home route renders session list from `mockSessionsResponse.data`
- [ ] Status filter tabs work: All · Active · Paused · Completed
- [ ] StatusBadge uses correct colors: teal (ACTIVE), amber (PAUSED), muted (COMPLETED)
- [ ] Token counts and timestamps in IBM Plex Mono
- [ ] Labels and nav in DM Sans
- [ ] No shadows — borders only (`#1E1E22`)
- [ ] No chat input, no textarea, no send button anywhere in the codebase
- [ ] Routes exist for `/`, `/session/:id`, `/graph`, `/search`, `/settings`

---

## Prompt 1.1 — App shell + routing

```
Set up react-router-dom v6 in src/App.jsx with five routes:
  /               → pages/Home.jsx
  /session/:id    → pages/SessionDetailPage.jsx
  /graph          → pages/TaskGraphPage.jsx
  /search         → pages/SearchPage.jsx
  /settings       → pages/SettingsPage.jsx

Create a persistent layout wrapper with:
- A left sidebar (src/components/layout/Sidebar.jsx) 
  - 56px wide collapsed, 200px expanded on hover
  - Nav items: Sessions (home icon), Search (search icon), Settings (settings icon)
  - Bottom: a small Kontex wordmark
  - Use lucide-react for icons
  - Dark bg #111113, border-right 1px solid #1E1E22
  - CSS transition on width for smooth hover expand
- A top bar (src/components/layout/TopBar.jsx)
  - Shows current page breadcrumb on left
  - Shows a live token counter (mock: "1,240,800 tokens" in IBM Plex Mono) on right
  - Height 40px, border-bottom 1px solid #1E1E22

No chat input. No message box. No textarea. This is a control panel, not a chat UI.
```

---

## Prompt 1.2 — Session List

```
Build src/components/sessions/SessionList.jsx that:
- Renders a full-width table (no card grid) of sessions from src/data/mock.js
  (use mockSessionsResponse.data — the real API wraps the array in { data, nextCursor })
- Columns: Status · Name · Description · Last Updated · Actions
- StatusBadge component: dot + label, status values are UPPERCASE strings:
    ACTIVE    → teal (#00E5CC)
    PAUSED    → amber (#F5A623)
    COMPLETED → muted (#6B6B7A)
- Last Updated: relative time using date-fns (e.g. "8 min ago") from updatedAt field
- Actions column: "Open →" link in teal for ACTIVE/PAUSED, "View" for COMPLETED
- Row hover: background #111113, border-left 2px solid #00E5CC
- Table header: uppercase, letter-spacing, text-subtle (#6B6B7A), font-size 0.65rem
- No shadows. No rounded cards. Borders only.
- Filter bar above: All · Active · Paused · Completed tabs
  (filter compares status === "ACTIVE" / "PAUSED" / "COMPLETED" — uppercase)

Mock data to use is mockSessionsResponse from src/data/mock.js.
The mock data must be created first — it must match the real API shape:
  { data: [{ id, name, description, status, createdAt, updatedAt }], nextCursor }
Status values in mock must be uppercase: "ACTIVE", "PAUSED", "COMPLETED".
Token field is tokenTotal — there is no tokenCost field.
```
