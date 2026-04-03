# CLAUDE.md — Kontex API Backend 2.0

Read this file completely before writing any code. Sprint prompts are in `kontex-dashboard-2.0-buildguide.md` — execute them from there.

---

## What Kontex Is

Kontex is a **task-state persistence engine for agentic workflows** — a state machine with audit trail.

**Two jobs:**
1. **Capture** — intercept agent context via OpenLLMetry SDK (primary), HTTP proxy fallback (secondary), or explicit MCP checkpoints (advanced)
2. **Restore** — serve snapshot data to agents for rollback, to the dashboard for inspection, to developers for semantic search

**Invariant:** Snapshots are immutable once finalized. Rollback creates a new snapshot — never deletes or mutates history.

---

## What Is Already Built (Sprints 1–8)

Do not re-implement anything in this list.

- Auth middleware, API key CRUD, rate limiting
- Sessions and tasks (full CRUD, tree structure, ownership checks)
- ContextBundle type and R2 bundle storage (read/write/merge)
- Snapshot engine (create, read, enrich, rollback)
- HTTP Proxy — Anthropic-compatible passthrough with async snapshot capture
- MCP server with 6 write tools (session_start, session_pause, task_start, task_done, snapshot, rollback)
- Dashboard REST API (graph, diff, timeline, usage, search)
- Embed worker — Qdrant indexing via Voyage AI voyage-code-3
- Rate limiting via Redis, Railway deploy, all four docs

---

## Capture Path Hierarchy (v2)

```
PRIMARY    OpenLLMetry SDK     any language, any framework, any LLM provider
FALLBACK   HTTP Proxy          zero-code option, Anthropic-compatible APIs only
ADVANCED   MCP Tools           explicit named checkpoints + read path for agents
```

The log watcher (`watcher/` directory) is retired. Do not modify or run it.

---

## Architecture

```
Capture paths
──────────────────────────────────────────────────────────────
OpenLLMetry SDK   →  POST /ingest/v1/traces   ← PRIMARY
HTTP Proxy        →  POST /proxy/v1/messages  ← FALLBACK (existing)
MCP write tools   →  POST /mcp               ← ADVANCED (existing)
                            ↓
                     span.processor.ts
                     (OTLP → ContextBundle)
                            ↓
                PostgreSQL + R2 + Qdrant + Redis

Serve paths
──────────────────────────────────────────────────────────────
REST  /v1/*       Third-party tools, CLIs, external contracts
tRPC  /trpc/*     Dashboard frontend only — type-safe
SSE   /sse/*      Dashboard live feed only — real-time push
MCP   /mcp        Agent write tools + read tools
```

- **Ingest flow:** OpenLLMetry SDK → `POST /ingest/v1/traces` → `OtelSpan` stored → Redis queue → span-worker async → ContextBundle → R2 + Snapshot → Qdrant embed
- **SSE flow:** span-worker calls `publishEvent()` → Redis pub/sub `session:{id}:events` → SSE client stream
- **tRPC flow:** Bearer token → `createContext()` → Prisma queries → typed response. REST `/v1/*` unchanged and coexists.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Hono + @hono/node-server |
| ORM | Prisma |
| Database | PostgreSQL (Railway) |
| Object storage | Cloudflare R2 (S3-compatible) |
| Cache / Queue | Redis (Railway) |
| Vector store | Qdrant Cloud |
| Embeddings | Voyage AI voyage-code-3 |
| Validation | Zod (every request body, at route level) |
| Token counting | tiktoken |
| RPC (dashboard) | tRPC v11 + @hono/trpc-server |
| Real-time (dashboard) | Server-Sent Events over Redis pub/sub |
| Language | TypeScript strict |

---

## Project Structure

Fixed. Do not create files outside this structure without explicit instruction.

```
kontex-api/
├── prisma/schema.prisma
├── src/
│   ├── index.ts
│   ├── config.ts
│   ├── db.ts
│   ├── redis.ts
│   ├── r2.ts
│   ├── lib/
│   │   └── events.ts             ← Redis pub/sub publish helpers
│   ├── receivers/
│   │   ├── otlp.parser.ts        ← OTLP/HTTP JSON → FlatSpan[]
│   │   ├── span.mapper.ts        ← OpenLLMetry attributes → ContextBundle fields
│   │   └── span.processor.ts     ← FlatSpan → Snapshot + R2 bundle
│   ├── routes/
│   │   ├── sessions.ts           ← includes /link-trace endpoint
│   │   ├── tasks.ts
│   │   ├── snapshots.ts
│   │   ├── proxy.ts              ← FALLBACK write path
│   │   ├── enrich.ts
│   │   ├── ingest.ts             ← PRIMARY write path: POST /ingest/v1/traces
│   │   ├── sse.ts                ← GET /sse/session/:id/feed
│   │   ├── mcp.ts
│   │   └── dashboard.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── logger.ts
│   ├── services/
│   │   ├── snapshot.service.ts
│   │   ├── bundle.service.ts
│   │   ├── proxy.service.ts
│   │   ├── enrich.service.ts
│   │   ├── diff.service.ts
│   │   └── embed.service.ts
│   ├── trpc/
│   │   ├── context.ts            ← tRPC context builder (userId, db, redis)
│   │   ├── router.ts             ← root AppRouter — export type AppRouter
│   │   ├── trpc.ts               ← initTRPC, authedProcedure
│   │   ├── types.ts              ← shared type re-exports for frontend
│   │   └── routers/
│   │       ├── sessions.ts
│   │       ├── snapshots.ts
│   │       └── dashboard.ts
│   ├── workers/
│   │   ├── embed.worker.ts       ← Qdrant embedding (existing)
│   │   └── span.worker.ts        ← OpenLLMetry span processing
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── session.tools.ts
│   │       ├── snapshot.tools.ts
│   │       ├── rollback.tools.ts
│   │       └── context.tools.ts  ← read tools: search, get_context, list_snapshots
│   └── types/
│       ├── api.ts
│       ├── bundle.ts
│       └── otel.ts               ← OTLP wire format types + extractAttributes + nanoToDate
├── watcher/                       ← RETIRED — do not modify or run
├── tests/
│   ├── sessions.test.ts
│   ├── snapshots.test.ts
│   ├── proxy.test.ts
│   ├── enrich.test.ts
│   ├── ingest.test.ts
│   ├── trpc.test.ts
│   └── sse.test.ts
├── docs/
│   ├── openllmetry-quickstart.md
│   ├── quickstart.md
│   ├── mcp-advanced.md
│   └── data-model.md
├── .env / .env.example
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## Data Model

See `prisma/schema.prisma` for the full schema — do not modify without explicit instruction.

```
User → ApiKey[]
     → Session[]   (externalTraceId links to OpenLLMetry traceId)
          └── Task[]  (tree via parentTaskId)
                └── Snapshot[]
                      └── ContextBundle → R2 blob at bundles/{snapshotId}.json

OtelSpan → Snapshot?  (raw span, processed async by span-worker)
```

**Snapshot.source:** `"proxy"` | `"log_watcher"` (retired) | `"mcp"` | `"openllmetry"`

**OtelSpan.status:** `PENDING` → `PROCESSED` | `FAILED` (retryable)

**Only `traceloop.span.kind === "llm"` spans create Snapshot records.** All other span kinds are stored as OtelSpan only.

---

## Environment Variables

All validated in `config.ts` at startup. Missing required vars throw immediately.

```bash
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/kontex
REDIS_URL=redis://localhost:6379
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=kontex-bundles
R2_ENDPOINT=https://{account_id}.r2.cloudflarestorage.com
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=kontex_snapshots
VOYAGE_API_KEY=
ANTHROPIC_API_URL=https://api.anthropic.com
API_KEY_SECRET=change_me_in_production
ENRICH_WINDOW_SECONDS=60
```

---

## Coding Standards

**TypeScript:** Strict mode. No `any`. No `ts-ignore`. All functions have explicit return types.

**Zod:** Validates every request body at route level. tRPC input schemas also use Zod.

**Services:** Pure functions over DB + external clients. No Hono context. Receive `userId` explicitly. Services do not call other services — routes/procedures orchestrate.

**Ownership:** Validate resource belongs to authenticated user. Return `404` (not `403`) when not found or wrong user — do not reveal existence. Applies in tRPC and MCP tools equally.

**R2:** Key format `bundles/{snapshotId}.json`. R2 errors → `502 upstream_error`. Never crash on R2 failure.

**Ingest:** Span storage is awaited. Span processing is always async (Redis queue). `POST /ingest/v1/traces` returns 200 before any Snapshot is created.

**SSE:** Each subscriber gets its own dedicated Redis connection — never use the shared singleton for subscribe mode. Unsubscribe and disconnect on client close.

**tRPC vs REST:** tRPC for dashboard frontend only. REST `/v1/*` is the external contract. Never migrate REST to tRPC. They coexist.

**Immutability:** Snapshots are immutable once created. `enriched: true` is one-way. Rollback creates — never overwrites.

**MCP tools:** Return plain strings only. Never structured errors or stack traces.

**Events:** `publishEvent()` is always fire-and-forget — never throws, never awaits, never blocks.

**REST error shape:**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

**HTTP status codes:**
```
400 validation_error    401 unauthorized       403 forbidden
404 not_found           409 conflict           415 unsupported_media_type
429 rate_limit_exceeded 500 internal_error     502 upstream_error
```

**Never log API key values. Never expose stack traces in responses.**

---

## Auth Patterns

| Endpoint group | Auth header | How |
|---|---|---|
| `GET/POST /v1/*` | `Authorization: Bearer {key}` | Standard `auth` middleware |
| `POST /ingest/v1/traces` | `X-Kontex-Api-Key: {key}` | Inline in ingest route |
| `POST /proxy/v1/messages` | `X-Kontex-Api-Key: {key}` | Inline in proxy route |
| `POST /trpc/*` | `Authorization: Bearer {key}` | `createContext()` in tRPC adapter |
| `GET /sse/session/:id/feed` | `Authorization: Bearer {key}` | Inline in SSE route |
| `POST /mcp` | Bearer or `X-Kontex-Api-Key` | MCP server handler |

---

## Package Scripts

```json
"dev":         "dotenv-cli -e .env -- tsx watch src/index.ts",
"worker":      "dotenv-cli -e .env -- tsx watch src/workers/embed.worker.ts",
"span-worker": "dotenv-cli -e .env -- tsx watch src/workers/span.worker.ts",
"build":       "tsc",
"start":       "node dist/index.js",
"migrate":     "prisma migrate deploy",
"test":        "vitest run"
```

Full local dev — run all three simultaneously: `npm run dev` + `npm run worker` + `npm run span-worker`

---

## Railway Services

```toml
[[services]]
name = "kontex-api"
startCommand = "node dist/index.js"
healthcheckPath = "/health"

[[services]]
name = "kontex-embed-worker"
startCommand = "node dist/workers/embed.worker.js"

[[services]]
name = "kontex-span-worker"
startCommand = "node dist/workers/span.worker.js"
```

---

## Sprint Map

| Sprint | Status | Focus |
|---|---|---|
| 1–8 | ✅ Complete | Foundation, snapshots, proxy, log watcher, rollback, MCP, dashboard, deploy |
| **9** | ✅ Complete | **OpenLLMetry OTLP ingest — primary capture path** |
| **10** | ✅ Complete | **tRPC + SSE — dashboard API + real-time feed** |
| **11** | ✅ Complete | **MCP read tools — agents query their own context** |
| **Dashboard 1** | 🔨 In Progress | **tRPC client, QueryClient, ApiKeyGate, REST base fetcher** |

Complete all done criteria for a sprint before starting the next.

---

## Full API Surface

```
POST/GET/DELETE /v1/keys
POST/GET/PATCH/DELETE /v1/sessions          POST /v1/sessions/:id/link-trace
POST/GET /v1/sessions/:id/tasks             GET/PATCH /v1/tasks/:id
POST /v1/tasks/:id/snapshots
GET /v1/sessions/:id/snapshots              GET/POST /v1/snapshots/:id
GET /v1/snapshots/:id/bundle                POST /v1/snapshots/:id/rollback
POST /v1/snapshots/:id/enrich
GET /v1/sessions/:id/graph                  GET /v1/sessions/:id/diff?from=&to=
GET /v1/sessions/:id/snapshots/timeline     GET /v1/usage
GET /v1/search?q=

POST /ingest/v1/traces      ← PRIMARY (OTLP, X-Kontex-Api-Key)
POST /proxy/v1/messages     ← FALLBACK (Anthropic-compatible)
POST /mcp                   ← 6 write tools + 3 read tools
GET  /sse/session/:id/feed  ← text/event-stream

POST /trpc/sessions.{list,byId,create,update,tasks}
POST /trpc/snapshots.{listBySession,byId,bundle,rollback}
POST /trpc/dashboard.{graph,diff,timeline,usage}

GET /health
```

---

## How to Use

```bash
cd kontex-api
# Open kontex-dashboard-2.0-buildguide.md
# Navigate to the current sprint and execute prompts in order

# When resuming: "Read CLAUDE.md. We are on Dashboard Sprint 1. Continue from where we left off."
```
