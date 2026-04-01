# Kontex MVP — UI Build Guide
### VSCode + Claude Code CLI · React + Tailwind · Dark Cockpit UI

> **v2.0** — Updated to match implemented backend (Sprints 1–8). All API shapes, endpoints, and data models reflect the actual Hono API.

---

## 0. Design Manifesto (Read First)

Kontex is an **agent cockpit**, not a chat interface.

> **The golden rule: There is no chat input box. Ever.**
>
> The dashboard surfaces what agents did. Human interaction happens inside Claude Code or Cursor — not here. Every screen is read + control, never converse. If you find yourself reaching for a `<textarea>` or a send button, stop and reconsider the interaction model.

**Aesthetic Direction: Industrial Precision**
- Dark background (`#0A0A0B`) — near-black, not pure black
- Monospace accents for data, sans-serif for labels
- Accent: electric teal (`#00E5CC`) — single dominant accent, used sparingly
- Secondary accent: amber (`#F5A623`) for warnings / rollback states
- Motion: subtle, purposeful — state transitions only, no decorative animation
- Layout: dense information, generous micro-spacing, no fluff
- Typography: `IBM Plex Mono` for data/code, `DM Sans` for UI labels
- No gradients on backgrounds. No purple. No cards with shadows everywhere.
- Borders over shadows. Lines over blobs.

---

## 1. Prerequisites

```bash
# Node + npm
node -v   # >= 18.x
npm -v    # >= 9.x

# Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude --version

# Verify VSCode
code --version
```

Install VSCode extensions:
- **ESLint** (`dbaeumer.vscode-eslint`)
- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`)
- **Prettier** (`esbenp.prettier-vscode`)

---

## 2. Project Scaffold

```bash
# Create project
npm create vite@latest kontex-dashboard -- --template react
cd kontex-dashboard

# Core dependencies
npm install react-router-dom zustand @tanstack/react-query
npm install reactflow          # Task graph
npm install date-fns           # Timestamp formatting
npm install lucide-react       # Icons

# Dev dependencies
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Fonts (via fontsource for offline/bundle)
npm install @fontsource/ibm-plex-mono @fontsource/dm-sans
```

Open in VSCode:
```bash
code .
```

---

## 3. Tailwind Config

Replace `tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#0A0A0B",
        surface:  "#111113",
        border:   "#1E1E22",
        muted:    "#3A3A42",
        text:     "#E8E8ED",
        subtle:   "#6B6B7A",
        teal:     "#00E5CC",
        amber:    "#F5A623",
        red:      "#FF4D4D",
        green:    "#2ECC71",
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "monospace"],
        sans: ["DM Sans", "sans-serif"],
      },
      fontSize: {
        "2xs": "0.65rem",
      },
    },
  },
  plugins: [],
};
```

Update `src/index.css`:

```css
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "@fontsource/dm-sans/400.css";
@import "@fontsource/dm-sans/500.css";
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0A0A0B;
  color: #E8E8ED;
  font-family: "DM Sans", sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* Scrollbar styling */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: #111113; }
::-webkit-scrollbar-thumb { background: #3A3A42; border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: #00E5CC; }
```

---

## 4. Project Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx           # Left nav
│   │   └── TopBar.jsx            # Status bar / breadcrumb
│   ├── sessions/
│   │   ├── SessionList.jsx       # Home screen table
│   │   ├── SessionRow.jsx        # Single session row
│   │   └── StatusBadge.jsx       # ACTIVE / PAUSED / COMPLETED
│   ├── detail/
│   │   ├── SessionDetail.jsx     # Split-pane wrapper
│   │   ├── SnapshotTimeline.jsx  # Left: checkpoint list (from /timeline)
│   │   └── ContextInspector.jsx  # Right: snapshot bundle contents
│   ├── rollback/
│   │   └── RollbackDrawer.jsx    # Slide-in confirm panel (uses /diff)
│   ├── graph/
│   │   └── TaskGraph.jsx         # ReactFlow — data from /graph endpoint
│   ├── search/
│   │   └── SearchResults.jsx     # Semantic search results
│   ├── keys/
│   │   └── KeysManager.jsx       # API key CRUD
│   ├── usage/
│   │   └── UsageStats.jsx        # Token + session stats from /usage
│   └── shared/
│       ├── TokenPill.jsx         # Token cost badge
│       └── EmptyState.jsx        # Consistent empty views
├── store/
│   ├── sessions.js               # Zustand sessions store
│   └── ui.js                     # Zustand UI state (active panel etc.)
├── data/
│   └── mock.js                   # Mock data matching real API shapes
├── hooks/
│   └── useKontexAPI.js           # React Query wrappers (see Section 8)
├── pages/
│   ├── Home.jsx
│   ├── SessionDetailPage.jsx
│   ├── TaskGraphPage.jsx
│   ├── SearchPage.jsx            # GET /v1/search
│   └── SettingsPage.jsx          # API key management
├── App.jsx
└── main.jsx
```

---

## 5. Mock Data

> **Important:** Mock data must match the real API shapes exactly so swapping to real API calls in Section 8 requires no component changes. All status values are **UPPERCASE** (`ACTIVE`, `PAUSED`, `COMPLETED`, `PENDING`, `FAILED`). The field for token count is `tokenTotal`, not `tokenCost`.

Create `src/data/mock.js`:

```js
// Sessions — matches GET /v1/sessions response shape ({ data, nextCursor })
export const mockSessionsResponse = {
  data: [
    {
      id: "sess_01",
      name: "Refactor auth module",
      description: null,
      status: "ACTIVE",            // uppercase always
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "sess_02",
      name: "API schema migration",
      description: "Migrate v1 to v2 schema",
      status: "PAUSED",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
    {
      id: "sess_03",
      name: "Write onboarding docs",
      description: null,
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
  ],
  nextCursor: null,
}

// Single session — matches GET /v1/sessions/:id (includes taskCount)
export const mockSession = {
  id: "sess_01",
  name: "Refactor auth module",
  description: null,
  status: "ACTIVE",
  taskCount: 4,
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
}

// Timeline — matches GET /v1/sessions/:id/snapshots/timeline
export const mockTimeline = [
  {
    id: "snap_001",
    label: "Initial context loaded",
    taskId: "task_01",
    taskName: "Parse codebase",
    source: "proxy",
    enriched: false,
    tokenTotal: 4200,
    tokenDelta: 4200,
    createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
  },
  {
    id: "snap_002",
    label: "Auth.js read + analyzed",
    taskId: "task_01",
    taskName: "Parse codebase",
    source: "log_watcher",
    enriched: true,
    tokenTotal: 7800,
    tokenDelta: 3600,
    createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
  },
  {
    id: "snap_003",
    label: "Refactor plan generated",
    taskId: "task_02",
    taskName: "Identify refactor targets",
    source: "proxy",
    enriched: true,
    tokenTotal: 12300,
    tokenDelta: 4500,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: "snap_004",
    label: "Tests scaffolded",
    taskId: "task_03",
    taskName: "Generate refactor plan",
    source: "mcp",
    enriched: false,
    tokenTotal: 18420,
    tokenDelta: 6120,
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
]

// Snapshot bundle — matches GET /v1/snapshots/:id response
// (snapshot metadata + full ContextBundle)
export const mockSnapshot = {
  id: "snap_003",
  taskId: "task_02",
  label: "Refactor plan generated",
  tokenTotal: 12300,
  model: "claude-opus-4-6",
  source: "proxy",
  enriched: true,
  enrichedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  embedded: true,
  r2Key: "bundles/snap_003.json",
  createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  bundle: {
    snapshotId: "snap_003",
    taskId: "task_02",
    sessionId: "sess_01",
    capturedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    model: "claude-opus-4-6",
    tokenTotal: 12300,
    source: "proxy",
    enriched: true,
    files: [                               // ContextFile[]
      { path: "src/auth/Auth.js",      contentHash: "abc123", tokenCount: 2100 },
      { path: "src/auth/middleware.js", contentHash: "def456", tokenCount: 890 },
      { path: "tests/auth.test.js",    contentHash: "ghi789", tokenCount: 580 },
    ],
    toolCalls: [                           // ToolCall[]
      { tool: "read_file",  input: "src/auth/Auth.js",      output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
      { tool: "read_file",  input: "src/auth/middleware.js", output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
      { tool: "write_file", input: "tests/auth.test.js",    output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 16).toISOString() },
    ],
    messages: [                            // Message[]
      { role: "user",      content: "Analyze the auth module and plan refactoring." },
      { role: "assistant", content: "I'll analyze Auth.js first..." },
    ],
    reasoning: "Identified three anti-patterns: shared mutable state in middleware, missing token expiry checks, inconsistent error propagation. Refactor plan: (1) extract stateless helpers, (2) add expiry guard, (3) standardize error shape.",
    logEvents: [                           // LogEvent[] — enriched by log watcher
      { type: "file_read",  timestamp: new Date(Date.now() - 1000 * 60 * 19).toISOString(), data: { path: "src/auth/Auth.js" } },
      { type: "tool_call",  timestamp: new Date(Date.now() - 1000 * 60 * 17).toISOString(), data: { tool: "write_file" } },
    ],
  },
}

// Diff — matches GET /v1/sessions/:id/diff?from=&to= response
export const mockDiff = {
  added:       ["tests/auth.test.js"],
  removed:     [],
  token_delta: 4500,
}

// Graph — matches GET /v1/sessions/:id/graph response (ReactFlow format)
export const mockGraph = {
  nodes: [
    { id: "task_01", data: { label: "Parse codebase",            status: "COMPLETED", tokenTotal: 7800,  snapshotCount: 2 }, position: { x: 300, y: 0   } },
    { id: "task_02", data: { label: "Identify refactor targets", status: "COMPLETED", tokenTotal: 4500,  snapshotCount: 1 }, position: { x: 300, y: 120 } },
    { id: "task_03", data: { label: "Generate refactor plan",    status: "ACTIVE",    tokenTotal: 6120,  snapshotCount: 1 }, position: { x: 300, y: 240 } },
    { id: "task_04", data: { label: "Write tests",               status: "ACTIVE",    tokenTotal: 0,     snapshotCount: 0 }, position: { x: 150, y: 360 } },
    { id: "task_05", data: { label: "Apply refactor",            status: "PENDING",   tokenTotal: 0,     snapshotCount: 0 }, position: { x: 450, y: 360 } },
    { id: "task_06", data: { label: "Validate output",           status: "PENDING",   tokenTotal: 0,     snapshotCount: 0 }, position: { x: 450, y: 480 } },
  ],
  edges: [
    { id: "e_task_01_task_02", source: "task_01", target: "task_02", animated: false },
    { id: "e_task_02_task_03", source: "task_02", target: "task_03", animated: true  },
    { id: "e_task_03_task_04", source: "task_03", target: "task_04", animated: true  },
    { id: "e_task_03_task_05", source: "task_03", target: "task_05", animated: true  },
    { id: "e_task_05_task_06", source: "task_05", target: "task_06", animated: true  },
  ],
}

// Usage — matches GET /v1/usage response
export const mockUsage = {
  total_sessions: 12,
  active_sessions: 3,
  total_snapshots: 84,
  total_tokens_stored: 1240800,
  snapshots_this_month: 31,
  tokens_this_month: 420300,
}

// API Keys — matches GET /v1/keys response (key value never included in list)
export const mockKeys = [
  { id: "key_01", label: "Dev workstation",   lastUsed: new Date(Date.now() - 1000 * 60 * 5).toISOString(),  active: true, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString() },
  { id: "key_02", label: "CI pipeline",       lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), active: true, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
]

// Search results — matches GET /v1/search?q= response
export const mockSearchResults = [
  { snapshotId: "snap_003", taskId: "task_02", sessionId: "sess_01", label: "Refactor plan generated", source: "proxy", score: 0.94, createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
  { snapshotId: "snap_002", taskId: "task_01", sessionId: "sess_01", label: "Auth.js read + analyzed", source: "log_watcher", score: 0.87, createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString() },
]
```

---

## 6. Claude Code Prompts

Open a terminal in VSCode (`Ctrl+`` `) and launch Claude Code:

```bash
claude
```

Use these prompts in sequence. Each prompt is a self-contained instruction to Claude Code.

---

### Sprint 1 — Shell, Layout, Session List

**Prompt 1.1 — App shell + routing**
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
- A top bar (src/components/layout/TopBar.jsx)
  - Shows current page breadcrumb on left
  - Shows a live token counter (mock: "1,240,800 tokens" in IBM Plex Mono) on right
  - Height 40px, border-bottom 1px solid #1E1E22

No chat input. No message box. No textarea. This is a control panel, not a chat UI.
```

**Prompt 1.2 — Session List**
```
Build src/components/sessions/SessionList.jsx that:
- Renders a full-width table (no card grid) of sessions from src/data/mock.js
  (use mockSessionsResponse.data — the real API wraps the array in { data, nextCursor })
- Columns: Status · Name · Description · Last Updated · Actions
- StatusBadge component: dot + label, status values are UPPERCASE strings:
    ACTIVE    → teal (#00E5CC)
    PAUSED    → amber (#F5A623)
    COMPLETED → muted (#6B6B7A)
- Last Updated: relative time using date-fns (e.g. "8 min ago")
- Actions column: "Open →" link in teal for ACTIVE/PAUSED, "View" for COMPLETED
- Row hover: background #111113, border-left 2px solid #00E5CC
- Table header: uppercase, letter-spacing, text-subtle (#6B6B7A), font-size 0.65rem
- No shadows. No rounded cards. Borders only.
- Filter bar above: All · Active · Paused · Completed tabs
  (filter by status === "ACTIVE" / "PAUSED" / "COMPLETED" — uppercase match)
```

---

### Sprint 2 — Snapshot Timeline + Context Inspector

**Prompt 2.1 — Session Detail layout**
```
Build src/components/detail/SessionDetail.jsx as a horizontal split-pane:
- Left pane: 280px fixed width, holds SnapshotTimeline
- Right pane: flex-1, holds ContextInspector
- Divider: 1px solid #1E1E22, no drag handle needed for MVP
- Top of the page: session name (large, DM Sans medium) + status badge + back arrow

Build src/components/detail/SnapshotTimeline.jsx:
- Data source: mockTimeline from src/data/mock.js
  (real API shape from GET /v1/sessions/:id/snapshots/timeline)
- Each item has: id, label, taskId, taskName, source, enriched, tokenTotal, tokenDelta, createdAt
- Vertical timeline of checkpoint nodes
- Each node: circle (8px, border teal) + label + taskName (2xs, subtle) + timestamp (mono, 2xs, subtle)
- Active/selected node: circle filled teal, label text-white
- Connecting line: 1px solid #1E1E22 between nodes
- Clicking a node selects it and updates the right pane
- Below each node show token delta (e.g. "+3,600 tokens") in amber mono text
  (first node shows tokenTotal, subsequent nodes show tokenDelta)
- Source badge: small pill — "proxy" in teal, "log_watcher" in amber, "mcp" in muted
- Enrichment indicator: small dot next to label when enriched === true
- At the bottom: "Rollback to checkpoint" button (amber, outline style)
  - Only enabled when a non-latest snapshot is selected
  - Clicking opens the RollbackDrawer
```

**Prompt 2.2 — Context Inspector**
```
Build src/components/detail/ContextInspector.jsx that displays the selected snapshot's bundle
contents. Use mockSnapshot.bundle from src/data/mock.js for dev.

Real API: GET /v1/snapshots/:id returns { id, taskId, label, tokenTotal, model, source,
enriched, enrichedAt, embedded, r2Key, createdAt, bundle }
The bundle field is the ContextBundle: { files, toolCalls, messages, reasoning, logEvents }

Four sections, each collapsible with a chevron:

1. Files (bundle.files)
   - List of file paths with a file icon (lucide)
   - Each row: path in mono font + tokenCount badge on the right (IBM Plex Mono, subtle)
   - If no files: show empty state "No files captured"

2. Messages (bundle.messages)
   - Each message: role badge (user=teal, assistant=subtle) + content (truncated to 2 lines)
   - Timestamp if present, in mono subtle
   - If bundle.reasoning is present, show it as a collapsible "Reasoning" sub-section
     with amber left border

3. Tool Calls (bundle.toolCalls)
   - Each call: tool name in mono + input (truncated to 60 chars) + status dot + timestamp
   - status: "success" = green dot, "error" = red dot
   - If no tool calls: empty state "No tool calls recorded"

4. Log Events (bundle.logEvents — enriched by log watcher)
   - Only shown when bundle.logEvents.length > 0 OR snapshot.enriched === true
   - Each event: type badge + timestamp + data (collapsed JSON)
   - Section header shows "Enriched" indicator dot when enriched === true

Section header: uppercase, letter-spacing, 0.65rem, text-subtle
Top of inspector: snapshot metadata bar — label, model, source badge, tokenTotal in mono,
createdAt timestamp. If enriched: small "enriched" pill in amber.

No chat messages display. No AI response list. This is state inspection.
```

---

### Sprint 3 — Rollback Drawer

**Prompt 3.1 — Rollback UI**
```
Build src/components/rollback/RollbackDrawer.jsx as a right-side slide-in drawer (not a modal):
- Width: 380px, slides in from right over the content
- Backdrop: semi-transparent #0A0A0B at 80% opacity
- Header: "Restore Checkpoint" in DM Sans medium + close X button

Body shows diff data from mockDiff in src/data/mock.js.
Real API: GET /v1/sessions/:id/diff?from={snapshotId}&to={targetSnapshotId}
Response: { added: string[], removed: string[], token_delta: number }

Display:
- "Restoring to: [snapshot label]"
- "Files added in this restore:" — list from diff.added, each with green left border
- "Files removed from current context:" — list from diff.removed, each with red left border
- Total token delta: diff.token_delta formatted as "+4,500" or "−3,200" in large mono amber text
  (positive = tokens added back, negative = tokens removed)

Footer:
- "Cancel" — ghost/outline, closes drawer
- "Confirm Rollback" — solid amber background, dark text, bold

The Confirm Rollback action calls POST /v1/snapshots/:targetSnapshotId/rollback (no request body).
Response: { rollback_snapshot_id, source_snapshot_id, label, captured_at, token_total, bundle }
On success: close drawer + refresh timeline. The new snapshot appears at the end — do NOT remove
any existing snapshots (immutability invariant: rollback creates, never deletes).

Warning text below buttons (small, subtle):
"This creates a new snapshot restoring the selected checkpoint state.
Original history is preserved."

No undo. No chat. No input fields.
```

---

### Sprint 4 — Task Graph

**Prompt 4.1 — Task Graph with ReactFlow**
```
Build src/components/graph/TaskGraph.jsx using ReactFlow.

Data source: mockGraph from src/data/mock.js for dev.
Real API: GET /v1/sessions/:id/graph returns ReactFlow-compatible { nodes, edges } directly.

Node shape from API:
  { id, data: { label, status, tokenTotal, snapshotCount }, position }

Node status values are UPPERCASE: COMPLETED, ACTIVE, PENDING, FAILED.
  COMPLETED → border teal (#00E5CC), bg #00E5CC10
  ACTIVE    → border amber (#F5A623), bg #F5A62310, add a subtle pulse ring animation
  PENDING   → border muted (#3A3A42), bg transparent
  FAILED    → border red (#FF4D4D), bg #FF4D4D10

Custom node component: task name (DM Sans medium) + status badge + tokenTotal if > 0 (mono subtle)
  + snapshotCount badge (e.g. "3 snapshots" in 2xs subtle)

ReactFlow config:
- Background: #0A0A0B, dot pattern (ReactFlow Background component, gap 20, size 1, color #1E1E22)
- Edges: animated if animated === true (from API — set for ACTIVE/PENDING paths)
- Edge color: #3A3A42, selected: teal
- No minimap
- Controls: zoom in/out only (bottom left), styled dark
- Node width: 200px
- Fit view on load

Clicking a node navigates to /session/:sessionId (use the sessionId from the page URL param).
No toolbar. No "add node" button. Read-only graph.
```

---

### Sprint 5 — Search + Keys + Usage

**Prompt 5.1 — Search page**
```
Build src/pages/SearchPage.jsx and src/components/search/SearchResults.jsx.

SearchPage layout:
- Single search input at the top (this is the ONE place in the app with an input — 
  it is a query input, not a chat input)
- Input: DM Sans, dark bg #111113, border #1E1E22, focus border teal
- "Search" button inline (teal, disabled when empty)
- Optional filter: session selector dropdown (sessions from mockSessionsResponse.data)
- Results below, powered by mockSearchResults from src/data/mock.js

SearchResults component:
- List of result rows, each showing:
  - label (DM Sans medium)
  - source badge: "proxy" / "log_watcher" / "mcp"
  - session + task IDs (mono subtle, truncated)
  - Similarity score: shown as a bar (0–1 range, filled teal) + numeric value in mono
  - createdAt: relative time
  - Click navigates to /session/:sessionId and selects the snapshot

Empty state: "No results found — try different keywords"
503 state: "Semantic search not configured — Qdrant or Voyage AI not set up"

Real API: GET /v1/search?q={query}&session_id={optional}&limit=10
Returns: [{ snapshotId, taskId, sessionId, label, source, score, createdAt }]
```

**Prompt 5.2 — Settings page (API key management)**
```
Build src/pages/SettingsPage.jsx and src/components/keys/KeysManager.jsx.

SettingsPage has one section: "API Keys"
KeysManager component:

Create key section:
- "Label" input (optional, DM Sans, dark input style)
- "Generate Key" button (teal)
- On success (POST /v1/keys): show a one-time display panel with the full key value
  ("kontex_xxxx...") in a mono code block with a copy-to-clipboard button
  Warning text: "Copy this key now. It will not be shown again."
  Dismiss button closes the panel. Key value is never retrieved again.

Keys list (from mockKeys / GET /v1/keys):
- Table: Label · Last Used · Created · Actions
- key value is NEVER shown in the list (API never returns it after creation)
- Actions: "Revoke" button (amber, outline) → DELETE /v1/keys/:id → soft-deletes (active: false)
  Confirm before revoking: inline confirmation "Revoke this key? Yes / Cancel"
- lastUsed: relative time (date-fns) or "Never" if null
- Empty state: "No API keys — generate one above"

No passwords. No OAuth. This is purely API key management.
```

**Prompt 5.3 — Usage stats**
```
Build src/components/usage/UsageStats.jsx that displays data from mockUsage in src/data/mock.js.
Real API: GET /v1/usage

Show as a stats bar at the top of Home.jsx (above the session list):
Six stat cells in a horizontal row, border-right between each:
  Total Sessions | Active Sessions | Total Snapshots | Tokens Stored | Snapshots This Month | Tokens This Month

Each cell:
  - Stat value: large, IBM Plex Mono, text-text
  - Label: 2xs, uppercase, letter-spacing, text-subtle
  - Tokens: format with commas (e.g. "1,240,800")

Background: #111113, border-bottom 1px solid #1E1E22, padding 12px 24px
No charts. No graphs. Numbers only — this is a cockpit, not an analytics dashboard.
```

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

## 7. Running the Dev Server

```bash
npm run dev
# Opens at http://localhost:5173
```

VSCode tasks (add to `.vscode/tasks.json`):
```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Dev Server",
      "type": "shell",
      "command": "npm run dev",
      "group": { "kind": "build", "isDefault": true },
      "presentation": { "reveal": "always", "panel": "new" }
    }
  ]
}
```

---

## 8. Connecting to Real Kontex API

Set the API URL in `.env`:
```
VITE_KONTEX_API_URL=https://your-kontex-api.railway.app
```

Authentication: the backend uses `Authorization: Bearer {apiKey}` where the key is a Kontex API key
(format `kontex_xxxx...`). Store it in `localStorage` as `kontex_api_key`.

Create `src/hooks/useKontexAPI.js`:

```js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_KONTEX_API_URL;

const headers = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("kontex_api_key")}`,
});

// ── Sessions ──────────────────────────────────────────────────────────────────

// Returns { data: Session[], nextCursor }
// Status filter: "ACTIVE" | "PAUSED" | "COMPLETED" (uppercase)
export const useSessions = (status) =>
  useQuery({
    queryKey: ["sessions", status],
    queryFn: () => {
      const url = new URL(`${BASE}/v1/sessions`);
      if (status) url.searchParams.set("status", status);
      return fetch(url, { headers: headers() }).then((r) => r.json());
    },
  });

// Returns session with taskCount
export const useSession = (sessionId) =>
  useQuery({
    queryKey: ["session", sessionId],
    queryFn: () =>
      fetch(`${BASE}/v1/sessions/${sessionId}`, { headers: headers() }).then((r) => r.json()),
    enabled: !!sessionId,
  });

export const useCreateSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetch(`${BASE}/v1/sessions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
};

export const useUpdateSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }) =>
      fetch(`${BASE}/v1/sessions/${id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["session", id] });
    },
  });
};

// ── Snapshots ─────────────────────────────────────────────────────────────────

// Returns { id, taskId, label, tokenTotal, model, source, enriched, enrichedAt,
//           embedded, r2Key, createdAt, bundle }
// bundle is the full ContextBundle: { files, toolCalls, messages, reasoning, logEvents }
export const useSnapshot = (snapshotId) =>
  useQuery({
    queryKey: ["snapshot", snapshotId],
    queryFn: () =>
      fetch(`${BASE}/v1/snapshots/${snapshotId}`, { headers: headers() }).then((r) => r.json()),
    enabled: !!snapshotId,
  });

// Returns [{ id, label, taskId, taskName, source, enriched, tokenTotal, tokenDelta, createdAt }]
export const useTimeline = (sessionId) =>
  useQuery({
    queryKey: ["timeline", sessionId],
    queryFn: () =>
      fetch(`${BASE}/v1/sessions/${sessionId}/snapshots/timeline`, { headers: headers() }).then(
        (r) => r.json()
      ),
    enabled: !!sessionId,
  });

// ── Rollback ──────────────────────────────────────────────────────────────────

// POST /v1/snapshots/:id/rollback — no request body
// Creates a NEW snapshot (never deletes history)
// Returns { rollback_snapshot_id, source_snapshot_id, label, captured_at, token_total, bundle }
export const useRollback = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ snapshotId }) =>
      fetch(`${BASE}/v1/snapshots/${snapshotId}/rollback`, {
        method: "POST",
        headers: headers(),
      }).then((r) => r.json()),
    onSuccess: (_, { sessionId }) => {
      if (sessionId) qc.invalidateQueries({ queryKey: ["timeline", sessionId] });
    },
  });
};

// ── Diff ──────────────────────────────────────────────────────────────────────

// Returns { added: string[], removed: string[], token_delta: number }
export const useDiff = (sessionId, fromId, toId) =>
  useQuery({
    queryKey: ["diff", sessionId, fromId, toId],
    queryFn: () => {
      const url = new URL(`${BASE}/v1/sessions/${sessionId}/diff`);
      url.searchParams.set("from", fromId);
      url.searchParams.set("to", toId);
      return fetch(url, { headers: headers() }).then((r) => r.json());
    },
    enabled: !!sessionId && !!fromId && !!toId,
  });

// ── Graph ─────────────────────────────────────────────────────────────────────

// Returns ReactFlow-compatible { nodes, edges }
// nodes: [{ id, data: { label, status, tokenTotal, snapshotCount }, position }]
// edges: [{ id, source, target, animated }]
export const useGraph = (sessionId) =>
  useQuery({
    queryKey: ["graph", sessionId],
    queryFn: () =>
      fetch(`${BASE}/v1/sessions/${sessionId}/graph`, { headers: headers() }).then((r) => r.json()),
    enabled: !!sessionId,
  });

// ── Usage ─────────────────────────────────────────────────────────────────────

// Returns { total_sessions, active_sessions, total_snapshots, total_tokens_stored,
//           snapshots_this_month, tokens_this_month }
export const useUsage = () =>
  useQuery({
    queryKey: ["usage"],
    queryFn: () => fetch(`${BASE}/v1/usage`, { headers: headers() }).then((r) => r.json()),
  });

// ── Search ────────────────────────────────────────────────────────────────────

// Returns [{ snapshotId, taskId, sessionId, label, source, score, createdAt }]
// 503 if Qdrant/Voyage not configured: { error: "search_unavailable", message: "..." }
export const useSearch = (q, sessionId, limit = 10) =>
  useQuery({
    queryKey: ["search", q, sessionId, limit],
    queryFn: () => {
      const url = new URL(`${BASE}/v1/search`);
      url.searchParams.set("q", q);
      if (sessionId) url.searchParams.set("session_id", sessionId);
      url.searchParams.set("limit", String(limit));
      return fetch(url, { headers: headers() }).then((r) => r.json());
    },
    enabled: !!q && q.trim().length > 0,
  });

// ── API Keys ──────────────────────────────────────────────────────────────────

// Returns [{ id, label, lastUsed, active, createdAt }] — key value NEVER in list
export const useKeys = () =>
  useQuery({
    queryKey: ["keys"],
    queryFn: () => fetch(`${BASE}/v1/keys`, { headers: headers() }).then((r) => r.json()),
  });

// Returns { id, key, label, createdAt } — key value only returned here, save it immediately
export const useCreateKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      fetch(`${BASE}/v1/keys`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });
};

// Soft-deletes (sets active: false). Returns 204.
export const useDeleteKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) =>
      fetch(`${BASE}/v1/keys/${id}`, { method: "DELETE", headers: headers() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  });
};
```

Swap mock data imports for these hooks screen by screen.

---

## 9. Deployment

The dashboard is served as a static build via nginx inside a Docker container.

**`Dockerfile`** (place at project root):
```dockerfile
# Stage 1 — build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_KONTEX_API_URL
ENV VITE_KONTEX_API_URL=$VITE_KONTEX_API_URL
RUN npm run build

# Stage 2 — serve
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**`nginx.conf`** (place at project root):
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json;
}
```

**`docker-compose.yml`** (place at project root, for local dev/prod):
```yaml
services:
  kontex-dashboard:
    build:
      context: .
      args:
        VITE_KONTEX_API_URL: ${VITE_KONTEX_API_URL}
    ports:
      - "8080:80"
    restart: unless-stopped
```

**`.env`** (never commit):
```
VITE_KONTEX_API_URL=http://localhost:3000
```

**Build and run:**
```bash
# Build image and start container
docker compose up --build

# Production — pass the real API URL
VITE_KONTEX_API_URL=https://your-kontex-api.example.com docker compose up --build -d

# Check logs
docker compose logs -f kontex-dashboard
```

> `VITE_*` variables are baked in at build time by Vite. They must be passed as `ARG`/`ENV`
> to the Docker build stage — runtime environment variables do not work for Vite apps.

---

## 10. Definition of Done — MVP

- [ ] Session list renders with status filters (ACTIVE / PAUSED / COMPLETED, uppercase match)
- [ ] Clicking a session opens split-pane detail view
- [ ] Timeline shows all checkpoints with tokenDelta, source badges, enrichment indicators
- [ ] Selecting a checkpoint updates the context inspector
- [ ] Context inspector shows files, messages, reasoning, tool calls, log events
- [ ] Rollback drawer opens, calls `/diff` to show added/removed files + token delta
- [ ] Confirm rollback calls `POST /v1/snapshots/:id/rollback`, new snapshot appears in timeline
- [ ] Original snapshots are NOT removed after rollback (immutability preserved)
- [ ] Task graph renders from `/graph` endpoint with COMPLETED/ACTIVE/PENDING/FAILED node states
- [ ] Clicking a graph node navigates to session detail
- [ ] Search page queries `/v1/search`, shows results with similarity scores
- [ ] Settings page: generate key (show once), list keys, revoke keys
- [ ] Usage stats bar shows data from `/v1/usage`
- [ ] Zero chat input elements exist (search input is the only text input)
- [ ] Status badges use UPPERCASE values throughout
- [ ] Token counts use `tokenTotal` field (not `tokenCost`)
- [ ] All token/timestamp/path data renders in IBM Plex Mono
- [ ] Dark theme consistent across all screens
- [ ] `docker compose up --build` starts the container and serves the app on port 8080
- [ ] SPA routing works inside Docker (nginx fallback to index.html)
- [ ] `VITE_KONTEX_API_URL` is correctly baked in at build time

---

## Appendix — API Shape Reference

Quick reference for the shapes your components must handle:

| Endpoint | Response |
|---|---|
| `GET /v1/sessions` | `{ data: Session[], nextCursor }` |
| `GET /v1/sessions/:id` | `Session + taskCount` |
| `GET /v1/sessions/:id/snapshots/timeline` | `TimelineEntry[]` |
| `GET /v1/sessions/:id/graph` | `{ nodes, edges }` (ReactFlow) |
| `GET /v1/sessions/:id/diff?from=&to=` | `{ added, removed, token_delta }` |
| `GET /v1/snapshots/:id` | `Snapshot + bundle (ContextBundle)` |
| `POST /v1/snapshots/:id/rollback` | `{ rollback_snapshot_id, source_snapshot_id, label, captured_at, token_total, bundle }` |
| `GET /v1/usage` | `{ total_sessions, active_sessions, total_snapshots, total_tokens_stored, snapshots_this_month, tokens_this_month }` |
| `GET /v1/search?q=` | `SearchResult[]` or `503 { error: "search_unavailable" }` |
| `GET /v1/keys` | `ApiKey[]` (no key value) |
| `POST /v1/keys` | `{ id, key, label, createdAt }` (key shown once) |
| `DELETE /v1/keys/:id` | `204` |

**Session status values:** `ACTIVE` · `PAUSED` · `COMPLETED`

**Task status values:** `PENDING` · `ACTIVE` · `COMPLETED` · `FAILED`

**Snapshot source values:** `proxy` · `log_watcher` · `mcp`

**Error shape (all endpoints):**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

---

*Kontex UI Build Guide · v2.0 · Updated for backend Sprints 1–8*
*React + Tailwind · Dark Cockpit UI · No chat, ever*
