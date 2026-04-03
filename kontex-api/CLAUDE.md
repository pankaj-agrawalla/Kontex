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

# SPRINT 10 — tRPC + SSE

**Prerequisite:** Sprint 9 complete.

**What this adds:**

- **tRPC** at `/trpc/*` — the dashboard frontend's API. Type-safe by construction. The REST API at `/v1/*` is unchanged and remains the external contract for CLI tools, third-party integrations, and the OpenLLMetry SDK.
- **SSE** at `/sse/session/:id/feed` — push new snapshots and session updates to the dashboard in real time via Redis pub/sub. The span-worker publishes one event per snapshot created; connected SSE clients receive it within ~100ms.

**Rule:** tRPC is for code you own on both sides (your React dashboard + this backend). REST is for everything else. Never migrate existing REST routes to tRPC.

**Done criteria:**
- [ ] `POST /trpc/*` handles all tRPC procedure calls
- [ ] tRPC context carries `userId` resolved from Bearer token
- [ ] tRPC covers: sessions CRUD, tasks list, snapshots list + bundle + rollback, dashboard graph/diff/timeline/usage/search
- [ ] `GET /sse/session/:id/feed` returns `text/event-stream`
- [ ] SSE emits `snapshot.created` within ~1s of span-worker creating a snapshot
- [ ] SSE emits `session.updated` when session status changes
- [ ] SSE client disconnect unsubscribes from Redis cleanly — no dangling connections
- [ ] Shared type file `src/trpc/types.ts` exportable by frontend
- [ ] All sprint 1–9 tests still pass
- [ ] `npm run build` — zero TypeScript errors

---

## Prompt 10.1 — Install dependencies

```
npm install @trpc/server @hono/trpc-server

@trpc/server     — core tRPC (server-side only — no client needed in this repo)
@hono/trpc-server — Hono adapter that mounts the tRPC router as a Hono handler
zod              — already installed
```

---

## Prompt 10.2 — tRPC init, context, auth procedure

```
─── Create src/trpc/trpc.ts ─────────────────────────────────────────────────

import { initTRPC, TRPCError } from "@trpc/server"
import type { Context } from "./context"

const t = initTRPC.context<Context>().create()

export const router          = t.router
export const publicProcedure = t.procedure

// authedProcedure — throws UNAUTHORIZED if userId is null.
// All dashboard procedures use this. Never use publicProcedure for data queries.
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})

─── Create src/trpc/context.ts ──────────────────────────────────────────────

import { db }    from "../db"
import { redis } from "../redis"
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch"

export interface Context {
  userId: string | null
  db:     typeof db
  redis:  typeof redis
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const authHeader = opts.req.headers.get("Authorization") ?? ""
  const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (!key) return { userId: null, db, redis }

  try {
    const apiKey = await db.apiKey.findUnique({ where: { key } })
    if (!apiKey || !apiKey.active) return { userId: null, db, redis }
    // Fire-and-forget lastUsed — same pattern as REST auth middleware
    db.apiKey.update({ where: { key }, data: { lastUsed: new Date() } }).catch(() => {})
    return { userId: apiKey.userId, db, redis }
  } catch {
    return { userId: null, db, redis }
  }
}
```

---

## Prompt 10.3 — Sessions + tasks tRPC router

```
Create src/trpc/routers/sessions.ts

These procedures are thin adapters over the same Prisma queries the REST routes use.
No business logic lives here — only query construction and error mapping.

─────────────────────────────────────────────────────────────────────────────

import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"

export const sessionsRouter = router({

  list: authedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE","PAUSED","COMPLETED"]).optional(),
      limit:  z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.db.session.findMany({
        where: {
          userId: ctx.userId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        take:    input.limit,
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { tasks: true } } },
      })
      return {
        data:       sessions,
        nextCursor: sessions.length === input.limit ? sessions.at(-1)!.id : null,
      }
    }),

  byId: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({
        where:   { id: input.id },
        include: { _count: { select: { tasks: true } } },
      })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      return session
    }),

  create: authedProcedure
    .input(z.object({
      name:        z.string().min(1).max(200),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.session.create({
        data: { ...input, userId: ctx.userId, status: "ACTIVE" },
      })
    }),

  update: authedProcedure
    .input(z.object({
      id:              z.string(),
      name:            z.string().min(1).max(200).optional(),
      description:     z.string().max(500).optional(),
      status:          z.enum(["ACTIVE","PAUSED","COMPLETED"]).optional(),
      externalTraceId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      const existing = await ctx.db.session.findUnique({ where: { id } })
      if (!existing || existing.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const updated = await ctx.db.session.update({ where: { id }, data })
      if (data.status) {
        // Publish status change for SSE consumers
        const { publishEvent } = await import("../../lib/events")
        publishEvent({ type: "session.updated", sessionId: id, data: { status: data.status } })
      }
      return updated
    }),

  tasks: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      return ctx.db.task.findMany({
        where:   { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { snapshots: true } } },
      })
    }),
})
```

---

## Prompt 10.4 — Snapshots tRPC router

```
Create src/trpc/routers/snapshots.ts

─────────────────────────────────────────────────────────────────────────────

import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"
import { readBundle } from "../../services/bundle.service"
import { rollbackToSnapshot } from "../../services/snapshot.service"

export const snapshotsRouter = router({

  listBySession: authedProcedure
    .input(z.object({
      sessionId: z.string(),
      limit:     z.number().min(1).max(100).default(20),
      cursor:    z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const taskIds = (await ctx.db.task.findMany({
        where:  { sessionId: input.sessionId },
        select: { id: true },
      })).map(t => t.id)

      const snapshots = await ctx.db.snapshot.findMany({
        where: {
          taskId: { in: taskIds },
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        take:    input.limit,
        orderBy: { createdAt: "desc" },
      })
      return {
        data:       snapshots,
        nextCursor: snapshots.length === input.limit ? snapshots.at(-1)!.id : null,
      }
    }),

  byId: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.db.snapshot.findUnique({
        where:   { id: input.id },
        include: { task: { include: { session: true } } },
      })
      if (!snapshot || snapshot.task.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
      }
      return snapshot
    }),

  bundle: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.db.snapshot.findUnique({
        where:   { id: input.id },
        include: { task: { include: { session: true } } },
      })
      if (!snapshot || snapshot.task.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
      }
      try {
        const bundle = await readBundle(snapshot.r2Key)
        return { snapshot, bundle }
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to read bundle from storage" })
      }
    }),

  rollback: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rollbackToSnapshot({ snapshotId: input.id, userId: ctx.userId })
      } catch (err) {
        const msg = (err as Error).message
        if (msg.startsWith("NOT_FOUND")) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Rollback failed" })
      }
    }),
})
```

---

## Prompt 10.5 — Dashboard tRPC router

```
Create src/trpc/routers/dashboard.ts

─────────────────────────────────────────────────────────────────────────────

import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"
import { diffBundles } from "../../services/diff.service"
import { readBundle }  from "../../services/bundle.service"

export const dashboardRouter = router({

  graph: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const tasks = await ctx.db.task.findMany({
        where:   { sessionId: input.sessionId },
        include: { snapshots: true },
      })
      const nodes = tasks.map((task, i) => ({
        id: task.id,
        data: {
          label:         task.name,
          status:        task.status,
          snapshotCount: task.snapshots.length,
          tokenTotal:    task.snapshots.reduce((s, snap) => s + snap.tokenTotal, 0),
        },
        position: { x: 300, y: i * 120 },
      }))
      const edges = tasks
        .filter(t => t.parentTaskId)
        .map(t => ({
          id:       `e_${t.parentTaskId}_${t.id}`,
          source:   t.parentTaskId!,
          target:   t.id,
          animated: t.status === "ACTIVE" || t.status === "PENDING",
        }))
      return { nodes, edges }
    }),

  diff: authedProcedure
    .input(z.object({
      sessionId:      z.string(),
      fromSnapshotId: z.string(),
      toSnapshotId:   z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const [snapA, snapB] = await Promise.all([
        ctx.db.snapshot.findUnique({ where: { id: input.fromSnapshotId }, include: { task: true } }),
        ctx.db.snapshot.findUnique({ where: { id: input.toSnapshotId   }, include: { task: true } }),
      ])
      if (!snapA || snapA.task.sessionId !== input.sessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "fromSnapshotId not in this session" })
      }
      if (!snapB || snapB.task.sessionId !== input.sessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "toSnapshotId not in this session" })
      }
      const [bundleA, bundleB] = await Promise.all([readBundle(snapA.r2Key), readBundle(snapB.r2Key)])
      return diffBundles(bundleA, bundleB)
    }),

  timeline: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const tasks     = await ctx.db.task.findMany({ where: { sessionId: input.sessionId } })
      const taskNames = Object.fromEntries(tasks.map(t => [t.id, t.name]))
      const snapshots = await ctx.db.snapshot.findMany({
        where:   { taskId: { in: tasks.map(t => t.id) } },
        orderBy: { createdAt: "asc" },
      })
      let prev = 0
      return snapshots.map(s => {
        const delta = s.tokenTotal - prev
        prev = s.tokenTotal
        return {
          id: s.id, label: s.label, taskId: s.taskId,
          taskName: taskNames[s.taskId] ?? "",
          source: s.source, enriched: s.enriched,
          tokenTotal: s.tokenTotal, tokenDelta: delta,
          createdAt: s.createdAt,
        }
      })
    }),

  usage: authedProcedure
    .query(async ({ ctx }) => {
      const sessions   = await ctx.db.session.findMany({ where: { userId: ctx.userId } })
      const sessionIds = sessions.map(s => s.id)
      const tasks      = await ctx.db.task.findMany({ where: { sessionId: { in: sessionIds } } })
      const snapshots  = await ctx.db.snapshot.findMany({ where: { taskId: { in: tasks.map(t => t.id) } } })
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const thisMonth  = snapshots.filter(s => s.createdAt >= monthStart)
      return {
        totalSessions:      sessions.length,
        activeSessions:     sessions.filter(s => s.status === "ACTIVE").length,
        totalSnapshots:     snapshots.length,
        totalTokensStored:  snapshots.reduce((s, snap) => s + snap.tokenTotal, 0),
        snapshotsThisMonth: thisMonth.length,
        tokensThisMonth:    thisMonth.reduce((s, snap) => s + snap.tokenTotal, 0),
      }
    }),
})
```

---

## Prompt 10.6 — Root router + mount in Hono

```
─── Create src/trpc/router.ts ───────────────────────────────────────────────

import { router }           from "./trpc"
import { sessionsRouter }   from "./routers/sessions"
import { snapshotsRouter }  from "./routers/snapshots"
import { dashboardRouter }  from "./routers/dashboard"

export const appRouter = router({
  sessions:  sessionsRouter,
  snapshots: snapshotsRouter,
  dashboard: dashboardRouter,
})

// The ONLY export the frontend needs from this repo.
// Frontend imports this type, not implementation code.
export type AppRouter = typeof appRouter

─── Create src/trpc/types.ts ────────────────────────────────────────────────

// Shared types for the frontend to import alongside AppRouter.
// The frontend never imports from src/ directly — only from here.

export type { Session, Task, Snapshot } from "@prisma/client"
export type { ContextBundle, Message, ToolCall } from "../types/bundle"
export type { KontexEvent } from "../lib/events"
export type { DiffResult }  from "../services/diff.service"

─── Update src/index.ts ─────────────────────────────────────────────────────

Add these lines after all existing route mounts. No existing code changes.

  import { fetchRequestHandler } from "@hono/trpc-server"
  import { appRouter }           from "./trpc/router"
  import { createContext }        from "./trpc/context"

  app.use("/trpc/*", (c) =>
    fetchRequestHandler({
      endpoint:      "/trpc",
      req:           c.req.raw,
      router:        appRouter,
      createContext,
    })
  )
```

---

## Prompt 10.7 — Events pub/sub + SSE route

```
─── Create src/lib/events.ts ────────────────────────────────────────────────

Redis pub/sub publish helpers. Called from span.processor and route handlers.
Publishing is always fire-and-forget — never let it throw.

import { redis } from "../redis"

export type KontexEvent =
  | {
      type: "snapshot.created"
      sessionId: string
      data: { snapshotId: string; label: string; tokenTotal: number; source: string; taskId: string }
    }
  | {
      type: "session.updated"
      sessionId: string
      data: { status: string }
    }
  | {
      type: "span.received"
      sessionId: string
      data: { spanId: string; spanKind: string; operationName: string }
    }

export function publishEvent(event: KontexEvent): void {
  const channel = `session:${event.sessionId}:events`
  redis.publish(channel, JSON.stringify(event))
    .catch(err => console.error("[events] Failed to publish:", err))
}

─── Update src/receivers/span.processor.ts ──────────────────────────────────

After the db.snapshot.create() call succeeds, add two lines:

  import { publishEvent } from "../lib/events"

  // After snapshot is created and OtelSpan is marked PROCESSED:
  publishEvent({
    type:      "snapshot.created",
    sessionId: session.id,
    data: {
      snapshotId: snapshot.id,
      label:      snapshot.label,
      tokenTotal: snapshot.tokenTotal,
      source:     snapshot.source,
      taskId:     snapshot.taskId,
    },
  })

─── Create src/routes/sse.ts ────────────────────────────────────────────────

GET /sse/session/:id/feed

Opens a Server-Sent Events stream for a session.
The dashboard subscribes to this to receive real-time snapshot and status events.

Auth: Bearer auth — same ApiKey lookup as REST middleware.
  Return 401 as plain text if auth fails (SSE clients may not parse JSON).
  Validate session ownership → 404 plain text if not found or wrong user.

SSE response headers:
  Content-Type: text/event-stream
  Cache-Control: no-cache
  Connection: keep-alive
  X-Accel-Buffering: no    ← disables Nginx buffering on Railway

Redis subscription:
  Create a DEDICATED Redis connection for this subscriber — do NOT use the shared
  redis singleton. Redis requires a separate connection per subscribe call.

    import Redis from "ioredis"
    import { config } from "../config"
    const sub = new Redis(config.REDIS_URL)

  Subscribe: sub.subscribe(`session:${id}:events`)

  On message: write to SSE stream in spec format:
    `event: ${parsedEvent.type}\ndata: ${raw}\n\n`

Heartbeat:
  Every 30 seconds send a comment to keep the connection alive:
    `: heartbeat\n\n`
  Use setInterval — clear it on disconnect.

Cleanup on client disconnect:
  sub.unsubscribe()
  sub.disconnect()
  clearInterval(heartbeatInterval)

SSE message format (follow spec exactly):
  event: snapshot.created\n
  data: {"snapshotId":"...","label":"...","tokenTotal":165,"source":"openllmetry","taskId":"..."}\n
  \n

─── Update src/index.ts ─────────────────────────────────────────────────────

Add after the tRPC mount added in Prompt 10.6:

  import sseRouter from "./routes/sse"
  app.route("/sse", sseRouter)
```

---

## Prompt 10.8 — Tests

```
─── Create tests/trpc.test.ts ───────────────────────────────────────────────

test("tRPC sessions.list without auth → UNAUTHORIZED", async () => {
  const res = await fetch("http://localhost:3000/trpc/sessions.list?input=%7B%7D")
  const body = await res.json()
  expect(body.error.data.code).toBe("UNAUTHORIZED")
})

test("tRPC sessions.create returns new session", async () => {
  const res = await fetch("http://localhost:3000/trpc/sessions.create", {
    method:  "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body:    JSON.stringify({ name: "tRPC test" }),
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.result.data.id).toBeDefined()
  expect(body.result.data.status).toBe("ACTIVE")
})

test("tRPC sessions.byId wrong user → NOT_FOUND", async () => {
  // Create session as user A, query with user B key → NOT_FOUND
})

test("tRPC dashboard.usage returns numeric counts", async () => {
  const res = await fetch("http://localhost:3000/trpc/dashboard.usage", {
    headers: { "Authorization": "Bearer test_key_dev" },
  })
  const body = await res.json()
  expect(typeof body.result.data.totalSessions).toBe("number")
  expect(typeof body.result.data.totalSnapshots).toBe("number")
})

─── Create tests/sse.test.ts ────────────────────────────────────────────────

test("GET /sse/session/:id/feed without auth → 401", async () => {
  const res = await fetch("http://localhost:3000/sse/session/any-id/feed")
  expect(res.status).toBe(401)
})

test("GET /sse/session/nonexistent/feed → 404", async () => {
  const res = await fetch("http://localhost:3000/sse/session/does-not-exist/feed", {
    headers: { "Authorization": "Bearer test_key_dev" },
  })
  expect(res.status).toBe(404)
})

test("GET /sse/session/:id/feed returns text/event-stream", async () => {
  // Create real session
  const sessRes = await fetch("http://localhost:3000/v1/sessions", {
    method:  "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body:    JSON.stringify({ name: "SSE test" }),
  })
  const { id } = await sessRes.json()

  const controller = new AbortController()
  const res = await fetch(`http://localhost:3000/sse/session/${id}/feed`, {
    headers: { "Authorization": "Bearer test_key_dev" },
    signal:  controller.signal,
  })
  expect(res.headers.get("content-type")).toContain("text/event-stream")
  controller.abort()
})

Manual SSE verification:
  Terminal 1: npm run dev
  Terminal 2: npm run span-worker
  Terminal 3: curl -N http://localhost:3000/sse/session/{id}/feed \
                -H "Authorization: Bearer test_key_dev"
  Terminal 4: send an OTLP span to the linked session
  Expected: within ~1s, Terminal 3 prints:
    event: snapshot.created
    data: {"snapshotId":"...","label":"...","tokenTotal":165,...}

Run: npm test
All sprint 1–9 tests must still pass.
```

---

---
