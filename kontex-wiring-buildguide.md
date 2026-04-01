# Kontex Wiring Build Guide — UI ↔ API Integration

Read this guide alongside `kontex-dashboard/CLAUDE.md`. Every sprint in this guide assumes the backend (sprints 1–8 of `kontex-backend-buildguide.md`) is running and the dashboard UI (sprints 1–6 of `kontex-ui-buildguide.md`) is built.

**Starting state:** All components read from `src/data/mock.js`. `src/hooks/useKontexAPI.js` does not exist.  
**Ending state:** Every page fetches real data. Docker image deployable. Zero mock imports outside `src/data/mock.js`.

---

## Stack

| Concern | Choice |
|---|---|
| Data fetching | @tanstack/react-query v5 |
| Base client | `src/api/client.js` — fetch wrapper with auth |
| Auth | `kontex_api_key` in localStorage · `Authorization: Bearer` header |
| Auth gate | `src/components/auth/ApiKeyGate.jsx` — blocks app if no key |
| Env | `VITE_KONTEX_API_URL` — baked at Vite build time |
| Deploy | Docker multi-stage → nginx |

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 1 | Foundation | QueryClient, base fetcher, auth gate, env |
| 2 | Sessions + Home | useSessions, SessionList, StatCards, Sidebar badges |
| 3 | Session Detail | useTimeline, useSnapshot, SessionDetail wired |
| 4 | Rollback + Diff | useRollback, useDiff, RollbackDrawer, DiffPage |
| 5 | Task Graph | useGraph, TaskGraph, TaskGraphPage |
| 6 | Search + Keys | useSearch, useKeys, SearchPage, KeysManager |
| 7 | Signals + Timeline + Usage | client-side signals, TimelinePage, SignalsPage, UsagePage |
| 8 | Error handling + Deploy | 401 interceptor, error states, Docker, final verification |

---

# Sprint 1 — Foundation

**Goal:** Set up the data-fetching infrastructure every subsequent sprint depends on. QueryClient mounted, base fetcher authenticated, ApiKeyGate blocks the app when no key is present.

**Done criteria:**
- [ ] `VITE_KONTEX_API_URL` reads from `.env` in local dev
- [ ] `QueryClientProvider` wraps the React tree in `main.jsx`
- [ ] `src/api/client.js` exports `apiFetch(path, options?)` — attaches auth header, throws on non-2xx
- [ ] No API key in localStorage → `ApiKeyGate` covers full screen
- [ ] Entering a valid key stores it and dismisses the gate
- [ ] `GET /health` succeeds from the browser console with the stored key

---

## Prompt 1.1 — Environment + QueryClientProvider

```
Create kontex-dashboard/.env.example:

  VITE_KONTEX_API_URL=http://localhost:3000

Copy to .env and fill in your local backend URL. Add .env to .gitignore if not already there.

Update src/main.jsx:

  import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
  import App from "./App"
  import "./index.css"

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:   30_000,      // 30 s
        retry:       1,
        refetchOnWindowFocus: false,
      },
    },
  })

  createRoot(document.getElementById("root")).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )

Verify: npm run dev starts without errors.
```

---

## Prompt 1.2 — Base API client

```
Create src/api/client.js:

  const BASE = import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"

  function getKey() {
    return localStorage.getItem("kontex_api_key") ?? ""
  }

  export class ApiError extends Error {
    constructor(status, code, message, details = {}) {
      super(message)
      this.status  = status
      this.code    = code
      this.details = details
    }
  }

  export async function apiFetch(path, options = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getKey()}`,
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (res.status === 401) {
      localStorage.removeItem("kontex_api_key")
      window.location.reload()
      throw new ApiError(401, "unauthorized", "API key invalid or expired")
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.error ?? "unknown_error", body.message ?? "Request failed", body.details)
    }

    if (res.status === 204) return null
    return res.json()
  }

Rules:
- NEVER log the API key value
- 401 clears the key and reloads — the ApiKeyGate will re-appear
- All hooks import apiFetch from this file; no component calls fetch directly
```

---

## Prompt 1.3 — ApiKeyGate

```
Create src/components/auth/ApiKeyGate.jsx:

  import { useState } from "react"
  import { Key } from "lucide-react"

  export default function ApiKeyGate({ children }) {
    const [key, setKey]     = useState(localStorage.getItem("kontex_api_key") ?? "")
    const [stored, setStored] = useState(!!localStorage.getItem("kontex_api_key"))
    const [error, setError]   = useState("")

    async function handleSubmit(e) {
      e.preventDefault()
      const trimmed = key.trim()
      if (!trimmed.startsWith("kontex_")) {
        setError("Key must start with kontex_")
        return
      }
      // Quick health check to validate the key
      try {
        const res = await fetch(
          `${import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"}/health`
        )
        if (!res.ok) throw new Error("Backend unreachable")
        localStorage.setItem("kontex_api_key", trimmed)
        setStored(true)
        setError("")
      } catch {
        setError("Could not reach backend. Check VITE_KONTEX_API_URL and your key.")
      }
    }

    if (stored) return children

    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="w-full max-w-sm border border-border rounded-md bg-surface p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-teal rounded flex items-center justify-center">
              <Key size={14} className="text-bg" />
            </div>
            <div>
              <p className="font-mono font-semibold text-text">kontex</p>
              <p className="font-sans text-xs text-subtle">Enter your API key to continue</p>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              value={key}
              onChange={(e) => { setKey(e.target.value); setError("") }}
              placeholder="kontex_xxxxxxxxxxxx"
              className="font-mono text-sm bg-bg border border-border rounded px-3 py-2 text-text placeholder:text-muted focus:outline-none focus:border-teal transition-colors duration-150"
            />
            {error && <p className="font-sans text-xs text-red">{error}</p>}
            <button
              type="submit"
              disabled={!key.trim()}
              className="py-2 bg-teal text-bg font-sans font-medium text-sm rounded disabled:opacity-30 hover:opacity-90 transition-opacity"
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    )
  }

Update src/App.jsx — wrap Layout with ApiKeyGate:

  import ApiKeyGate from "./components/auth/ApiKeyGate"

  export default function App() {
    return (
      <BrowserRouter>
        <ApiKeyGate>
          <Layout>
            <Routes>...</Routes>
          </Layout>
        </ApiKeyGate>
      </BrowserRouter>
    )
  }

Verify:
  - Clear localStorage → gate appears
  - Enter a bad key → error shown
  - Enter a valid kontex_ key → gate dismisses, dashboard renders
```

---

# Sprint 2 — Sessions + Home

**Goal:** The Home page and Sidebar show live data from the API.

**Done criteria:**
- [ ] `GET /v1/sessions` populates the session table
- [ ] Status filter (All/Active/Paused/Completed) sends `?status=` query param
- [ ] Skeleton rows show while loading
- [ ] Empty state shows when no sessions exist
- [ ] Stat cards show real totals from `GET /v1/usage`
- [ ] Sidebar session count badge reflects real session count

---

## Prompt 2.1 — useSessions + useSession + useUsage

```
Create src/hooks/useKontexAPI.js and add the first three hooks:

  import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
  import { apiFetch } from "../api/client"

  // ── Sessions ──────────────────────────────────────────────────────────────────

  export function useSessions(status = null) {
    return useQuery({
      queryKey: ["sessions", status],
      queryFn:  () => {
        const params = status ? `?status=${status}` : ""
        return apiFetch(`/v1/sessions${params}`)
      },
    })
  }

  export function useSession(sessionId) {
    return useQuery({
      queryKey: ["session", sessionId],
      queryFn:  () => apiFetch(`/v1/sessions/${sessionId}`),
      enabled:  !!sessionId,
    })
  }

  // ── Usage ─────────────────────────────────────────────────────────────────────

  export function useUsage() {
    return useQuery({
      queryKey: ["usage"],
      queryFn:  () => apiFetch("/v1/usage"),
      staleTime: 60_000,
    })
  }

Response shapes:
  useSessions → { data: Session[], nextCursor }
  useSession  → Session + taskCount field
  useUsage    → { total_sessions, active_sessions, total_snapshots, total_tokens_stored,
                  snapshots_this_month, tokens_this_month }
```

---

## Prompt 2.2 — Wire SessionList

```
Update src/components/sessions/SessionList.jsx:

Replace:
  import { mockSessionsResponse } from "../../data/mock"
  const sessions = mockSessionsResponse.data.filter(...)

With:
  import { useSessions } from "../../hooks/useKontexAPI"

  export default function SessionList() {
    const [activeFilter, setActiveFilter] = useState(null)
    const { data, isLoading, isError } = useSessions(activeFilter)
    const sessions = data?.data ?? []

    // Remove the useEffect setTimeout skeleton hack —
    // isLoading from React Query drives the skeleton instead:
    ...

    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* filter bar unchanged */}
        <div className="flex-1 overflow-auto">
          {isError && (
            <p className="px-6 py-4 font-sans text-sm text-red">Failed to load sessions.</p>
          )}
          {!isError && !isLoading && sessions.length === 0 ? (
            <EmptyState icon={Layers} title="No sessions" subtitle="Create a session via the API or proxy." />
          ) : (
            <table ...>
              <tbody>
                {isLoading
                  ? [0,1,2].map(i => <SkeletonRow key={i} />)
                  : sessions.map(s => <SessionRow key={s.id} session={s} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

Status filter: pass activeFilter directly to useSessions — React Query re-fetches when the key changes.
The API returns { data, nextCursor }; access sessions as data?.data ?? [].
Keep SessionRow, SkeletonRow, SignalsBadges unchanged — they work with real data.
```

---

## Prompt 2.3 — Wire StatCards + Sidebar badges

```
Update src/components/sessions/StatCards.jsx:

Remove all static computation from mock data at module level.
Import useUsage and useSessions instead:

  import { useUsage, useSessions } from "../../hooks/useKontexAPI"

  export default function StatCards() {
    const { data: usage } = useUsage()
    const { data: sessionsData } = useSessions()
    const sessions = sessionsData?.data ?? []

    const totalSignals = sessions.reduce((n, s) =>
      n + (s.signals?.critical ?? 0) + (s.signals?.warning ?? 0), 0)

    const CARDS = [
      { label: "Total Sessions",     value: usage?.total_sessions?.toLocaleString() ?? "—",   ... },
      { label: "Snapshots Captured", value: usage?.total_snapshots?.toLocaleString() ?? "—",  ... },
      { label: "Tokens Stored",      value: usage ? formatTokens(usage.total_tokens_stored) : "—", ... },
      { label: "Active Signals",     value: String(totalSignals),  ... },
    ]
    ...
  }

Update src/components/layout/Sidebar.jsx:

Remove static totalSessions and totalSignals computed from mock.
Import useUsage + useSessions:

  import { useUsage, useSessions } from "../../hooks/useKontexAPI"

  export default function Sidebar() {
    const { data: sessionsData } = useSessions()
    const sessions = sessionsData?.data ?? []
    const totalSessions = sessions.length
    const totalSignals  = sessions.reduce((n, s) =>
      n + (s.signals?.critical ?? 0) + (s.signals?.warning ?? 0), 0)

    // Pass these as props into the NAV array construction or compute inline in JSX
    ...
  }

NOTE: Sidebar is rendered on every page — the query is cached so this adds zero extra requests.
```

---

# Sprint 3 — Session Detail

**Goal:** Navigating to `/session/:id` loads the real session, its timeline, and full snapshot bundles.

**Done criteria:**
- [ ] Session name and task count in header come from `GET /v1/sessions/:id`
- [ ] Timeline shows real snapshots from `GET /v1/sessions/:id/snapshots/timeline`
- [ ] Clicking a timeline entry loads the full bundle from `GET /v1/snapshots/:id`
- [ ] `activeSessionId` in sessions store set from URL param on mount
- [ ] Empty state when no timeline entries exist

---

## Prompt 3.1 — useTimeline + wire SnapshotTimeline

```
Add to src/hooks/useKontexAPI.js:

  export function useTimeline(sessionId) {
    return useQuery({
      queryKey: ["timeline", sessionId],
      queryFn:  () => apiFetch(`/v1/sessions/${sessionId}/snapshots/timeline`),
      enabled:  !!sessionId,
    })
  }

Update src/components/detail/SnapshotTimeline.jsx:

Remove:
  const timelineSnapshots = useSessionsStore(...)
  const snapshots = timelineSnapshots[activeSessionId ?? "sess_01"] ?? []

Replace with:
  import { useTimeline } from "../../hooks/useKontexAPI"

  export default function SnapshotTimeline() {
    const activeSessionId   = useSessionsStore(s => s.activeSessionId)
    const activeSnapshotId  = useSessionsStore(s => s.activeSnapshotId)
    const setActiveSnapshot = useSessionsStore(s => s.setActiveSnapshot)
    const openRollback      = useUiStore(s => s.openRollback)

    const { data: snapshots = [], isLoading } = useTimeline(activeSessionId)

    const lastId      = snapshots[snapshots.length - 1]?.id
    const canRollback = activeSnapshotId && activeSnapshotId !== lastId

    if (isLoading) return <div className="p-4 animate-pulse">...</div>

    // rest of render unchanged — snapshots array already matches the mock shape
  }

The useTimeline response is TimelineEntry[] — same shape as mockTimeline.
No changes needed in the render logic.
```

---

## Prompt 3.2 — useSnapshot + wire ContextInspector

```
Add to src/hooks/useKontexAPI.js:

  export function useSnapshot(snapshotId) {
    return useQuery({
      queryKey: ["snapshot", snapshotId],
      queryFn:  () => apiFetch(`/v1/snapshots/${snapshotId}`),
      enabled:  !!snapshotId,
      staleTime: Infinity,   // snapshots are immutable once finalized
    })
  }

Update src/components/detail/ContextInspector.jsx:

Remove:
  import { mockSnapshot } from "../../data/mock"
  const snapshot = activeSnapshotId ? mockSnapshot : null

Replace with:
  import { useSnapshot } from "../../hooks/useKontexAPI"

  export default function ContextInspector() {
    const activeSnapshotId = useSessionsStore(s => s.activeSnapshotId)
    const { data: snapshot, isLoading, isError } = useSnapshot(activeSnapshotId)

    if (!activeSnapshotId) {
      return <EmptyState icon={Scan} title="Select a checkpoint" subtitle="Choose a snapshot from the timeline to inspect its context state" />
    }
    if (isLoading) return <div className="flex items-center justify-center h-full"><p className="font-sans text-sm text-subtle">Loading…</p></div>
    if (isError)   return <div className="flex items-center justify-center h-full"><p className="font-sans text-sm text-red">Failed to load snapshot.</p></div>

    const { bundle } = snapshot
    // rest of render unchanged
  }
```

---

## Prompt 3.3 — Wire SessionDetail header + set activeSessionId

```
Update src/components/detail/SessionDetail.jsx:

Remove:
  import { mockSession } from "../../data/mock"
  const session = mockSession

Replace with:
  import { useParams } from "react-router-dom"
  import { useEffect } from "react"
  import { useSession } from "../../hooks/useKontexAPI"
  import { useSessionsStore } from "../../store/sessions"

  export default function SessionDetail() {
    const { id } = useParams()
    const setActiveSession = useSessionsStore(s => s.setActiveSession)
    const { data: session, isLoading } = useSession(id)

    useEffect(() => {
      if (id) setActiveSession(id)
    }, [id, setActiveSession])

    if (isLoading) return <div className="flex items-center justify-center h-full"><p className="font-sans text-sm text-subtle">Loading session…</p></div>
    if (!session)  return <EmptyState icon={Layers} title="Session not found" subtitle="This session does not exist or you don't have access." />

    return (
      <div className="flex flex-col h-full">
        {/* Header — same structure, now uses real session data */}
        ...
        {session.taskCount !== undefined && (
          <span className="font-mono text-2xs text-subtle ml-auto">
            {session.taskCount} task{session.taskCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    )
  }

Also update src/pages/SessionDetailPage.jsx — it currently renders <SessionDetail /> with no props.
No change needed since SessionDetail reads :id from useParams directly.
```

---

# Sprint 4 — Rollback + Diff

**Goal:** Rollback creates a real snapshot. Diff page compares two real snapshots.

**Done criteria:**
- [ ] Confirming rollback calls `POST /v1/snapshots/:id/rollback`
- [ ] New rollback snapshot appears in timeline immediately (append, never delete)
- [ ] RollbackDrawer diff section shows real added/removed files from `GET /v1/sessions/:id/diff`
- [ ] DiffPage snapshot selects populated from real timeline
- [ ] DiffPage Compare button calls `GET /v1/sessions/:id/diff?from=&to=`

---

## Prompt 4.1 — useRollback + useDiff

```
Add to src/hooks/useKontexAPI.js:

  export function useRollback() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: ({ snapshotId }) =>
        apiFetch(`/v1/snapshots/${snapshotId}/rollback`, { method: "POST" }),
      onSuccess: (newSnapshot, { sessionId }) => {
        // Invalidate timeline so it re-fetches with the new entry
        qc.invalidateQueries({ queryKey: ["timeline", sessionId] })
      },
    })
  }

  export function useDiff(sessionId, fromId, toId) {
    return useQuery({
      queryKey: ["diff", sessionId, fromId, toId],
      queryFn:  () =>
        apiFetch(`/v1/sessions/${sessionId}/diff?from=${fromId}&to=${toId}`),
      enabled: !!(sessionId && fromId && toId),
    })
  }

Rollback response shape:
  { rollback_snapshot_id, source_snapshot_id, label, captured_at, token_total, bundle }

Diff response shape:
  { added: string[], removed: string[], token_delta: number }
```

---

## Prompt 4.2 — Wire RollbackDrawer

```
Update src/components/rollback/RollbackDrawer.jsx:

Remove the mock setTimeout confirm simulation.
Import useRollback and useDiff:

  import { useRollback, useDiff } from "../../hooks/useKontexAPI"

  export default function RollbackDrawer() {
    const open          = useUiStore(s => s.rollbackDrawerOpen)
    const closeRollback = useUiStore(s => s.closeRollback)
    const activeSnapshotId = useSessionsStore(s => s.activeSnapshotId)
    const activeSessionId  = useSessionsStore(s => s.activeSessionId)
    const timelineSnapshots = useSessionsStore(s => s.timelineSnapshots)
    const addSnapshot       = useSessionsStore(s => s.addSnapshot)

    const rollback = useRollback()

    // Get the latest snapshot id for diff comparison
    const snapshots = timelineSnapshots[activeSessionId] ?? []
    const latestId  = snapshots[snapshots.length - 1]?.id
    const targetSnapshot = snapshots.find(s => s.id === activeSnapshotId)

    const { data: diff } = useDiff(activeSessionId, activeSnapshotId, latestId)
    const displayDiff = diff ?? { added: [], removed: [], token_delta: 0 }

    async function handleConfirm() {
      try {
        const result = await rollback.mutateAsync({
          snapshotId: activeSnapshotId,
          sessionId:  activeSessionId,
        })
        // Append new snapshot locally (optimistic, also invalidated via React Query)
        addSnapshot({
          id:         result.rollback_snapshot_id,
          label:      result.label,
          source:     "mcp",
          tokenTotal: result.token_total,
          tokenDelta: 0,
          enriched:   false,
          createdAt:  result.captured_at,
        })
        closeRollback()
      } catch (err) {
        console.error("Rollback failed", err)
      }
    }

    // Loading state: rollback.isPending
    // Error state:   rollback.isError
    ...
  }
```

---

## Prompt 4.3 — Wire DiffPage

```
Update src/pages/DiffPage.jsx:

Remove mockDiffDetailed and mockTimeline imports.
Import useTimeline, useDiff, useSessionsStore:

  import { useState } from "react"
  import { useSearchParams } from "react-router-dom"
  import { useTimeline, useDiff } from "../hooks/useKontexAPI"
  import { useSessionsStore } from "../store/sessions"

  export default function DiffPage() {
    const [searchParams] = useSearchParams()
    const sessionId = searchParams.get("sessionId") ?? useSessionsStore.getState().activeSessionId
    const { data: timeline = [] } = useTimeline(sessionId)

    const [fromId, setFromId] = useState("")
    const [toId,   setToId]   = useState("")
    const [compare, setCompare] = useState(false)

    const { data: diff, isLoading: diffLoading } = useDiff(
      sessionId, fromId, toId
    )

    // Set defaults once timeline loads
    useEffect(() => {
      if (timeline.length >= 2 && !fromId) {
        setFromId(timeline[0].id)
        setToId(timeline[timeline.length - 1].id)
      }
    }, [timeline])

    // Snapshot selects built from timeline entries
    // Compare button sets compare = true (enabling the useDiff query via enabled flag)
    // diff.added / diff.removed / diff.token_delta for summary + file list
    // Since the real diff endpoint returns { added, removed, token_delta } (not line-level),
    // render the file list (DiffPanel per file with "added" or "removed" status, no line data)
    ...
  }

NOTE: The backend diff endpoint returns file-level diff only (added/removed paths + token_delta),
not line-level diffs. Adjust DiffPanel to show file path + change type without line content.
Show token delta in the summary row. Remove the per-line DiffLine component for now.
```

---

# Sprint 5 — Task Graph

**Goal:** TaskGraph renders the real task tree for a session.

**Done criteria:**
- [ ] `GET /v1/sessions/:id/graph` returns ReactFlow-compatible `{ nodes, edges }`
- [ ] TaskGraph renders real nodes with correct status colors and pulse
- [ ] Empty nodes → EmptyState shown
- [ ] Clicking a node navigates to `/session/:sessionId`

---

## Prompt 5.1 — useGraph + wire TaskGraph

```
Add to src/hooks/useKontexAPI.js:

  export function useGraph(sessionId) {
    return useQuery({
      queryKey: ["graph", sessionId],
      queryFn:  () => apiFetch(`/v1/sessions/${sessionId}/graph`),
      enabled:  !!sessionId,
    })
  }

Update src/components/graph/TaskGraph.jsx:

Remove:
  import { mockGraph } from "../../data/mock"
  const initialNodes = mockGraph.nodes.map(...)
  const initialEdges = mockGraph.edges.map(...)

Change to accept props from the page:

  export default function TaskGraph({ sessionId, graphData }) {
    // graphData = { nodes, edges } from useGraph hook

    if (!graphData || graphData.nodes.length === 0) {
      return <EmptyState icon={GitGraph} title="No tasks yet" subtitle="Tasks will appear here as the agent works." />
    }

    const initialNodes = (graphData.nodes ?? []).map(n => ({ ...n, type: "taskNode" }))
    const initialEdges = (graphData.edges ?? []).map(e => ({
      ...e,
      style: { stroke: "#3A3A42", strokeWidth: 1.5 },
    }))

    const [nodes, , onNodesChange] = useNodesState(initialNodes)
    const [edges, , onEdgesChange] = useEdgesState(initialEdges)

    // onNodeClick, ReactFlow config unchanged
    ...
  }
```

---

## Prompt 5.2 — Wire TaskGraphPage

```
Update src/pages/TaskGraphPage.jsx:

  import { useSearchParams } from "react-router-dom"
  import { useGraph } from "../hooks/useKontexAPI"
  import { useSessionsStore } from "../store/sessions"
  import TaskGraph from "../components/graph/TaskGraph"

  export default function TaskGraphPage() {
    const [searchParams] = useSearchParams()
    const activeSessionId = useSessionsStore(s => s.activeSessionId)
    const sessionId = searchParams.get("sessionId") ?? activeSessionId

    const { data: graphData, isLoading, isError } = useGraph(sessionId)

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
          <h1 className="font-sans font-medium text-base text-text">Task Graph</h1>
          {sessionId && <span className="font-mono text-2xs text-subtle ml-auto">{sessionId}</span>}
        </div>
        <div className="flex-1">
          {isLoading && <div className="flex items-center justify-center h-full"><p className="font-sans text-sm text-subtle">Loading graph…</p></div>}
          {isError   && <div className="flex items-center justify-center h-full"><p className="font-sans text-sm text-red">Failed to load graph.</p></div>}
          {!isLoading && !isError && (
            <TaskGraph sessionId={sessionId} graphData={graphData} />
          )}
        </div>
      </div>
    )
  }

Add a "View graph →" link in SessionDetail.jsx header:

  import { Link } from "react-router-dom"

  // In the header row, after the task count span:
  <Link
    to={`/graph?sessionId=${session.id}`}
    className="font-mono text-2xs text-subtle hover:text-teal transition-colors ml-3"
  >
    graph →
  </Link>
```

---

# Sprint 6 — Search + API Keys

**Goal:** Search page returns real semantic results. Key management calls real API.

**Done criteria:**
- [ ] `GET /v1/search?q=` returns results or 503 `search_unavailable`
- [ ] 503 state shows `SearchUnavailable` component
- [ ] `GET /v1/keys` populates the keys table
- [ ] `POST /v1/keys` returns the key value once — shown in one-time panel
- [ ] `DELETE /v1/keys/:id` soft-deletes and refreshes the list

---

## Prompt 6.1 — useSearch + wire SearchPage

```
Add to src/hooks/useKontexAPI.js:

  export function useSearch({ q, sessionId, limit = 10 }, options = {}) {
    return useQuery({
      queryKey: ["search", q, sessionId, limit],
      queryFn:  async () => {
        const params = new URLSearchParams({ q, limit: String(limit) })
        if (sessionId) params.set("session_id", sessionId)
        const res = await apiFetch(`/v1/search?${params.toString()}`)
        return res  // SearchResult[]
      },
      enabled: !!(q && q.trim().length > 0) && (options.enabled !== false),
      retry:   false,   // don't retry 503
    })
  }

In src/api/client.js — handle 503 separately (search unavailable is not a true error):

  // In apiFetch, before the generic !res.ok throw:
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(503, body.error ?? "search_unavailable", body.message ?? "Search unavailable")
  }

Update src/pages/SearchPage.jsx:

  import { useState } from "react"
  import { useSearch } from "../hooks/useKontexAPI"
  import { ApiError } from "../api/client"

  export default function SearchPage() {
    const [query, setQuery]         = useState("")
    const [submitted, setSubmitted] = useState("")
    const [sessionFilter, setSessionFilter] = useState("all")

    const { data, isLoading, isError, error } = useSearch(
      { q: submitted, sessionId: sessionFilter !== "all" ? sessionFilter : undefined },
      { enabled: submitted.length > 0 }
    )

    const isUnavailable = isError && error?.code === "search_unavailable"

    function handleSearch(e) {
      e.preventDefault()
      setSubmitted(query.trim())
    }

    // Results = data (SearchResult[])
    // isUnavailable → <SearchUnavailable />
    // isError (non-503) → inline error message
    // isLoading → skeleton or spinner
    // data?.length === 0 → <SearchEmpty />
    ...
  }

Remove mock imports (mockSearchResults, mockSessionsResponse.data for sessions dropdown).
For the session filter dropdown, import useSessions:

  const { data: sessionsData } = useSessions()
  const sessions = sessionsData?.data ?? []
```

---

## Prompt 6.2 — Key management hooks

```
Add to src/hooks/useKontexAPI.js:

  export function useKeys() {
    return useQuery({
      queryKey: ["keys"],
      queryFn:  () => apiFetch("/v1/keys"),
    })
  }

  export function useCreateKey() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (label) =>
        apiFetch("/v1/keys", { method: "POST", body: { label: label || undefined } }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["keys"] })
      },
    })
  }

  export function useDeleteKey() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: (id) =>
        apiFetch(`/v1/keys/${id}`, { method: "DELETE" }),
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["keys"] })
      },
    })
  }

createKey response: { id, key, label, createdAt }  ← key value shown only here
deleteKey response: 204 (null from apiFetch)
```

---

## Prompt 6.3 — Wire KeysManager

```
Update src/components/keys/KeysManager.jsx:

Remove mockKeys import and local useState for keys array (React Query owns server state).
Import useKeys, useCreateKey, useDeleteKey:

  import { useKeys, useCreateKey, useDeleteKey } from "../../hooks/useKontexAPI"

  export default function KeysManager() {
    const [label, setLabel]   = useState("")
    const [newKey, setNewKey] = useState(null)   // one-time display
    const [confirmingId, setConfirmingId] = useState(null)

    const { data: keys = [], isLoading } = useKeys()
    const createKey = useCreateKey()
    const deleteKey = useDeleteKey()

    async function handleGenerate(e) {
      e.preventDefault()
      const result = await createKey.mutateAsync(label.trim() || undefined)
      setNewKey(result)   // result.key shown in NewKeyPanel
      setLabel("")
    }

    async function handleRevoke(id) {
      await deleteKey.mutateAsync(id)
      setConfirmingId(null)
    }

    const activeKeys = keys.filter(k => k.active)
    ...
  }

Keep NewKeyPanel and RevokeConfirm components unchanged.
Remove mockGenerateKey — real key comes from createKey.mutateAsync result.
```

---

# Sprint 7 — Signals + Timeline + Usage pages

**Goal:** The three diagnostic/usage pages serve real data. Signals are computed client-side from timeline data — no new backend endpoint required.

**Done criteria:**
- [ ] TimelinePage shows real snapshots from `useTimeline` for a session
- [ ] Signal markers computed from snapshot data (token spikes, repeated tool calls, context limit)
- [ ] SignalsPage lists computed signals with details
- [ ] UsagePage bar charts built from `useUsage` + `useSessions`

---

## Prompt 7.1 — Signal computation utility + wire TimelinePage

```
Create src/utils/signals.js:

  /**
   * Compute client-side signals from a timeline entry array.
   * Returns signal objects interspersed with snapshot entries, sorted by createdAt desc.
   */

  const CONTEXT_LIMIT = 100_000  // tokens

  export function computeSignals(timeline = []) {
    const signals = []

    timeline.forEach((snap, i) => {
      // context_limit_proximity — token total > 80% of limit
      if (snap.tokenTotal > CONTEXT_LIMIT * 0.8) {
        signals.push({
          id:         `sig_limit_${snap.id}`,
          type:       "signal",
          severity:   snap.tokenTotal > CONTEXT_LIMIT * 0.9 ? "CRITICAL" : "WARNING",
          signalType: "context_limit_proximity",
          title:      "Context limit proximity",
          label:      `Context at ${Math.round(snap.tokenTotal / CONTEXT_LIMIT * 100)}%`,
          detail:     `${snap.tokenTotal.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} tokens`,
          description:"Context window usage is high. Agent may start losing early context.",
          data:       `${snap.tokenTotal.toLocaleString()} / ${CONTEXT_LIMIT.toLocaleString()} tokens`,
          snapshotId: snap.id,
          createdAt:  snap.createdAt,
        })
      }

      // context_bloat — token delta > 30% growth in one step
      if (i > 0 && snap.tokenDelta > 0) {
        const prev = timeline[i - 1]
        const growthPct = prev.tokenTotal > 0
          ? (snap.tokenDelta / prev.tokenTotal) * 100
          : 0
        if (growthPct > 30) {
          signals.push({
            id:         `sig_bloat_${snap.id}`,
            type:       "signal",
            severity:   "WARNING",
            signalType: "context_bloat",
            title:      "Context bloat",
            label:      `Context bloat +${Math.round(growthPct)}%`,
            detail:     `${prev.tokenTotal.toLocaleString()} → ${snap.tokenTotal.toLocaleString()} tokens`,
            description:`Token count grew ${Math.round(growthPct)}% in one step. Consider truncating verbose tool outputs.`,
            data:       `Δ +${snap.tokenDelta.toLocaleString()} tokens · growth rate: ${Math.round(growthPct)}%`,
            snapshotId: snap.id,
            createdAt:  snap.createdAt,
          })
        }
      }
    })

    return signals
  }

  export function mergeTimelineWithSignals(timeline = []) {
    const signals = computeSignals(timeline)
    const all = [
      ...timeline.map(s => ({ ...s, type: s.source ?? "proxy" })),
      ...signals,
    ]
    return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }

Update src/pages/TimelinePage.jsx:

  import { useSearchParams } from "react-router-dom"
  import { useSessionsStore } from "../store/sessions"
  import { useTimeline } from "../hooks/useKontexAPI"
  import { mergeTimelineWithSignals } from "../utils/signals"

  export default function TimelinePage() {
    const [searchParams] = useSearchParams()
    const activeSessionId = useSessionsStore(s => s.activeSessionId)
    const sessionId = searchParams.get("sessionId") ?? activeSessionId

    const { data: timeline = [], isLoading } = useTimeline(sessionId)
    const merged = mergeTimelineWithSignals(timeline)

    // Tab filtering: "Signals only" → type === "signal", "MCP checkpoints" → source === "mcp"
    // Pass merged to existing TimelineItem render logic
    ...
  }
```

---

## Prompt 7.2 — Wire SignalsPage

```
Update src/pages/SignalsPage.jsx:

  import { useSearchParams } from "react-router-dom"
  import { useSessionsStore } from "../store/sessions"
  import { useTimeline } from "../hooks/useKontexAPI"
  import { computeSignals, mergeTimelineWithSignals } from "../utils/signals"

  export default function SignalsPage() {
    const [searchParams] = useSearchParams()
    const activeSessionId = useSessionsStore(s => s.activeSessionId)
    const sessionId = searchParams.get("sessionId") ?? activeSessionId

    const { data: timeline = [], isLoading } = useTimeline(sessionId)
    const signals  = computeSignals(timeline)
    const merged   = mergeTimelineWithSignals(timeline)

    const criticalCount = signals.filter(s => s.severity === "CRITICAL").length
    const warningCount  = signals.filter(s => s.severity === "WARNING").length

    // SignalItem renders from signals[]
    // MiniTimelineItem renders from merged[]
    // Remove mockSignals and mockTimelineFull imports
    ...
  }

Remove from Sidebar.jsx: mockSignals import.
Replace totalSignals computation with live signal count from useSessions (sum of signals.critical + signals.warning per session) — same as Sprint 2 Prompt 2.3.
```

---

## Prompt 7.3 — Wire UsagePage

```
Update src/pages/UsagePage.jsx:

  import { useUsage, useSessions } from "../hooks/useKontexAPI"

  export default function UsagePage() {
    const { data: usage }        = useUsage()
    const { data: sessionsData } = useSessions()
    const sessions = sessionsData?.data ?? []

    function formatTokens(n) { ... }   // keep existing

    // Per-session bars: built from sessions array (tokenTotal, snapshotCount)
    // Sort descending by tokens for bar chart order
    const byToken    = [...sessions].sort((a, b) => (b.tokenTotal ?? 0) - (a.tokenTotal ?? 0))
    const bySnapshot = [...sessions].sort((a, b) => (b.snapshotCount ?? 0) - (a.snapshotCount ?? 0))
    const maxTokens    = byToken[0]?.tokenTotal ?? 1
    const maxSnapshots = bySnapshot[0]?.snapshotCount ?? 1

    // Replace mockUsageBySession with byToken / bySnapshot
    // Replace mockUsage with usage (with null guards: usage?.total_snapshots ?? "—")
    ...
  }

Remove mockUsage and mockUsageBySession imports.
```

---

# Sprint 8 — Error Handling + Auth + Docker Deploy

**Goal:** Every failure state is handled gracefully. App deploys as a Docker container.

**Done criteria:**
- [ ] 401 response → localStorage cleared → ApiKeyGate re-appears
- [ ] Network errors surface as inline error messages (not crashes)
- [ ] `docker compose up --build` serves the dashboard on port 8080
- [ ] `VITE_KONTEX_API_URL` build arg points the app at any backend URL
- [ ] Zero mock imports outside `src/data/mock.js` (verify with grep)

---

## Prompt 8.1 — Global error handling

```
Update src/api/client.js — the 401 handler is already in place.
Ensure ApiError includes status, code, message, details on every throw.

Add a shared error display utility src/components/shared/InlineError.jsx:

  export default function InlineError({ message = "Something went wrong." }) {
    return (
      <p className="font-sans text-xs text-red px-1 py-2">{message}</p>
    )
  }

In every data-fetching component, handle isError:
  - If isError and error.code === "not_found" → EmptyState with "Not found"
  - If isError and error.code === "unauthorized" → handled by 401 reload in client.js
  - If isError (other) → InlineError with error.message

Audit all wired components for missing error states:
  - SessionList     → show InlineError above table
  - ContextInspector → show inline "Failed to load snapshot"
  - SnapshotTimeline → show inline "Failed to load timeline"
  - UsagePage        → show "--" in place of stats on error
  - SearchPage       → show InlineError below search bar

Add React Query devtools in dev only (optional):
  import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
  // Inside QueryClientProvider in main.jsx:
  {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
```

---

## Prompt 8.2 — Docker + nginx deploy

```
Create kontex-dashboard/.env.example:
  VITE_KONTEX_API_URL=http://localhost:3000

Create kontex-dashboard/Dockerfile:

  # Stage 1: build
  FROM node:20-alpine AS builder
  WORKDIR /app
  ARG VITE_KONTEX_API_URL=http://localhost:3000
  ENV VITE_KONTEX_API_URL=$VITE_KONTEX_API_URL
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build

  # Stage 2: serve
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]

Create kontex-dashboard/nginx.conf:

  server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Asset caching
    location ~* \.(js|css|png|jpg|svg|ico|woff2?)$ {
      expires 1y;
      add_header Cache-Control "public, immutable";
    }
  }

Create kontex-dashboard/docker-compose.yml:

  services:
    dashboard:
      build:
        context: .
        args:
          VITE_KONTEX_API_URL: ${VITE_KONTEX_API_URL:-http://localhost:3000}
      ports:
        - "8080:80"
      restart: unless-stopped

Usage:
  # Local dev pointing at local backend:
  docker compose up --build

  # Point at production backend:
  VITE_KONTEX_API_URL=https://your-app.railway.app docker compose up --build -d
```

---

## Prompt 8.3 — Final verification pass

```
Run a complete verification pass across all 8 sprints.

1. Mock import audit:
   grep -r "from.*data/mock" src/ --include="*.jsx" --include="*.js" \
     | grep -v "src/data/mock.js"
   Expected: zero results. Every component reads from hooks, not mock.js.

2. Route check — visit every route in the browser with a real backend:
   /              → sessions list loads, stat cards show real numbers
   /session/:id   → session name, task count, timeline, inspector all real
   /graph?sessionId=:id → task graph loads or shows EmptyState
   /search        → query returns real results (or 503 state)
   /settings      → keys list loads, generate + revoke work
   /signals       → signals computed from live timeline
   /timeline      → real timeline with signal markers
   /diff          → snapshot selects populated, compare works
   /usage         → real bar charts

3. Auth flow:
   - Remove kontex_api_key from localStorage → ApiKeyGate appears
   - Enter wrong key → error shown
   - Enter correct key → dashboard loads

4. Rollback invariant:
   - Select a snapshot that is NOT the last → Rollback button enabled
   - Confirm → new snapshot appears at bottom of timeline
   - Original snapshots unchanged (count increased by 1)

5. Docker:
   docker compose up --build
   curl http://localhost:8080/health → served (nginx serves index.html)
   curl http://localhost:8080       → 200

6. Error states:
   - Stop the backend → InlineError appears in components
   - Restart backend → data reloads on next query

Fix every failure before marking Sprint 8 done.
```

---

## Full Hook Reference

All hooks live in `src/hooks/useKontexAPI.js`. Import the base client from `src/api/client.js`.

```javascript
// Sessions
useSessions(status?)          // GET /v1/sessions(?status=)  → { data, nextCursor }
useSession(sessionId)         // GET /v1/sessions/:id        → Session + taskCount

// Snapshots
useTimeline(sessionId)        // GET /v1/sessions/:id/snapshots/timeline → TimelineEntry[]
useSnapshot(snapshotId)       // GET /v1/snapshots/:id                  → Snapshot + bundle

// Rollback + Diff
useRollback()                 // POST /v1/snapshots/:id/rollback → new Snapshot
useDiff(sessionId, from, to)  // GET /v1/sessions/:id/diff?from=&to= → { added, removed, token_delta }

// Graph
useGraph(sessionId)           // GET /v1/sessions/:id/graph → { nodes, edges }

// Usage + Search
useUsage()                    // GET /v1/usage              → stats object
useSearch({ q, sessionId, limit }, options?)  // GET /v1/search → SearchResult[]

// API Keys
useKeys()                     // GET /v1/keys               → ApiKey[]
useCreateKey()                // POST /v1/keys              → { id, key, label, createdAt }
useDeleteKey()                // DELETE /v1/keys/:id        → 204
```

---

*Kontex Wiring Build Guide · v1.0 · 8 sprints · 24 prompts*
*Assumes backend sprints 1–8 complete · UI sprints 1–6 + UI 2.0 complete*
