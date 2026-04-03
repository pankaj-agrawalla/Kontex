# Kontex Dashboard 2.0 — Integration Build Guide

Read this guide alongside `kontex-dashboard/CLAUDE.md`. Every sprint here assumes:
- The backend (Sprints 1–11 of `kontex-backend-2.0-buildguide.md`) is running
- The dashboard UI shell is built (all pages render with mock data from `src/data/mock.js`)

**Starting state:** 100% mock data, no API connection, no tRPC client, no SSE.
**Ending state:** Every page fetches real data via tRPC and REST. SSE drives live session updates. Deployable via Docker.

---

## Stack

| Concern | Choice |
|---|---|
| tRPC client | `@trpc/client` + `@trpc/react-query` |
| REST client | `src/api/client.js` — fetch wrapper with auth header |
| Real-time | `src/sse/useSessionFeed.js` — native EventSource over `/sse/session/:id/feed` |
| Auth | `kontex_api_key` in localStorage · `Authorization: Bearer` on all requests |
| Auth gate | `src/components/auth/ApiKeyGate.jsx` — blocks app if no key stored |
| Env | `VITE_KONTEX_API_URL` — baked at Vite build time |
| Deploy | Docker multi-stage → nginx |

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 1 | Foundation | tRPC client, QueryClient, ApiKeyGate, env, REST base fetcher |
| 2 | Sessions + Home | useTrpc sessions + usage, wire Home, StatCards, Sidebar |
| 3 | Session Detail + SSE | useTrpc snapshots, SSE feed, wire SessionDetail |
| 4 | Rollback + Diff | useTrpc rollback + diff, wire RollbackDrawer + DiffPage |
| 5 | Task Graph | useTrpc dashboard.graph, wire TaskGraph |
| 6 | Search + Keys | REST hooks for search + keys, wire SearchPage + KeysManager |
| 7 | Timeline + Signals + Usage | useTrpc timeline + usage, signals utility, wire remaining pages |
| 8 | Error handling + Deploy | Error boundaries, Docker, nginx, final verification |

---

# Sprint 1 — Foundation

**Goal:** tRPC client and REST fetcher wired up, QueryClient mounted, ApiKeyGate blocks the app until a key is stored, SSE manager shell ready.

**Done criteria:**
- [ ] `VITE_KONTEX_API_URL` reads from `.env` in local dev
- [ ] `QueryClientProvider` + `TRPCProvider` wrap the React tree in `main.jsx`
- [ ] `src/api/client.js` exports `apiFetch(path, options?)` — attaches Bearer header, throws `ApiError` on non-2xx
- [ ] `src/api/trpc.js` exports `trpc` client and `TRPCProvider`
- [ ] No API key in localStorage → `ApiKeyGate` covers full screen
- [ ] Valid `kontex_` key entered → stored, gate dismisses
- [ ] `GET /health` succeeds from the browser after key is stored

---

## Prompt 1.1 — Environment + packages

```
Install tRPC client packages:
  npm install @trpc/client @trpc/react-query @trpc/server

Create kontex-dashboard/.env.example:
  VITE_KONTEX_API_URL=http://localhost:3000

Copy to .env. Add .env to .gitignore if not already present.

Verify npm run dev starts without errors.
```

---

## Prompt 1.2 — QueryClient + REST base fetcher

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
- NEVER log the API key value anywhere
- 401 clears the key and reloads so ApiKeyGate reappears
- No component calls fetch directly — only hooks use apiFetch

Update src/main.jsx:
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })

  createRoot(document.getElementById("root")).render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  )
```

---

## Prompt 1.3 — tRPC client

```
Create src/api/trpc.js:

  import { createTRPCReact } from "@trpc/react-query"
  import { httpBatchLink } from "@trpc/client"

  // Create the tRPC React hooks object
  // No TypeScript AppRouter import needed — we use untyped client in JS
  export const trpc = createTRPCReact()

  export function createTrpcClient() {
    return trpc.createClient({
      links: [
        httpBatchLink({
          url: `${import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"}/trpc`,
          headers() {
            const key = localStorage.getItem("kontex_api_key") ?? ""
            return { Authorization: `Bearer ${key}` }
          },
        }),
      ],
    })
  }

Update src/main.jsx — add TRPCProvider wrapping QueryClientProvider:

  import { trpc, createTrpcClient } from "./api/trpc"
  import { useState } from "react"

  function Root() {
    const [queryClient] = useState(() => new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
    }))
    const [trpcClient] = useState(() => createTrpcClient())

    return (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </trpc.Provider>
    )
  }

  createRoot(document.getElementById("root")).render(<Root />)

Note: trpc.Provider must be the outer wrapper, QueryClientProvider the inner.
Both share the same queryClient instance — this is required for cache sharing.
```

---

## Prompt 1.4 — ApiKeyGate

```
Create src/components/auth/ApiKeyGate.jsx:

  import { useState } from "react"
  import { Key } from "lucide-react"

  export default function ApiKeyGate({ children }) {
    const [key, setKey]     = useState(localStorage.getItem("kontex_api_key") ?? "")
    const [stored, setStored] = useState(!!localStorage.getItem("kontex_api_key"))
    const [error, setError]   = useState("")
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e) {
      e.preventDefault()
      const trimmed = key.trim()
      if (!trimmed.startsWith("kontex_")) {
        setError("Key must start with kontex_")
        return
      }
      setLoading(true)
      try {
        const res = await fetch(
          `${import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"}/health`
        )
        if (!res.ok) throw new Error()
        localStorage.setItem("kontex_api_key", trimmed)
        setStored(true)
        setError("")
      } catch {
        setError("Could not reach backend. Check VITE_KONTEX_API_URL and your key.")
      } finally {
        setLoading(false)
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
              disabled={!key.trim() || loading}
              className="py-2 bg-teal text-bg font-sans font-medium text-sm rounded disabled:opacity-30 hover:opacity-90 transition-opacity"
            >
              {loading ? "Connecting..." : "Connect"}
            </button>
          </form>
        </div>
      </div>
    )
  }

Update src/App.jsx — wrap with ApiKeyGate:

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
  - Enter non-kontex_ key → validation error shown
  - Enter valid key with backend running → gate dismisses, dashboard renders
```

---

# Sprint 2 — Sessions + Home

**Goal:** Home page and Sidebar show real session and usage data via tRPC.

**Done criteria:**
- [ ] Session list populates from `trpc/sessions.list`
- [ ] Status filter (All / Active / Paused / Completed) triggers a new tRPC query
- [ ] StatCards show live totals from `trpc/dashboard.usage`
- [ ] Sidebar session count badge reflects real count
- [ ] Skeleton rows appear while loading; EmptyState when no sessions

---

## Prompt 2.1 — tRPC hooks for sessions + usage

```
Create src/hooks/useTrpc.js and add the first batch of hooks:

  import { trpc } from "../api/trpc"

  // ── Sessions ──────────────────────────────────────────────────────────────────

  export function useSessions(status = null) {
    return trpc.sessions.list.useQuery(
      { status },
      { queryKey: ["sessions", status] }
    )
  }

  export function useSession(sessionId) {
    return trpc.sessions.byId.useQuery(
      { id: sessionId },
      { enabled: !!sessionId, queryKey: ["session", sessionId] }
    )
  }

  // ── Usage ─────────────────────────────────────────────────────────────────────

  export function useUsage() {
    return trpc.dashboard.usage.useQuery(
      undefined,
      { queryKey: ["usage"], staleTime: 60_000 }
    )
  }

Response shapes expected from backend:
  sessions.list  → { data: Session[], nextCursor }
  sessions.byId  → Session + taskCount
  dashboard.usage → {
    total_sessions, active_sessions,
    total_snapshots, total_tokens_stored,
    snapshots_this_month, tokens_this_month
  }
```

---

## Prompt 2.2 — Wire SessionList

```
Update src/components/sessions/SessionList.jsx:

Remove:
  import { mockSessionsResponse } from "../../data/mock"

Add:
  import { useSessions } from "../../hooks/useTrpc"

Replace static data with:
  const [activeFilter, setActiveFilter] = useState(null)
  const { data, isLoading, isError } = useSessions(activeFilter)
  const sessions = data?.data ?? []

Replace the skeleton setTimeout hack with isLoading from React Query:
  {isLoading
    ? [0, 1, 2].map(i => <SkeletonRow key={i} />)
    : sessions.map(s => <SessionRow key={s.id} session={s} />)
  }

Add error state above the table:
  {isError && (
    <p className="px-6 py-4 font-sans text-sm text-red">Failed to load sessions.</p>
  )}

Add EmptyState when sessions is empty and not loading:
  {!isLoading && !isError && sessions.length === 0 && (
    <EmptyState icon={Layers} title="No sessions" subtitle="Create a session via the API or proxy." />
  )}

Status filter: pass activeFilter directly to useSessions — React Query re-fetches when the key changes.
```

---

## Prompt 2.3 — Wire StatCards + Sidebar

```
Update src/components/sessions/StatCards.jsx:

Remove static mock computation at module level.
Import real hooks:
  import { useUsage, useSessions } from "../../hooks/useTrpc"

  export default function StatCards() {
    const { data: usage } = useUsage()
    const { data: sessionsData } = useSessions()
    const sessions = sessionsData?.data ?? []

    const totalSignals = sessions.reduce((n, s) =>
      n + (s.signals?.critical ?? 0) + (s.signals?.warning ?? 0), 0)

    const CARDS = [
      { label: "Total Sessions",     value: usage?.total_sessions?.toLocaleString() ?? "—" },
      { label: "Snapshots Captured", value: usage?.total_snapshots?.toLocaleString() ?? "—" },
      { label: "Tokens Stored",      value: usage ? formatTokens(usage.total_tokens_stored) : "—" },
      { label: "Active Signals",     value: String(totalSignals) },
    ]
    // JSX unchanged
  }

Update src/components/layout/Sidebar.jsx:

Remove static mock computation.
Import hooks:
  import { useSessions } from "../../hooks/useTrpc"

  const { data: sessionsData } = useSessions()
  const totalSessions = sessionsData?.data?.length ?? 0

NOTE: Sidebar renders on every page — the query is cached so this costs zero extra requests.
```

---

# Sprint 3 — Session Detail + SSE

**Goal:** SessionDetail page shows real timeline and context bundle. SSE connection keeps the timeline live as new snapshots arrive.

**Done criteria:**
- [ ] Timeline populates from `trpc/dashboard.timeline`
- [ ] Selecting a timeline entry loads the bundle from `trpc/snapshots.bundle`
- [ ] SSE connection opens when session detail mounts, closes on unmount
- [ ] New `snapshot_created` event appends entry to timeline without refetch
- [ ] ContextInspector renders files, toolCalls, messages, reasoning from real bundle

---

## Prompt 3.1 — tRPC snapshot hooks

```
Add to src/hooks/useTrpc.js:

  // ── Snapshots ─────────────────────────────────────────────────────────────────

  export function useTimeline(sessionId) {
    return trpc.dashboard.timeline.useQuery(
      { sessionId },
      { enabled: !!sessionId, queryKey: ["timeline", sessionId] }
    )
  }

  export function useSnapshotBundle(snapshotId) {
    return trpc.snapshots.bundle.useQuery(
      { id: snapshotId },
      { enabled: !!snapshotId, queryKey: ["bundle", snapshotId] }
    )
  }

  export function useSnapshot(snapshotId) {
    return trpc.snapshots.byId.useQuery(
      { id: snapshotId },
      { enabled: !!snapshotId, queryKey: ["snapshot", snapshotId] }
    )
  }

Response shapes:
  dashboard.timeline → TimelineEntry[] where each entry has:
    { id, label, tokenTotal, source, createdAt, taskId, taskName }
  snapshots.bundle   → ContextBundle (full shape in CLAUDE.md)
  snapshots.byId     → Snapshot + task
```

---

## Prompt 3.2 — SSE hook

```
Create src/sse/useSessionFeed.js:

  import { useEffect } from "react"

  const BASE = import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"

  export function useSessionFeed(sessionId, { onSnapshotCreated, onSnapshotEnriched, onSnapshotEmbedded } = {}) {
    useEffect(() => {
      if (!sessionId) return

      const key = localStorage.getItem("kontex_api_key") ?? ""
      // EventSource does not support custom headers natively —
      // use fetch with streaming reader instead
      const controller = new AbortController()

      async function connect() {
        try {
          const res = await fetch(`${BASE}/sse/session/${sessionId}/feed`, {
            headers: { Authorization: `Bearer ${key}` },
            signal: controller.signal,
          })

          if (!res.ok) {
            console.error("[SSE] Failed to connect:", res.status)
            return
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const parts = buffer.split("\n\n")
            buffer = parts.pop() ?? ""

            for (const part of parts) {
              const dataLine = part.split("\n").find(l => l.startsWith("data:"))
              if (!dataLine) continue
              try {
                const event = JSON.parse(dataLine.slice(5).trim())
                if (event.type === "snapshot_created") onSnapshotCreated?.(event)
                if (event.type === "snapshot_enriched") onSnapshotEnriched?.(event)
                if (event.type === "snapshot_embedded") onSnapshotEmbedded?.(event)
              } catch {
                // malformed event — skip
              }
            }
          }
        } catch (err) {
          if (err.name !== "AbortError") {
            console.error("[SSE] Connection error:", err)
          }
        }
      }

      connect()
      return () => controller.abort()
    }, [sessionId])
  }
```

---

## Prompt 3.3 — Wire SessionDetail + SnapshotTimeline

```
Update src/pages/SessionDetailPage.jsx (or wherever useSessionFeed is mounted):

  import { useSessionFeed } from "../sse/useSessionFeed"
  import { useQueryClient } from "@tanstack/react-query"

  // Inside the component:
  const queryClient = useQueryClient()

  useSessionFeed(sessionId, {
    onSnapshotCreated: (event) => {
      // Append new entry to cached timeline without refetching
      queryClient.setQueryData(["timeline", sessionId], (old) => {
        if (!old) return old
        const newEntry = {
          id: event.snapshotId,
          label: event.label ?? "New checkpoint",
          tokenTotal: event.tokenTotal ?? 0,
          source: event.source ?? "proxy",
          createdAt: event.createdAt ?? new Date().toISOString(),
        }
        return [...old, newEntry]
      })
    },
  })

Update src/components/detail/SnapshotTimeline.jsx:

Remove:
  import { mockTimeline } from "../../data/mock"

Add:
  import { useTimeline } from "../../hooks/useTrpc"

  const { data: timeline = [], isLoading } = useTimeline(sessionId)

  // Show skeleton while loading:
  if (isLoading) return <div className="p-4 space-y-2">{[0,1,2].map(i =>
    <div key={i} className="h-12 bg-muted rounded animate-pulse" />
  )}</div>

Update src/components/detail/ContextInspector.jsx:

Remove:
  import { mockSnapshot } from "../../data/mock"

Add:
  import { useSnapshotBundle } from "../../hooks/useTrpc"

  const { data: bundle, isLoading } = useSnapshotBundle(activeSnapshotId)

  // Show EmptyState when no snapshot selected:
  if (!activeSnapshotId) return (
    <EmptyState icon={FileCode} title="Select a checkpoint" subtitle="Choose a snapshot from the timeline to inspect its context." />
  )

  // Use bundle.files, bundle.toolCalls, bundle.messages, bundle.reasoning from real data
  // All existing JSX rendering these fields works unchanged
```

---

# Sprint 4 — Rollback + Diff

**Goal:** RollbackDrawer triggers a real rollback via tRPC. DiffPage shows a real diff between two snapshots.

**Done criteria:**
- [ ] `trpc/snapshots.rollback` mutation fires when user confirms rollback
- [ ] New snapshot appended to timeline after successful rollback
- [ ] DiffPage loads diff from `trpc/dashboard.diff` with from/to snapshot IDs
- [ ] Rollback button shows loading state during mutation

---

## Prompt 4.1 — Rollback + diff hooks

```
Add to src/hooks/useTrpc.js:

  import { useQueryClient } from "@tanstack/react-query"

  export function useRollback(sessionId) {
    const queryClient = useQueryClient()
    return trpc.snapshots.rollback.useMutation({
      onSuccess: (data) => {
        // Append rollback snapshot to cached timeline
        queryClient.setQueryData(["timeline", sessionId], (old) => {
          if (!old) return old
          return [...old, {
            id: data.rollback_snapshot_id,
            label: data.label,
            tokenTotal: data.token_total,
            source: "proxy",
            createdAt: data.captured_at,
          }]
        })
        // Invalidate snapshots list
        queryClient.invalidateQueries({ queryKey: ["timeline", sessionId] })
      },
    })
  }

  export function useDiff(sessionId, fromId, toId) {
    return trpc.dashboard.diff.useQuery(
      { sessionId, from: fromId, to: toId },
      {
        enabled: !!sessionId && !!fromId && !!toId,
        queryKey: ["diff", sessionId, fromId, toId],
      }
    )
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

Remove any mock rollback simulation (setTimeout, state mutation).
Add:
  import { useRollback } from "../../hooks/useTrpc"
  import { useUiStore } from "../../store/ui"

  const { mutate: rollback, isPending, isError } = useRollback(sessionId)
  const closeRollback = useUiStore(s => s.closeRollback)

  async function handleConfirm() {
    rollback(
      { id: activeSnapshotId },
      {
        onSuccess: () => { closeRollback() },
        onError: () => { /* error shown inline */ },
      }
    )
  }

  // In the confirm button:
  <button
    onClick={handleConfirm}
    disabled={isPending}
    className="... disabled:opacity-40"
  >
    {isPending ? "Rolling back..." : "Confirm Rollback"}
  </button>

  {isError && <p className="text-red text-sm font-sans mt-2">Rollback failed. Try again.</p>}

IMPORTANT: After rollback succeeds, the original snapshot must still appear in the timeline.
Rollback is append-only — never call any API to delete or hide the original.
```

---

## Prompt 4.3 — Wire DiffPage

```
Update src/pages/DiffPage.jsx:

Remove:
  import { mockDiffDetailed } from "../data/mock"

Add:
  import { useDiff } from "../hooks/useTrpc"

  // from and to come from URL search params or local dropdown state
  const { data: diff, isLoading, isError } = useDiff(sessionId, fromId, toId)

  // Show skeleton while loading:
  if (isLoading) return <div className="p-6 space-y-3">{[0,1,2].map(i =>
    <div key={i} className="h-8 bg-muted rounded animate-pulse" />
  )}</div>

  // diff.added → green lines, diff.removed → red lines, diff.token_delta → amber/green badge
  // Existing JSX rendering added/removed/token_delta works unchanged
```

---

# Sprint 5 — Task Graph

**Goal:** TaskGraph page renders the real task tree from the backend.

**Done criteria:**
- [ ] Graph data loads from `trpc/dashboard.graph`
- [ ] ReactFlow renders real nodes and edges
- [ ] EmptyState shown when session has no tasks

---

## Prompt 5.1 — Graph hook + wire TaskGraph

```
Add to src/hooks/useTrpc.js:

  export function useGraph(sessionId) {
    return trpc.dashboard.graph.useQuery(
      { sessionId },
      { enabled: !!sessionId, queryKey: ["graph", sessionId] }
    )
  }

Response shape (ReactFlow-ready from backend):
  { nodes: ReactFlowNode[], edges: ReactFlowEdge[] }
  Each node has: { id, data: { label, status, taskName }, position, type }
  Each edge has: { id, source, target }

Update src/pages/TaskGraphPage.jsx:

Remove:
  import { mockGraph } from "../data/mock"

Add:
  import { useGraph } from "../hooks/useTrpc"

  const sessionId = new URLSearchParams(location.search).get("sessionId")
  const { data: graph, isLoading, isError } = useGraph(sessionId)

Update src/components/graph/TaskGraph.jsx:

Remove static mockGraph prop.
Accept { nodes, edges } as props from the page:
  <ReactFlow nodes={graph?.nodes ?? []} edges={graph?.edges ?? []} />

Show EmptyState when graph has no nodes and not loading:
  if (!isLoading && !graph?.nodes?.length) return (
    <EmptyState icon={GitBranch} title="No tasks" subtitle="Tasks appear here as agents work." />
  )
```

---

# Sprint 6 — Search + Keys

**Goal:** SearchPage hits the real semantic search endpoint. KeysManager performs real CRUD.

**Done criteria:**
- [ ] Search query hits `GET /v1/search?q=` with optional `session_id`
- [ ] 503 from search returns a "search unavailable" message, not an error crash
- [ ] `POST /v1/keys` creates a key and shows the value (only time it's visible)
- [ ] `GET /v1/keys` lists active keys (key value never shown in list)
- [ ] `DELETE /v1/keys/:id` revokes key, removes from list

---

## Prompt 6.1 — REST hooks for search + keys

```
Create src/hooks/useKontexAPI.js:

  import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
  import { apiFetch } from "../api/client"

  // ── Search ────────────────────────────────────────────────────────────────────

  export function useSearch(q, sessionId = null) {
    const params = new URLSearchParams({ q })
    if (sessionId) params.set("session_id", sessionId)
    return useQuery({
      queryKey: ["search", q, sessionId],
      queryFn: () => apiFetch(`/v1/search?${params}`),
      enabled: !!q && q.trim().length > 0,
      retry: (count, err) => {
        // Do not retry 503 (search unavailable)
        if (err?.status === 503) return false
        return count < 1
      },
    })
  }

  // ── API Keys ──────────────────────────────────────────────────────────────────

  export function useKeys() {
    return useQuery({
      queryKey: ["keys"],
      queryFn: () => apiFetch("/v1/keys"),
    })
  }

  export function useCreateKey() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: ({ label }) => apiFetch("/v1/keys", { method: "POST", body: { label } }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
    })
  }

  export function useDeleteKey() {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (id) => apiFetch(`/v1/keys/${id}`, { method: "DELETE" }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
    })
  }

Search response shape:
  SearchResult[] or 503 { error: "search_unavailable", message: "..." }

Keys response shapes:
  GET  → [{ id, label, lastUsed, active, createdAt }]   — key value NEVER included
  POST → { id, key, label, createdAt }                   — key shown HERE ONLY
```

---

## Prompt 6.2 — Wire SearchPage

```
Update src/pages/SearchPage.jsx:

Remove:
  import { mockSearchResults } from "../data/mock"

Add:
  import { useSearch } from "../hooks/useKontexAPI"

  const [q, setQ] = useState("")
  const [sessionFilter, setSessionFilter] = useState(null)
  const { data: results, isLoading, isError, error } = useSearch(q, sessionFilter)

Handle 503 (search not configured) gracefully — do not throw:
  {isError && error?.status === 503 && (
    <p className="font-sans text-sm text-subtle px-6 py-4">
      Semantic search is not configured on this backend.
    </p>
  )}
  {isError && error?.status !== 503 && (
    <p className="font-sans text-sm text-red px-6 py-4">Search failed. Try again.</p>
  )}

Update src/components/search/SearchResults.jsx:
  Accept results as prop instead of importing mock.
  Show EmptyState when results is empty and q is non-empty and not loading.
```

---

## Prompt 6.3 — Wire KeysManager

```
Update src/components/keys/KeysManager.jsx:

Remove mock key state and setTimeout simulations.
Import real hooks:
  import { useKeys, useCreateKey, useDeleteKey } from "../../hooks/useKontexAPI"

  const { data: keys = [], isLoading } = useKeys()
  const { mutate: createKey, isPending: creating, data: newKey } = useCreateKey()
  const { mutate: deleteKey, isPending: deleting } = useDeleteKey()

Key creation:
  - Call createKey({ label: labelInput })
  - On success, response contains { id, key, label, createdAt }
  - Show the key value in a highlighted, copyable monospace box with a warning:
    "This key will not be shown again. Copy it now."
  - Dismiss the reveal box after user clicks "I've copied this key"

Key list:
  - Never show the key value in the list (API does not return it)
  - Show: label (or "Unnamed"), lastUsed (formatted), createdAt, revoke button

Key revocation:
  - Confirm before calling deleteKey(id)
  - Use amber color for the revoke button, red for the confirm state
  - On success, key disappears from list (React Query invalidation handles this)
```

---

# Sprint 7 — Timeline + Signals + Usage

**Goal:** Wire remaining pages: TimelinePage, SignalsPage, UsagePage. Signals computed client-side from timeline data.

**Done criteria:**
- [ ] TimelinePage shows real timeline from `trpc/dashboard.timeline`
- [ ] SignalsPage derives signals from timeline data via `src/utils/signals.js`
- [ ] UsagePage shows real stats from `trpc/dashboard.usage`
- [ ] No mock imports remain in any page component

---

## Prompt 7.1 — Signals utility

```
Create src/utils/signals.js:

  /**
   * Derive signal entries from a timeline snapshot list.
   * timeline: TimelineEntry[] from trpc/dashboard.timeline
   * Returns: Signal[]
   */
  export function computeSignals(timeline) {
    const signals = []
    const WINDOW_SIZE = 5

    for (let i = 1; i < timeline.length; i++) {
      const entry  = timeline[i]
      const prev   = timeline[i - 1]
      const tokenDelta = entry.tokenTotal - prev.tokenTotal

      // context_bloat: token delta > 5000 in one snapshot
      if (tokenDelta > 5_000) {
        signals.push({
          id: `bloat_${entry.id}`,
          type: "context_bloat",
          severity: "warning",
          snapshotId: entry.id,
          label: entry.label,
          createdAt: entry.createdAt,
          detail: `+${tokenDelta.toLocaleString()} tokens`,
        })
      }

      // context_limit_proximity: tokenTotal > 80,000
      if (entry.tokenTotal > 80_000) {
        signals.push({
          id: `limit_${entry.id}`,
          type: "context_limit_proximity",
          severity: "critical",
          snapshotId: entry.id,
          label: entry.label,
          createdAt: entry.createdAt,
          detail: `${entry.tokenTotal.toLocaleString()} tokens`,
        })
      }
    }

    // retry_storm: same tool called 3+ times in a window
    // NOTE: this requires toolCalls data from the bundle — if not available in timeline entries,
    // skip this signal type rather than crashing. It is optional.

    return signals
  }
```

---

## Prompt 7.2 — Wire TimelinePage + SignalsPage

```
Update src/pages/TimelinePage.jsx:

Remove mock imports.
Add:
  import { useTimeline } from "../hooks/useTrpc"
  import { useUiStore } from "../store/ui"

  // Read active session from Zustand or URL param
  const sessionId = useUiStore(s => s.activeSessionId) ?? new URLSearchParams(location.search).get("sessionId")
  const { data: timeline = [], isLoading } = useTimeline(sessionId)

  // Render timeline entries — same JSX as mock, now real data

Update src/pages/SignalsPage.jsx:

Remove mock imports.
Add:
  import { useTimeline } from "../hooks/useTrpc"
  import { computeSignals } from "../utils/signals"

  const { data: timeline = [] } = useTimeline(sessionId)
  const signals = computeSignals(timeline)

  // Render signals — same JSX as mock, now derived from real data
  // EmptyState when signals is empty:
  if (signals.length === 0) return (
    <EmptyState icon={CheckCircle} title="No signals" subtitle="No anomalies detected in this session." />
  )
```

---

## Prompt 7.3 — Wire UsagePage

```
Update src/pages/UsagePage.jsx:

Remove mock imports.
Add:
  import { useUsage } from "../hooks/useTrpc"

  const { data: usage, isLoading } = useUsage()

  // Usage fields:
  //   total_sessions, active_sessions
  //   total_snapshots, total_tokens_stored
  //   snapshots_this_month, tokens_this_month

Update src/components/usage/UsageStats.jsx:

Accept usage as prop instead of importing mock.
Show "—" for every metric while isLoading.
Existing rendering logic works with real data — field names match mock shapes.
```

---

# Sprint 8 — Error Handling + Deploy

**Goal:** Error boundaries on every data-fetching page. 401 interceptor restores gate. Docker image built and deployed.

**Done criteria:**
- [ ] 401 from any request clears key, triggers gate
- [ ] Every page has an inline error fallback — no crash screens
- [ ] `npm run build` completes without errors
- [ ] Docker image builds and serves at `localhost:8080`
- [ ] `GET /health` works from browser pointing at production backend
- [ ] Zero mock imports remain in any page or hook file

---

## Prompt 8.1 — Error boundaries + loading polish

```
Add inline error fallback to every page that fetches data.
Pattern — use this in each page:

  const { data, isLoading, isError } = useSomeHook(...)

  if (isLoading) return <PageSkeleton />   // 3 animated rows or a spinner
  if (isError)   return (
    <div className="px-6 py-4">
      <p className="font-sans text-sm text-red">Failed to load data. Check your connection.</p>
    </div>
  )

Pages to audit and update: Home, SessionDetailPage, TaskGraphPage, SearchPage,
  TimelinePage, SignalsPage, DiffPage, UsagePage.

KeysManager: show inline error below the create form on mutation failure.
RollbackDrawer: show inline error inside the drawer on mutation failure.

Verify 401 flow end-to-end:
  1. Store a valid key, load the dashboard
  2. Manually call localStorage.removeItem("kontex_api_key") then reload
  3. Gate should appear immediately
  4. Simulate 401: temporarily set the key to an invalid value, trigger any data fetch
  5. Gate should reappear automatically
```

---

## Prompt 8.2 — Final mock audit

```
Run a grep across all files in src/ for any remaining mock imports:
  grep -r "from.*data/mock" src/

For every result found:
  - If it is in a page or hook file: replace with the real hook
  - If it is in mock.js itself: leave it
  - If it is in a component that has not been wired yet: wire it now

After the audit, grep should return zero results outside of src/data/mock.js itself.

Also verify no component has a hardcoded array literal standing in for API data
(e.g. const sessions = [{id: "sess_01", ...}]) — replace any found with real hooks.
```

---

## Prompt 8.3 — Docker + nginx deploy

```
Create Dockerfile at kontex-dashboard/:

  # Stage 1 — build
  FROM node:20-alpine AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci
  COPY . .
  ARG VITE_KONTEX_API_URL=http://localhost:3000
  ENV VITE_KONTEX_API_URL=$VITE_KONTEX_API_URL
  RUN npm run build

  # Stage 2 — serve
  FROM nginx:alpine
  COPY --from=builder /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]

Create nginx.conf:

  server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
      try_files $uri $uri/ /index.html;
    }

    # Cache static assets aggressively
    location ~* \.(js|css|png|jpg|ico|woff2)$ {
      expires 1y;
      add_header Cache-Control "public, immutable";
    }
  }

Build and run locally:
  docker build --build-arg VITE_KONTEX_API_URL=http://localhost:3000 -t kontex-dashboard .
  docker run -p 8080:80 kontex-dashboard

Verify:
  - http://localhost:8080 → dashboard loads
  - http://localhost:8080/session/anything → page renders (SPA fallback works)
  - Network tab: /trpc requests fire, SSE connection opens on session detail
```

---

## Prompt 8.4 — Final verification checklist

```
Run a complete verification pass across all 8 sprints.

1. npm run build — zero TypeScript/lint errors
2. Docker build succeeds
3. ApiKeyGate appears with empty localStorage
4. Valid key entered → gate dismisses, dashboard renders
5. Home: session list populated from real API
6. Home: stat cards show real totals
7. Session detail: timeline loads real snapshots
8. Session detail: SSE connection visible in Network tab (EventStream)
9. Session detail: selecting timeline entry populates ContextInspector
10. Rollback: confirm → new entry appended to timeline, original still present
11. Diff: from/to dropdowns → real diff shown
12. Task graph: real nodes and edges rendered in ReactFlow
13. Search: query returns real results (or "search unavailable" message if Qdrant off)
14. Keys: create → key shown once; list → no key values; revoke → key gone
15. Usage: real totals from API
16. Timeline: real snapshot entries
17. Signals: derived from real timeline (empty state if no anomalies)
18. No mock imports outside src/data/mock.js
19. 401 → gate reappears
20. 503 on search → graceful message, no crash

Fix every failure before declaring done.
```

---

*Kontex Dashboard 2.0 Integration Build Guide · tRPC + SSE + REST · 8 sprints*
