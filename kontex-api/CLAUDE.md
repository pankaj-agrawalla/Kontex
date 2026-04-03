# CLAUDE.md — Kontex API Backend 2.0

Read this file completely before writing any code. This file provides stable context for every sprint. The Claude Code prompts are in `kontex-backend-2.0-buildguide.md` — execute them from there, sprint by sprint.

---

## What Kontex Is

Kontex is a **task-state persistence engine for agentic workflows**.

It is not a memory store. It is not a chat logger. It is a state machine with audit trail.

**Two jobs:**
1. **Capture** — intercept agent context via OpenLLMetry SDK (primary), HTTP proxy fallback (secondary), or explicit MCP checkpoints (advanced)
2. **Restore** — serve snapshot data to agents for rollback, to the dashboard for inspection, to developers for semantic search

**The one invariant that must never be violated:**
Snapshots are immutable once finalized. Rollback creates a new snapshot — it never deletes or mutates history. The timeline always grows forward.

---

## What Is Already Built (Sprints 1–8)

Do not re-implement anything in this list. These are complete and working.

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
                               npm install @traceloop/node-server-sdk
                               pip install traceloop-sdk
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

**OpenLLMetry ingest flow:** Developer initialises `@traceloop/node-server-sdk` or `traceloop-sdk` with `baseUrl` pointing to Kontex + `X-Kontex-Api-Key` + `X-Kontex-Session-Id` headers → OpenLLMetry auto-instruments every LLM call → sends OTLP/HTTP JSON spans to `POST /ingest/v1/traces` → Kontex upserts raw `OtelSpan` records → queues IDs to Redis → span-worker processes async → ContextBundle written to R2 → Snapshot record created in Postgres → queued for Qdrant embedding.

**SSE flow:** Span-worker calls `publishEvent()` after creating each Snapshot → Redis pub/sub channel `session:{id}:events` → SSE route subscriber receives and writes `event: snapshot.created` to the client stream.

**tRPC flow:** Dashboard frontend sends requests to `POST /trpc/*` → Hono adapter resolves context (userId from Bearer token) → tRPC procedure executes same Prisma queries as REST routes → returns typed response. REST `/v1/*` is unchanged and coexists.

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

## Full Project Structure

Fixed. Do not create files outside this structure without explicit instruction.

```
kontex-api/
├── prisma/
│   └── schema.prisma
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
│   ├── openllmetry-quickstart.md ← primary onboarding document
│   ├── quickstart.md             ← proxy fallback (kept, redirects to openllmetry-quickstart.md)
│   ├── mcp-advanced.md           ← includes read tools section
│   └── data-model.md
├── .env / .env.example
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## Data Model

```
User → ApiKey[]
     → Session[]   (externalTraceId links to OpenLLMetry traceId)
          └── Task[]  (tree via parentTaskId)
                └── Snapshot[]
                      └── ContextBundle → R2 blob at bundles/{snapshotId}.json

OtelSpan → Snapshot?  (raw OpenLLMetry span, processed async by span-worker)

Snapshot.source values:
  "proxy"        captured via HTTP proxy (existing)
  "log_watcher"  captured via log watcher (retired, kept for backward compat)
  "mcp"          captured via explicit MCP checkpoint (existing)
  "openllmetry"  captured via OTLP ingest (new in v2)

OtelSpan.status:
  PENDING    stored, not yet processed by span-worker
  PROCESSED  span-worker completed (may or may not have created a Snapshot)
  FAILED     span-worker encountered an error — retryable
```

---

## Full Prisma Schema

Do not modify without explicit instruction.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String    @id @default(cuid())
  email     String    @unique
  createdAt DateTime  @default(now())
  apiKeys   ApiKey[]
  sessions  Session[]
}

model ApiKey {
  id        String    @id @default(cuid())
  key       String    @unique
  label     String?
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  createdAt DateTime  @default(now())
  lastUsed  DateTime?
  active    Boolean   @default(true)
}

model Session {
  id              String        @id @default(cuid())
  userId          String
  user            User          @relation(fields: [userId], references: [id])
  name            String
  description     String?
  status          SessionStatus @default(ACTIVE)
  externalTraceId String?       @unique
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  tasks           Task[]
}

enum SessionStatus { ACTIVE PAUSED COMPLETED }

model Task {
  id           String     @id @default(cuid())
  sessionId    String
  session      Session    @relation(fields: [sessionId], references: [id])
  parentTaskId String?
  parentTask   Task?      @relation("TaskTree", fields: [parentTaskId], references: [id])
  childTasks   Task[]     @relation("TaskTree")
  name         String
  status       TaskStatus @default(PENDING)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  snapshots    Snapshot[]
}

enum TaskStatus { PENDING ACTIVE COMPLETED FAILED }

model Snapshot {
  id         String    @id @default(cuid())
  taskId     String
  task       Task      @relation(fields: [taskId], references: [id])
  label      String
  tokenTotal Int
  model      String?
  source     String    @default("proxy")
  r2Key      String    @unique
  enriched   Boolean   @default(false)
  enrichedAt DateTime?
  embedded   Boolean   @default(false)
  createdAt  DateTime  @default(now())
}

model OtelSpan {
  id            String         @id @default(cuid())
  traceId       String
  spanId        String         @unique
  parentSpanId  String?
  serviceName   String
  operationName String
  spanKind      String         @default("unknown")
  startTime     DateTime
  endTime       DateTime
  durationMs    Int
  attributes    Json
  snapshotId    String?
  status        OtelSpanStatus @default(PENDING)
  createdAt     DateTime       @default(now())
}

enum OtelSpanStatus { PENDING PROCESSED FAILED }
```

---

## Environment Variables

All validated in `config.ts` at startup. Missing required vars throw immediately with the var name.

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

Apply in every file, every sprint.

**TypeScript:** Strict mode. No `any`. No `ts-ignore`. All functions have explicit return types.

**Zod:** Validates every request body at route level before reaching service layer. tRPC input schemas also use Zod.

**Services:** Pure functions over DB + external clients. No Hono context. Receive `userId` explicitly. Services do not call other services — routes and tRPC procedures orchestrate.

**Ownership:** Always validate a resource belongs to the authenticated user. Return `404` (not `403`) when a resource is not found or belongs to another user — do not reveal existence. This applies equally in tRPC procedures and MCP tools.

**R2:** Key format `bundles/{snapshotId}.json`. R2 errors → `502 upstream_error`. Never crash on R2 failure.

**Ingest endpoint:** Span storage is awaited (data safe before responding). Span processing is always async — pushed to Redis queue, never awaited in the request cycle. `POST /ingest/v1/traces` must return 200 before any Snapshot is created.

**SSE connections:** Each SSE subscriber gets its own dedicated Redis connection. Never use the shared `redis` singleton for `subscribe` mode. Unsubscribe and disconnect on client close.

**tRPC vs REST:** tRPC is for the dashboard frontend only. REST `/v1/*` is the external contract for third-party tools and CLIs. Never migrate existing REST routes to tRPC. They coexist — neither replaces the other.

**Immutability:** Snapshots are immutable once created. `enriched: true` is a one-way transition. Rollback creates a new snapshot — never overwrites or deletes existing ones.

**MCP tools:** All tools return plain strings, never structured errors, never stack traces. Error messages must be descriptive enough for an agent to self-correct.

**Events:** `publishEvent()` is always fire-and-forget — it never throws, never awaits, never blocks. A failed Redis publish must not affect the caller.

**Errors — REST shape always:**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

**Standard REST error codes:**
```
unauthorized          401
forbidden             403
not_found             404
validation_error      400
conflict              409
enrich_window_expired 409
rate_limit_exceeded   429
unsupported_media_type 415
upstream_error        502
internal_error        500
```

**Never log API key values. Never expose stack traces in any response.**

---

## OpenLLMetry Attribute Keys

The span.mapper reads exactly these attributes. All other attributes are ignored.

```
traceloop.span.kind          "llm" | "workflow" | "task" | "agent" | "tool"
traceloop.workflow.name      from @workflow / withWorkflow()
traceloop.task.name          from @task / withTask()
traceloop.agent.name         from @agent / withAgent()
traceloop.tool.name          from @tool / withTool()
traceloop.entity.name        generic entity name fallback
traceloop.entity.input       tool input (JSON string)
traceloop.entity.output      tool output (JSON string)

llm.request.model            model requested
llm.response.model           model actually used (prefer this over request.model)
llm.usage.prompt_tokens      input token count
llm.usage.completion_tokens  output token count
llm.usage.total_tokens       total (use this; fall back to sum of above)
llm.prompts                  JSON string of messages array (format A)
llm.prompts.{n}.role         indexed format (format B — some SDK versions)
llm.prompts.{n}.content      indexed format (format B)
llm.completions              JSON string of completions (format A)
llm.completions.{n}.content  indexed format (format B)
llm.tool.input               tool input (alternative key)
llm.tool.output              tool output (alternative key)
```

**Only `traceloop.span.kind === "llm"` spans create Snapshot records.**
All other span kinds (workflow, task, agent, tool) are stored as OtelSpan records only.

---

## Auth Patterns by Endpoint Group

Three distinct auth patterns. Apply the correct one per route — never mix them.

| Endpoint group | Auth header | Middleware |
|---|---|---|
| `GET /v1/*`, `POST /v1/*` etc. | `Authorization: Bearer {key}` | Standard `auth` middleware |
| `POST /ingest/v1/traces` | `X-Kontex-Api-Key: {key}` | Inline in ingest route |
| `POST /proxy/v1/messages` | `X-Kontex-Api-Key: {key}` | Inline in proxy route |
| `POST /trpc/*` | `Authorization: Bearer {key}` | `createContext()` in tRPC adapter |
| `GET /sse/session/:id/feed` | `Authorization: Bearer {key}` | Inline in SSE route |
| `POST /mcp` | `Authorization: Bearer {key}` or `X-Kontex-Api-Key: {key}` | MCP server handler |

---

## Package Scripts

```json
{
  "scripts": {
    "dev":         "dotenv-cli -e .env -- tsx watch src/index.ts",
    "worker":      "dotenv-cli -e .env -- tsx watch src/workers/embed.worker.ts",
    "span-worker": "dotenv-cli -e .env -- tsx watch src/workers/span.worker.ts",
    "build":       "tsc",
    "start":       "node dist/index.js",
    "migrate":     "prisma migrate deploy",
    "studio":      "prisma studio",
    "test":        "vitest run"
  }
}
```

For full local development, run all three processes simultaneously:
```bash
# Terminal 1
npm run dev

# Terminal 2
npm run worker

# Terminal 3
npm run span-worker
```

---

## Railway Services

Three services. All must be healthy before the backend is considered deployed.

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
| 1 | ✅ Complete | Foundation — Hono, Prisma, auth, sessions, tasks |
| 2 | ✅ Complete | Snapshot engine — ContextBundle, R2, CRUD |
| 3 | ✅ Complete | HTTP Proxy — Anthropic passthrough, auto-snapshot |
| 4 | ✅ Complete | Log Watcher — retired in v2, code kept but not run |
| 5 | ✅ Complete | Rollback — forward-only history |
| 6 | ✅ Complete | MCP Server — 6 write tools |
| 7 | ✅ Complete | Dashboard REST API — graph, diff, timeline, usage, search |
| 8 | ✅ Complete | Polish + Deploy — rate limiting, key management, Railway |
| **9** | **Build** | **OpenLLMetry OTLP ingest — primary capture path** |
| **10** | **Build** | **tRPC + SSE — dashboard API + real-time feed** |
| **11** | **Build** | **MCP read tools — agents query their own context** |

Complete all done criteria for a sprint before starting the next.
Sprint 11 may be executed independently of Sprint 10.

---

## Full API Surface

```
# Auth
POST   /v1/keys
GET    /v1/keys
DELETE /v1/keys/:id

# Sessions
POST   /v1/sessions
GET    /v1/sessions
GET    /v1/sessions/:id
PATCH  /v1/sessions/:id
DELETE /v1/sessions/:id
POST   /v1/sessions/:id/link-trace        ← links OTel traceId to session

# Tasks
POST   /v1/sessions/:id/tasks
GET    /v1/sessions/:id/tasks
GET    /v1/tasks/:id
PATCH  /v1/tasks/:id

# Snapshots
POST   /v1/tasks/:id/snapshots
GET    /v1/sessions/:id/snapshots
GET    /v1/snapshots/:id
GET    /v1/snapshots/:id/bundle
POST   /v1/snapshots/:id/rollback
POST   /v1/snapshots/:id/enrich

# Dashboard REST (external / CLI)
GET    /v1/sessions/:id/graph
GET    /v1/sessions/:id/diff?from=&to=
GET    /v1/sessions/:id/snapshots/timeline
GET    /v1/usage
GET    /v1/search?q=

# OpenLLMetry Ingest — PRIMARY write path
POST   /ingest/v1/traces                  ← OTLP/HTTP JSON, auth: X-Kontex-Api-Key

# HTTP Proxy — FALLBACK write path
POST   /proxy/v1/messages                 ← Anthropic-compatible only

# tRPC — Dashboard frontend only
POST   /trpc/sessions.list
POST   /trpc/sessions.byId
POST   /trpc/sessions.create
POST   /trpc/sessions.update
POST   /trpc/sessions.tasks
POST   /trpc/snapshots.listBySession
POST   /trpc/snapshots.byId
POST   /trpc/snapshots.bundle
POST   /trpc/snapshots.rollback
POST   /trpc/dashboard.graph
POST   /trpc/dashboard.diff
POST   /trpc/dashboard.timeline
POST   /trpc/dashboard.usage

# SSE — Dashboard live feed only
GET    /sse/session/:id/feed              ← text/event-stream

# MCP — Agent write + read tools
POST   /mcp
  Write tools (6): kontex_session_start, kontex_session_pause,
                   kontex_task_start, kontex_task_done,
                   kontex_snapshot, kontex_rollback
  Read tools (3):  kontex_search, kontex_get_context, kontex_list_snapshots

# System
GET    /health
```

---

## How to Use This File

```bash
cd kontex-api
# CLAUDE.md is here — Claude Code reads it automatically

# Open kontex-backend-2.0-buildguide.md
# Navigate to the current sprint (9, 10, or 11)
# Execute prompts in order within each sprint
# e.g. "Execute Prompt 9.1"

# Verify done criteria before moving to the next prompt
# Verify all done criteria before moving to the next sprint
```

When resuming a session, tell Claude Code which sprint and prompt number to continue from. Example:
```
Read CLAUDE.md. We are on Sprint 9, Prompt 9.4. Prompts 9.1–9.3 are complete. Continue from 9.4.
```

---

# SPRINT 9 — OpenLLMetry OTLP Ingest

**Prerequisite:** Sprints 1–8 complete.

**What this adds:** A single OTLP/HTTP endpoint that accepts spans from the OpenLLMetry SDK. OpenLLMetry auto-instruments Anthropic, OpenAI, LangChain, LlamaIndex, CrewAI, Bedrock, Gemini, and 15+ other providers. Developers point the SDK at Kontex and every LLM call becomes a snapshot automatically — no framework-specific code on Kontex's side.

**How OpenLLMetry connects to Kontex:**

Node.js:
```typescript
import * as traceloop from "@traceloop/node-server-sdk"
// Import BEFORE any LLM library
traceloop.initialize({
  baseUrl: "https://api.usekontex.com",
  headers: {
    "X-Kontex-Api-Key":    process.env.KONTEX_API_KEY,
    "X-Kontex-Session-Id": process.env.KONTEX_SESSION_ID,
  },
  disableBatch: process.env.NODE_ENV === "development",
})
```

Python:
```python
from traceloop.sdk import Traceloop
# Call BEFORE importing any LLM library
Traceloop.init(
    app_name="my-agent",
    base_url="https://api.usekontex.com",
    headers={
        "X-Kontex-Api-Key":    os.environ["KONTEX_API_KEY"],
        "X-Kontex-Session-Id": os.environ["KONTEX_SESSION_ID"],
    },
)
```

**Key OpenLLMetry attribute schema** (what the span.mapper reads):

```
traceloop.span.kind        "llm" | "workflow" | "task" | "agent" | "tool"
traceloop.workflow.name    from @workflow decorator
traceloop.task.name        from @task decorator
traceloop.agent.name       from @agent decorator
traceloop.tool.name        from @tool decorator
traceloop.entity.input     tool input (JSON string)
traceloop.entity.output    tool output (JSON string)

llm.request.model          "claude-opus-4-6", "gpt-4o", etc.
llm.response.model         actual model used
llm.usage.prompt_tokens    input token count
llm.usage.completion_tokens output token count
llm.usage.total_tokens     total
llm.prompts                JSON string of messages array — OR indexed:
llm.prompts.0.role         indexed format (varies by SDK version)
llm.prompts.0.content
llm.completions            JSON string of completions — OR indexed:
llm.completions.0.content
```

Only `traceloop.span.kind === "llm"` spans create Snapshot records.
Workflow/task/agent/tool spans are stored as `OtelSpan` records for graph construction but do not become snapshots.

**Done criteria:**
- [ ] `POST /ingest/v1/traces` accepts OTLP/HTTP JSON, returns `200 { received: N }`
- [ ] Auth via `X-Kontex-Api-Key` header — missing/invalid → 401
- [ ] Raw `OtelSpan` upserted to Postgres before 200 returns (data safe)
- [ ] Duplicate `spanId` is idempotent — upsert, not error
- [ ] Span processing async via Redis queue — 200 returns before any Snapshot is created
- [ ] `llm` spans → Snapshot + R2 bundle with correct messages, tokens, model
- [ ] Non-`llm` spans → `OtelSpan` record only, no Snapshot
- [ ] `X-Kontex-Session-Id` header auto-links `traceId` to session on first span
- [ ] Unlinked spans stored as `OtelSpan`, warning logged, no Snapshot created
- [ ] `Snapshot.source === "openllmetry"`
- [ ] `npm test` passes including new `ingest.test.ts`

---

## Prompt 9.1 — Prisma migration

```
Make two changes to prisma/schema.prisma:

─── 1. Add OtelSpan model ───────────────────────────────────────────────────

model OtelSpan {
  id            String         @id @default(cuid())
  traceId       String
  spanId        String         @unique
  parentSpanId  String?
  serviceName   String
  operationName String
  spanKind      String         @default("unknown")
  startTime     DateTime
  endTime       DateTime
  durationMs    Int
  attributes    Json
  snapshotId    String?
  status        OtelSpanStatus @default(PENDING)
  createdAt     DateTime       @default(now())
}

enum OtelSpanStatus { PENDING PROCESSED FAILED }

─── 2. Add externalTraceId to Session ───────────────────────────────────────

In the Session model, add:
  externalTraceId String? @unique

─── 3. Run ──────────────────────────────────────────────────────────────────

npx prisma migrate dev --name openllmetry_ingest
npx prisma generate

─── 4. Update src/types/api.ts ──────────────────────────────────────────────

Change SnapshotSource to:
  export type SnapshotSource = "proxy" | "log_watcher" | "mcp" | "openllmetry"

─── Verify ──────────────────────────────────────────────────────────────────

npx prisma studio
Confirm: OtelSpan table present, Session.externalTraceId column present.
```

---

## Prompt 9.2 — OTLP type definitions

```
Create src/types/otel.ts

These types represent the OTLP/HTTP JSON wire format. Do not invent —
these are the exact structures the OpenLLMetry SDK sends.

─────────────────────────────────────────────────────────────────────────────

export interface OtlpAttributeValue {
  stringValue?: string
  intValue?: string        // int64 encoded as string in OTLP spec
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values: OtlpAttributeValue[] }
}

export interface OtlpAttribute {
  key: string
  value: OtlpAttributeValue
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OtlpAttribute[]
  events?: Array<{
    timeUnixNano: string
    name: string
    attributes?: OtlpAttribute[]
  }>
  status?: { code: number; message?: string }
}

export interface OtlpTracesPayload {
  resourceSpans: Array<{
    resource?: { attributes?: OtlpAttribute[] }
    scopeSpans: Array<{
      scope?: { name?: string; version?: string }
      spans: OtlpSpan[]
    }>
  }>
}

// Flattened span after parsing — what span.mapper and span.processor receive.
export interface FlatSpan {
  traceId: string
  spanId: string
  parentSpanId: string | undefined
  operationName: string
  serviceName: string
  spanKind: string
  startTime: Date
  endTime: Date
  durationMs: number
  attributes: Record<string, string | number | boolean>
}

─────────────────────────────────────────────────────────────────────────────

// Flatten OtlpAttribute[] to a plain key-value Record.
// Handles string, int (parsed), double, bool. Skips arrayValue.
export function extractAttributes(
  attrs: OtlpAttribute[] | undefined
): Record<string, string | number | boolean> {
  if (!attrs) return {}
  const result: Record<string, string | number | boolean> = {}
  for (const attr of attrs) {
    const v = attr.value
    if (v.stringValue !== undefined)      result[attr.key] = v.stringValue
    else if (v.intValue !== undefined)    result[attr.key] = parseInt(v.intValue, 10)
    else if (v.doubleValue !== undefined) result[attr.key] = v.doubleValue
    else if (v.boolValue !== undefined)   result[attr.key] = v.boolValue
  }
  return result
}

// Convert nanosecond timestamp string to Date.
// Uses BigInt — nanosecond values overflow Number precision.
export function nanoToDate(nanoStr: string): Date {
  return new Date(Number(BigInt(nanoStr) / 1_000_000n))
}
```

---

## Prompt 9.3 — OTLP payload parser

```
Create src/receivers/otlp.parser.ts

Parses the raw HTTP body into FlatSpan[].
This is the only file that knows the OTLP wire format.
Never throws — malformed individual spans are skipped with a warning.

─────────────────────────────────────────────────────────────────────────────

import { OtlpTracesPayload, FlatSpan, extractAttributes, nanoToDate } from "../types/otel"

export function parseOtlpPayload(body: unknown): FlatSpan[] {
  if (!body || typeof body !== "object") return []
  const payload = body as OtlpTracesPayload
  if (!Array.isArray(payload.resourceSpans)) return []

  const spans: FlatSpan[] = []

  for (const resourceSpan of payload.resourceSpans) {
    const resourceAttrs = extractAttributes(resourceSpan.resource?.attributes)
    const serviceName = String(resourceAttrs["service.name"] ?? "unknown-service")

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const rawSpan of scopeSpan.spans ?? []) {
        try {
          const attrs     = extractAttributes(rawSpan.attributes)
          const startTime = nanoToDate(rawSpan.startTimeUnixNano)
          const endTime   = nanoToDate(rawSpan.endTimeUnixNano)
          spans.push({
            traceId:       rawSpan.traceId,
            spanId:        rawSpan.spanId,
            parentSpanId:  rawSpan.parentSpanId || undefined,
            operationName: rawSpan.name,
            serviceName,
            spanKind:      String(attrs["traceloop.span.kind"] ?? "unknown"),
            startTime,
            endTime,
            durationMs:    endTime.getTime() - startTime.getTime(),
            attributes:    attrs,
          })
        } catch (err) {
          console.warn("[otlp-parser] Skipping malformed span:", (err as Error).message)
        }
      }
    }
  }

  return spans
}
```

---

## Prompt 9.4 — Span mapper

```
Create src/receivers/span.mapper.ts

Maps OpenLLMetry span attributes to ContextBundle fields.
All the attribute key constants are defined here — nowhere else references raw strings.

─────────────────────────────────────────────────────────────────────────────

import { FlatSpan } from "../types/otel"
import { Message, ToolCall } from "../types/bundle"

const TRACELOOP = {
  SPAN_KIND: "traceloop.span.kind",
  WORKFLOW:  "traceloop.workflow.name",
  TASK:      "traceloop.task.name",
  AGENT:     "traceloop.agent.name",
  TOOL:      "traceloop.tool.name",
  ENTITY:    "traceloop.entity.name",
  INPUT:     "traceloop.entity.input",
  OUTPUT:    "traceloop.entity.output",
} as const

const LLM = {
  REQUEST_MODEL:       "llm.request.model",
  RESPONSE_MODEL:      "llm.response.model",
  PROMPT_TOKENS:       "llm.usage.prompt_tokens",
  COMPLETION_TOKENS:   "llm.usage.completion_tokens",
  TOTAL_TOKENS:        "llm.usage.total_tokens",
  PROMPTS:             "llm.prompts",
  COMPLETIONS:         "llm.completions",
  TOOL_INPUT:          "llm.tool.input",
  TOOL_OUTPUT:         "llm.tool.output",
} as const

export type TraceloopSpanKind = "workflow" | "task" | "agent" | "tool" | "llm" | "unknown"

export interface MappedSpan {
  spanKind:      TraceloopSpanKind
  isLlmCall:     boolean
  model:         string
  tokenTotal:    number
  inputTokens:   number
  outputTokens:  number
  messages:      Message[]
  toolCalls:     ToolCall[]
  workflowName:  string | undefined
  taskName:      string | undefined
  agentName:     string | undefined
  toolName:      string | undefined
}

export function mapSpan(span: FlatSpan): MappedSpan {
  const a = span.attributes

  const rawKind  = String(a[TRACELOOP.SPAN_KIND] ?? "unknown").toLowerCase()
  const validKinds: TraceloopSpanKind[] = ["workflow","task","agent","tool","llm"]
  const spanKind = (validKinds.includes(rawKind as TraceloopSpanKind)
    ? rawKind : "unknown") as TraceloopSpanKind

  const isLlmCall    = spanKind === "llm"
  const model        = String(a[LLM.RESPONSE_MODEL] ?? a[LLM.REQUEST_MODEL] ?? "unknown")
  const inputTokens  = Number(a[LLM.PROMPT_TOKENS]    ?? 0)
  const outputTokens = Number(a[LLM.COMPLETION_TOKENS] ?? 0)
  const tokenTotal   = Number(a[LLM.TOTAL_TOKENS]      ?? inputTokens + outputTokens)

  // ── Parse input messages ──────────────────────────────────────────────────
  // OpenLLMetry emits one of two formats depending on SDK version:
  //   Format A — JSON string: llm.prompts = '[{"role":"user","content":"..."}]'
  //   Format B — indexed:     llm.prompts.0.role, llm.prompts.0.content, ...
  const messages: Message[] = []

  if (a[LLM.PROMPTS]) {
    try {
      const raw = JSON.parse(String(a[LLM.PROMPTS]))
      if (Array.isArray(raw)) {
        for (const m of raw) {
          messages.push({
            role:      m.role ?? "user",
            content:   m.content ?? m.text ?? "",
            timestamp: span.startTime.toISOString(),
          })
        }
      }
    } catch { /* fall through to indexed format */ }
  }

  if (messages.length === 0) {
    let i = 0
    while (a[`llm.prompts.${i}.role`] !== undefined) {
      messages.push({
        role:      String(a[`llm.prompts.${i}.role`]),
        content:   String(a[`llm.prompts.${i}.content`] ?? ""),
        timestamp: span.startTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse completions → append as assistant message(s) ───────────────────
  if (a[LLM.COMPLETIONS]) {
    try {
      const raw = JSON.parse(String(a[LLM.COMPLETIONS]))
      if (Array.isArray(raw)) {
        for (const c of raw) {
          let content = ""
          if (typeof c.text === "string") {
            content = c.text
          } else if (typeof c.message?.content === "string") {
            content = c.message.content
          } else if (Array.isArray(c.message?.content)) {
            content = c.message.content
              .map((b: { text?: string }) => b.text ?? "")
              .join("")
          } else if (typeof c.content === "string") {
            content = c.content
          }
          messages.push({ role: "assistant", content, timestamp: span.endTime.toISOString() })
        }
      }
    } catch { /* skip malformed completions */ }
  }

  if (!a[LLM.COMPLETIONS]) {
    let i = 0
    while (a[`llm.completions.${i}.content`] !== undefined) {
      messages.push({
        role:      "assistant",
        content:   String(a[`llm.completions.${i}.content`]),
        timestamp: span.endTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse tool calls (spanKind === "tool") ────────────────────────────────
  const toolCalls: ToolCall[] = []
  if (spanKind === "tool") {
    const toolName = String(a[TRACELOOP.TOOL] ?? a[TRACELOOP.ENTITY] ?? span.operationName)
    const inputStr  = String(a[LLM.TOOL_INPUT]  ?? a[TRACELOOP.INPUT]  ?? "{}")
    const outputStr = String(a[LLM.TOOL_OUTPUT] ?? a[TRACELOOP.OUTPUT] ?? "{}")
    let input: unknown = {}
    let output: unknown = {}
    try { input  = JSON.parse(inputStr)  } catch { input  = inputStr  }
    try { output = JSON.parse(outputStr) } catch { output = outputStr }
    toolCalls.push({
      tool:      toolName,
      input,
      output,
      status:    a["error"] ? "error" : "success",
      timestamp: span.startTime.toISOString(),
    })
  }

  return {
    spanKind,
    isLlmCall,
    model,
    tokenTotal,
    inputTokens,
    outputTokens,
    messages,
    toolCalls,
    workflowName: a[TRACELOOP.WORKFLOW] !== undefined ? String(a[TRACELOOP.WORKFLOW]) : undefined,
    taskName:     a[TRACELOOP.TASK]     !== undefined ? String(a[TRACELOOP.TASK])     : undefined,
    agentName:    a[TRACELOOP.AGENT]    !== undefined ? String(a[TRACELOOP.AGENT])    : undefined,
    toolName:     a[TRACELOOP.TOOL]     !== undefined ? String(a[TRACELOOP.TOOL])     : undefined,
  }
}

// Human-readable Snapshot.label derived from the span.
export function buildLabel(span: FlatSpan, mapped: MappedSpan): string {
  if (mapped.workflowName) return `workflow: ${mapped.workflowName}`
  if (mapped.agentName)    return `agent: ${mapped.agentName}`
  if (mapped.taskName)     return `task: ${mapped.taskName}`
  if (mapped.toolName)     return `tool: ${mapped.toolName}`
  if (mapped.isLlmCall)    return `${mapped.model} · ${span.durationMs}ms`
  return span.operationName
}
```

---

## Prompt 9.5 — Span processor

```
Create src/receivers/span.processor.ts

Runs inside span.worker.ts. Reads a stored OtelSpan record, maps it,
creates a Snapshot + R2 bundle if it is an LLM span, marks it PROCESSED.

─────────────────────────────────────────────────────────────────────────────

import { nanoid }     from "nanoid"
import { db }         from "../db"
import { redis }      from "../redis"
import { writeBundle } from "../services/bundle.service"
import { mapSpan, buildLabel } from "./span.mapper"
import type { FlatSpan } from "../types/otel"
import type { ContextBundle } from "../types/bundle"

export async function processSpan(otelSpanId: string): Promise<void> {
  const raw = await db.otelSpan.findUnique({ where: { id: otelSpanId } })
  if (!raw || raw.status !== "PENDING") return

  try {
    const span: FlatSpan = {
      traceId:       raw.traceId,
      spanId:        raw.spanId,
      parentSpanId:  raw.parentSpanId ?? undefined,
      operationName: raw.operationName,
      serviceName:   raw.serviceName,
      spanKind:      raw.spanKind,
      startTime:     raw.startTime,
      endTime:       raw.endTime,
      durationMs:    raw.durationMs,
      attributes:    raw.attributes as Record<string, string | number | boolean>,
    }

    const mapped = mapSpan(span)

    // Non-LLM spans: mark processed but do not create a Snapshot.
    if (!mapped.isLlmCall) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      return
    }

    // Find the Kontex session linked to this traceId.
    const session = await db.session.findFirst({ where: { externalTraceId: raw.traceId } })

    if (!session) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      console.warn(
        `[span-processor] No session linked for traceId ${raw.traceId}. ` +
        `Pass X-Kontex-Session-Id on the /ingest request, or call POST /v1/sessions/:id/link-trace.`
      )
      return
    }

    // Find or create the auto-task for this session.
    let task = await db.task.findFirst({
      where: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
    })
    if (!task) {
      task = await db.task.create({
        data: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
      })
    }

    const snapshotId = nanoid(21)
    const label      = buildLabel(span, mapped)

    const bundle: ContextBundle = {
      snapshotId,
      taskId:     task.id,
      sessionId:  session.id,
      capturedAt: raw.startTime.toISOString(),
      model:      mapped.model,
      tokenTotal: mapped.tokenTotal,
      source:     "openllmetry",
      enriched:   true,   // OpenLLMetry spans are self-contained — no enrichment window
      files:      [],
      toolCalls:  mapped.toolCalls,
      messages:   mapped.messages,
      reasoning:  undefined,
      logEvents: [{
        type:      "openllmetry_span",
        timestamp: raw.startTime.toISOString(),
        data: {
          traceId:       raw.traceId,
          spanId:        raw.spanId,
          spanKind:      mapped.spanKind,
          operationName: raw.operationName,
          durationMs:    raw.durationMs,
          workflowName:  mapped.workflowName,
          agentName:     mapped.agentName,
          taskName:      mapped.taskName,
        },
      }],
    }

    const r2Key    = await writeBundle(snapshotId, bundle)
    const snapshot = await db.snapshot.create({
      data: {
        id:         snapshotId,
        taskId:     task.id,
        label,
        tokenTotal: mapped.tokenTotal,
        model:      mapped.model,
        source:     "openllmetry",
        r2Key,
        enriched:   true,
        enrichedAt: new Date(),
      },
    })

    await db.otelSpan.update({
      where: { id: otelSpanId },
      data:  { status: "PROCESSED", snapshotId: snapshot.id },
    })

    // Queue for Qdrant embedding (same queue as proxy snapshots)
    redis.rpush("kontex:embed_jobs", JSON.stringify({ snapshotId: snapshot.id }))
      .catch(err => console.error("[span-processor] Failed to queue embed job:", err))

  } catch (err) {
    await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "FAILED" } })
    console.error(`[span-processor] Failed to process span ${otelSpanId}:`, err)
  }
}
```

---

## Prompt 9.6 — Span worker

```
Create src/workers/span.worker.ts

Separate process. Reads span IDs from Redis queue, calls processSpan.
One bad span never stops the worker.

─────────────────────────────────────────────────────────────────────────────

import { redis } from "../redis"
import { processSpan } from "../receivers/span.processor"

async function run(): Promise<void> {
  console.log("[span-worker] Started — waiting for OpenLLMetry spans")
  while (true) {
    const result = await redis.blpop("kontex:span_jobs", 0)
    if (!result) continue
    const [, raw] = result
    try {
      const { otelSpanId } = JSON.parse(raw)
      processSpan(otelSpanId).catch(err =>
        console.error("[span-worker] Error processing span:", otelSpanId, err)
      )
    } catch (err) {
      console.error("[span-worker] Malformed job payload:", raw, err)
    }
  }
}

run()
```

---

## Prompt 9.7 — Ingest route + link-trace endpoint

```
─── Create src/routes/ingest.ts ─────────────────────────────────────────────

POST /ingest/v1/traces

Auth: X-Kontex-Api-Key header (same pattern as /proxy — NOT Bearer auth).
  Lookup ApiKey: must exist and active → 401 if not.
  Set userId from apiKey.userId.

Content-Type check:
  Accept application/json only.
  Anything else → 415 { error: "unsupported_media_type", message: "Only application/json OTLP supported" }

Processing:
  1. Parse body: const spans = parseOtlpPayload(await c.req.json())
     If spans is empty → return 200 { received: 0 }

  2. Auto-link convenience:
     Read X-Kontex-Session-Id header.
     If present → find session where id = sessionId AND userId = userId
     If found AND session.externalTraceId is null:
       db.session.update({ where: { id: sessionId }, data: { externalTraceId: spans[0].traceId } })
       Await this — it is fast and needed before span processing begins.
     If externalTraceId already set → skip (never overwrite).

  3. For each FlatSpan, upsert to OtelSpan:
     db.otelSpan.upsert({
       where:  { spanId: span.spanId },
       create: {
         traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
         serviceName: span.serviceName, operationName: span.operationName,
         spanKind: span.spanKind, startTime: span.startTime, endTime: span.endTime,
         durationMs: span.durationMs, attributes: span.attributes as Prisma.InputJsonValue,
       },
       update: {},   // idempotent — duplicate spanId, do nothing
     })
     Collect returned/found ids.

  4. For each stored OtelSpan, push to Redis queue (fire-and-forget):
     redis.rpush("kontex:span_jobs", JSON.stringify({ otelSpanId }))
       .catch(err => console.error("[ingest] Failed to queue:", err))

  5. Return 200: { received: spans.length }

  The 200 must return before any span processing.
  Steps 1–3 are awaited (raw data persisted before responding).
  Step 4 is fire-and-forget.

─── Add to src/routes/sessions.ts ───────────────────────────────────────────

POST /v1/sessions/:id/link-trace

Auth: standard Bearer auth (this is a REST endpoint, not ingest).
Zod body: { traceId: z.string().min(1) }

Validate session ownership → 404 if not found or wrong user.

If session.externalTraceId already set AND !== incoming traceId:
  Return 409 { error: "conflict",
    message: "Session already linked to a different traceId. Create a new session for a new trace." }
If session.externalTraceId === incoming traceId:
  Return 200 { sessionId: id, externalTraceId: traceId }  // idempotent
Otherwise:
  db.session.update({ where: { id }, data: { externalTraceId: traceId } })
  Return 200 { sessionId: id, externalTraceId: traceId }

Also update GET /v1/sessions/:id to include externalTraceId in the response.
Also update PATCH /v1/sessions/:id Zod body to accept externalTraceId?: z.string().optional().

─── Update src/index.ts ─────────────────────────────────────────────────────

Add these two lines after all existing route mounts:

  import ingestRouter from "./routes/ingest"
  app.route("/ingest", ingestRouter)

  Note: /ingest/* does NOT use the standard /v1/* Bearer auth middleware.
  The ingest route handles its own auth via X-Kontex-Api-Key.

─── Update railway.toml ─────────────────────────────────────────────────────

Add a third service:

[[services]]
name = "kontex-span-worker"
startCommand = "node dist/workers/span.worker.js"
```

---

## Prompt 9.8 — Ingest tests

```
Create tests/ingest.test.ts

─── Test fixture ────────────────────────────────────────────────────────────

const makeSpan = (overrides: Partial<{
  traceId: string; spanId: string; model: string;
  promptTokens: number; completionTokens: number
}> = {}) => ({
  resourceSpans: [{
    resource: {
      attributes: [{ key: "service.name", value: { stringValue: "test-agent" } }]
    },
    scopeSpans: [{
      scope: { name: "opentelemetry.instrumentation.anthropic" },
      spans: [{
        traceId:           overrides.traceId          ?? "aabb" + "0".repeat(28),
        spanId:            overrides.spanId           ?? "ccdd" + "0".repeat(12),
        name:              "anthropic.messages.create",
        kind:              3,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano:   "1700000001500000000",
        attributes: [
          { key: "traceloop.span.kind",         value: { stringValue: "llm" } },
          { key: "llm.request.model",           value: { stringValue: overrides.model ?? "claude-opus-4-6" } },
          { key: "llm.response.model",          value: { stringValue: overrides.model ?? "claude-opus-4-6" } },
          { key: "llm.usage.prompt_tokens",     value: { intValue: String(overrides.promptTokens    ?? 120) } },
          { key: "llm.usage.completion_tokens", value: { intValue: String(overrides.completionTokens ?? 45)  } },
          { key: "llm.usage.total_tokens",      value: { intValue: String((overrides.promptTokens ?? 120) + (overrides.completionTokens ?? 45)) } },
          { key: "llm.prompts.0.role",          value: { stringValue: "user" } },
          { key: "llm.prompts.0.content",       value: { stringValue: "Refactor the auth module" } },
          { key: "llm.completions.0.content",   value: { stringValue: "Here is the refactored auth module..." } },
        ],
        events: [],
        status: { code: 1 }
      }]
    }]
  }]
})

─── Tests ───────────────────────────────────────────────────────────────────

test("POST /ingest/v1/traces returns 200 { received: 1 }", async () => {
  const res = await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(200)
  expect((await res.json()).received).toBe(1)
})

test("Missing auth → 401", async () => {
  const res = await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(401)
})

test("OtelSpan record created in DB", async () => {
  const spanId = "test-" + Date.now()
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan({ spanId })),
  })
  await new Promise(r => setTimeout(r, 200))
  const record = await db.otelSpan.findUnique({ where: { spanId } })
  expect(record).not.toBeNull()
  expect(record?.spanKind).toBe("llm")
})

test("Duplicate spanId is idempotent", async () => {
  const spanId = "dedup-" + Date.now()
  const payload = makeSpan({ spanId })
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(payload),
  })
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(payload),
  })
  const count = await db.otelSpan.count({ where: { spanId } })
  expect(count).toBe(1)
})

test("Linked session → Snapshot created with source openllmetry", async () => {
  const traceId = "trace-" + Date.now()

  const sessRes = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "OpenLLMetry test" }),
  })
  const { id: sessionId } = await sessRes.json()

  await fetch(`http://localhost:3000/v1/sessions/${sessionId}/link-trace`, {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ traceId }),
  })

  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan({ traceId, spanId: "snap-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 1000))  // wait for span-worker

  const snapRes = await fetch(`http://localhost:3000/v1/sessions/${sessionId}/snapshots`, {
    headers: { "Authorization": "Bearer test_key_dev" },
  })
  const { data } = await snapRes.json()
  expect(data.length).toBeGreaterThan(0)
  expect(data[0].source).toBe("openllmetry")
})

test("X-Kontex-Session-Id header auto-links trace", async () => {
  const traceId = "auto-" + Date.now()
  const sessRes = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Auto-link test" }),
  })
  const { id: sessionId } = await sessRes.json()

  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kontex-Api-Key": "test_key_dev",
      "X-Kontex-Session-Id": sessionId,
    },
    body: JSON.stringify(makeSpan({ traceId, spanId: "autolink-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 200))
  const sess = await db.session.findUnique({ where: { id: sessionId } })
  expect(sess?.externalTraceId).toBe(traceId)
})

Run: npm test
All existing sprint 1–8 tests must still pass.
```

---

## Prompt 9.9 — OpenLLMetry quickstart docs

```
Write docs/openllmetry-quickstart.md

─────────────────────────────────────────────────────────────────────────────

# Kontex + OpenLLMetry Quickstart

## What you get

Every LLM call your agent makes — regardless of provider or framework — captured as an
immutable Kontex snapshot. Anthropic, OpenAI, Gemini, Bedrock, LangChain, LlamaIndex,
CrewAI, and 15+ others. Two lines of setup. Zero changes to agent logic.

## Supported providers and frameworks

LLM providers: Anthropic · OpenAI · Azure OpenAI · Amazon Bedrock · Google Gemini ·
Google VertexAI · Cohere · Mistral AI · Groq · Ollama · HuggingFace · IBM watsonx ·
Replicate · together.ai

Frameworks: LangChain (Python + JS) · LlamaIndex (Python + JS) · CrewAI ·
Haystack · Agno · Burr · LiteLLM · OpenAI Agents SDK · AWS Strands

## Step 1: Create a session

  curl -X POST https://api.usekontex.com/v1/sessions \
    -H "Authorization: Bearer {KONTEX_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"name": "my-agent-session"}'

  Save the returned id as KONTEX_SESSION_ID.

## Step 2: Install OpenLLMetry

  npm install @traceloop/node-server-sdk    # Node.js
  pip install traceloop-sdk                 # Python

## Step 3: Initialize before any LLM import

### Node.js

  // MUST come before any import of Anthropic, OpenAI, LangChain, etc.
  import * as traceloop from "@traceloop/node-server-sdk"

  traceloop.initialize({
    baseUrl: "https://api.usekontex.com",
    headers: {
      "X-Kontex-Api-Key":    process.env.KONTEX_API_KEY!,
      "X-Kontex-Session-Id": process.env.KONTEX_SESSION_ID!,
    },
    disableBatch: process.env.NODE_ENV === "development",
  })

  // Now import LLM libraries — they are automatically instrumented
  import Anthropic from "@anthropic-ai/sdk"

### Python

  # MUST come before any import of anthropic, openai, langchain, etc.
  from traceloop.sdk import Traceloop

  Traceloop.init(
      app_name="my-agent",
      base_url="https://api.usekontex.com",
      headers={
          "X-Kontex-Api-Key":    os.environ["KONTEX_API_KEY"],
          "X-Kontex-Session-Id": os.environ["KONTEX_SESSION_ID"],
      },
      disable_batch=os.environ.get("ENV") == "development",
  )

  # Now import LLM libraries — they are automatically instrumented
  import anthropic

## Step 4: Run your agent unchanged

Your existing agent code runs as-is. Every LLM call is captured.

## Step 5: Verify

  curl https://api.usekontex.com/v1/sessions/{KONTEX_SESSION_ID}/snapshots \
    -H "Authorization: Bearer {KONTEX_API_KEY}"

## Framework examples

### LangChain (Python)
  Call Traceloop.init() at top of file, then use LangChain agents and chains normally.

### LangChain.js
  Call traceloop.initialize() before importing langchain. Normal chain code after.

### LlamaIndex (Python)
  Call Traceloop.init(), then use QueryEngine, AgentRunner, etc. normally.

### CrewAI
  Call Traceloop.init(), then define Crew, Agent, Task normally.
  Each agent's LLM calls become separate snapshots.

### Raw OpenAI SDK (Python)
  Call Traceloop.init(), then openai.chat.completions.create() is auto-captured.

## Adding workflow structure (optional)

### Node.js
  import { withWorkflow, withTask, withAgent, withTool } from "@traceloop/node-server-sdk"

  const result = await withWorkflow({ name: "refactor-agent" }, async () => {
    const plan = await withTask({ name: "plan" }, () => generatePlan())
    const code = await withTask({ name: "execute" }, () => writeCode(plan))
    return code
  })

### Python
  from traceloop.sdk.decorators import workflow, task, agent, tool

  @workflow(name="refactor-agent")
  def run_agent():
      plan = generate_plan()
      return write_code(plan)

  @task(name="generate-plan")
  def generate_plan(): ...

## Import order is critical

OpenLLMetry patches LLM libraries at import time. If you import Anthropic or OpenAI
before calling initialize() / Traceloop.init(), the instrumentation will not activate.
Always initialize first.

## Using the HTTP proxy instead

If you cannot modify your agent code, see docs/quickstart.md for the proxy fallback.
The proxy works with Anthropic-compatible APIs only.

─────────────────────────────────────────────────────────────────────────────

Done criteria:
  - [ ] npm run dev + npm run span-worker running simultaneously
  - [ ] Send OTLP test payload: tsx tests/ingest-e2e.ts
  - [ ] GET /v1/sessions/:id/snapshots shows source "openllmetry"
  - [ ] docs/openllmetry-quickstart.md accurate against local endpoint
```
