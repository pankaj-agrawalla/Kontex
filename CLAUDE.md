# CLAUDE.md — Kontex API Backend

Read this file completely before writing any code. This file provides stable context for every sprint. The Claude Code prompts are in `kontex-backend-buildguide.md` — execute them from there, sprint by sprint.

---

## What Kontex Is

Kontex is a **task-state persistence engine for agentic workflows**.

It is not a memory store. It is not a chat logger. It is a state machine with audit trail.

**Two jobs:**
1. **Capture** — intercept agent context via HTTP proxy (primary), enrich via Claude Code log watcher (secondary), accept explicit checkpoints via MCP tools (advanced)
2. **Restore** — serve snapshot data to agents for rollback, to the dashboard for inspection, to developers for semantic search

**The one invariant that must never be violated:**
Snapshots are immutable once finalized. Rollback creates a new snapshot — it never deletes or mutates history. The timeline always grows forward.

---

## Write Path Hierarchy

```
PRIMARY    HTTP Proxy       zero friction, any runtime, change one line
SECONDARY  Log Watcher      Claude Code disk logs, enriches proxy snapshots
ADVANCED   MCP Tools        explicit named checkpoints, power users only
```

MCP is never required. It is an enhancement on top of what proxy + watcher already provide automatically.

---

## Architecture

```
PRIMARY              SECONDARY               ADVANCED
HTTP Proxy           Log Watcher             MCP Tools
(any runtime)        (~/.claude/projects/)   (power users)
     │                    │                       │
     └────────────────────┴───────────────────────┘
                          │
                   Hono API (Railway)
                   /v1/*  /proxy/*  /mcp/*
                          │
         ┌────────────────┼────────────────┐
         │                │                │
     PostgreSQL        R2 (CF)          Qdrant
     metadata          bundles          semantic search
         │
       Redis
   embed + enrich queue
```

**Proxy flow:** Developer sets `baseURL` to Kontex proxy + adds `X-Kontex-Api-Key` and `X-Kontex-Session-Id` headers → Kontex forwards to Anthropic unmodified → intercepts response → auto-snapshots async (never blocks response) → returns Anthropic response identically.

**Log watcher flow:** `npx kontex-watch` tails `~/.claude/projects/{hash}/*.jsonl` → parses file reads, tool calls, reasoning → pushes enrichment to `POST /v1/snapshots/:id/enrich` → enrichment window is 60 seconds after snapshot creation.

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
| Log watching | chokidar + tail-file-stream |
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
│   ├── routes/
│   │   ├── sessions.ts
│   │   ├── tasks.ts
│   │   ├── snapshots.ts
│   │   ├── proxy.ts          ← PRIMARY write path
│   │   ├── enrich.ts         ← log watcher endpoint
│   │   ├── mcp.ts            ← ADVANCED write path
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
│   ├── workers/
│   │   └── embed.worker.ts
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── session.tools.ts
│   │       ├── snapshot.tools.ts
│   │       └── rollback.tools.ts
│   └── types/
│       ├── api.ts
│       └── bundle.ts
├── watcher/
│   ├── index.ts
│   ├── tail.ts
│   ├── parser.ts
│   └── push.ts
├── tests/
├── docs/
├── .env / .env.example
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## Data Model

```
User → ApiKey[] / Session[]

Session (ACTIVE|PAUSED|COMPLETED)
  └── Task[] (PENDING|ACTIVE|COMPLETED|FAILED) — tree via parentTaskId
        └── Snapshot[]
              └── ContextBundle → R2 blob at bundles/{snapshotId}.json

Snapshot fields:
  id, taskId, label, tokenTotal, model
  source     "proxy" | "log_watcher" | "mcp"
  r2Key      "bundles/{snapshotId}.json"
  enriched   bool  — true after log watcher enrichment
  enrichedAt DateTime?
  embedded   bool  — true after Qdrant indexing

ContextBundle:
  snapshotId, taskId, sessionId, capturedAt, model, tokenTotal
  source, enriched
  files[]      { path, content?, contentHash, tokenCount }
  toolCalls[]  { tool, input, output, status, timestamp }
  messages[]   { role, content, timestamp? }
  reasoning?   string
  logEvents[]  { type, timestamp, data }
```

---

## Prisma Schema (Full — do not modify without instruction)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql" url = env("DATABASE_URL") }

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
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
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id])
  name        String
  description String?
  status      SessionStatus @default(ACTIVE)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt
  tasks       Task[]
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

**Zod:** Validates every request body at route level before reaching service layer.

**Services:** Pure functions over DB + external clients. No Hono context. Receive `userId` explicitly. Services do not call other services — routes orchestrate.

**Ownership:** Always validate a resource belongs to the authenticated user. Return `404` (not `403`) when a resource is not found or belongs to another user — do not reveal existence.

**R2:** Key format `bundles/{snapshotId}.json`. R2 errors → `502 upstream_error`. Never crash on R2 failure.

**Proxy:** Snapshot always async. Never awaited in request cycle. Anthropic response must return even if Kontex snapshot throws.

**Immutability:** Snapshots sealed after enrichment window. Never overwrite a sealed bundle. Rollback creates — never deletes.

**Errors — always this shape:**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

**Standard codes:**
```
unauthorized          401
forbidden             403
not_found             404
validation_error      400
enrich_window_expired 409
rate_limit_exceeded   429
upstream_error        502
internal_error        500
```

**Never log API key values. Never expose stack traces in responses.**

---

## Package Scripts

```json
{
  "scripts": {
    "dev":     "dotenv-cli -e .env -- tsx watch src/index.ts",
    "worker":  "dotenv-cli -e .env -- tsx watch src/workers/embed.worker.ts",
    "watch":   "dotenv-cli -e .env -- tsx watcher/index.ts",
    "build":   "tsc",
    "start":   "node dist/index.js",
    "migrate": "prisma migrate deploy",
    "studio":  "prisma studio",
    "test":    "vitest run"
  }
}
```

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 1 | Foundation | Hono, Prisma, auth, sessions, tasks |
| 2 | Snapshot engine | ContextBundle type, R2 storage, snapshot CRUD |
| 3 | HTTP Proxy (PRIMARY) | Anthropic passthrough, auto-snapshot, quickstart.md |
| 4 | Log Watcher (SECONDARY) | JSONL parser, tailer, enrich endpoint, log-watcher.md |
| 5 | Rollback | Forward-only history, restorable ContextBundle |
| 6 | MCP Server (ADVANCED) | 6 tools, Claude Code integration, mcp-advanced.md |
| 7 | Dashboard API | graph, diff, timeline, usage, search |
| 8 | Polish + Deploy | Rate limiting, key management, Railway, data-model.md |

Complete all done criteria for a sprint before starting the next.

---

## How to Use This File

```bash
cd kontex-api
# CLAUDE.md is here — Claude Code reads it automatically

# Then open kontex-backend-buildguide.md
# Navigate to the current sprint
# Execute prompts in Claude Code in order
# e.g. "Execute Prompt 3.1"

# Verify done criteria before moving to next sprint
```
# SPRINT 5 — Rollback

**Goal:** Full rollback API. Forward-only history. Rollback creates a new snapshot, never deletes. Returns a ContextBundle ready for re-injection into an agent session.

**Done criteria:**
- [ ] `POST /v1/snapshots/:id/rollback` returns full ContextBundle
- [ ] A new Snapshot record created, original untouched
- [ ] Rollback snapshot label: `"Rollback to: {original label}"`
- [ ] Rollback snapshot `source` inherits from original
- [ ] Cross-user rollback → 403
- [ ] `rollback_snapshot_id` and `source_snapshot_id` both in response

---

## Prompt 5.1 — Rollback service + route

```
Add to src/services/snapshot.service.ts:

export async function rollbackToSnapshot(params: {
  snapshotId: string
  userId: string
}): Promise<{
  rollbackSnapshotId: string
  sourceSnapshotId: string
  label: string
  capturedAt: string
  tokenTotal: number
  bundle: ContextBundle
}> {
  // 1. Fetch source snapshot + validate ownership
  const { snapshot, bundle } = await getSnapshot(params.snapshotId, params.userId)

  // 2. Create new snapshot on the same task
  //    label: "Rollback to: {original label}"
  //    bundle: copy of original bundle, new snapshotId, capturedAt = now
  const newSnapshotId = generateId()
  const newBundle: ContextBundle = {
    ...bundle,
    snapshotId: newSnapshotId,
    capturedAt: new Date().toISOString(),
    source: snapshot.source as SnapshotSource,
    enriched: false,
    logEvents: [],
  }

  const r2Key = await writeBundle(newSnapshotId, newBundle)

  const newSnapshot = await db.snapshot.create({
    data: {
      id: newSnapshotId,
      taskId: snapshot.taskId,
      label: `Rollback to: ${snapshot.label}`,
      tokenTotal: snapshot.tokenTotal,
      model: snapshot.model,
      source: snapshot.source,
      r2Key,
    }
  })

  return {
    rollbackSnapshotId: newSnapshot.id,
    sourceSnapshotId: params.snapshotId,
    label: newSnapshot.label,
    capturedAt: newBundle.capturedAt,
    tokenTotal: newSnapshot.tokenTotal,
    bundle: newBundle,
  }
}

Add to src/routes/snapshots.ts:

POST /v1/snapshots/:id/rollback
  No request body needed
  Call: snapshot.service.rollbackToSnapshot({ snapshotId: params.id, userId: c.get("userId") })
  On "NOT_FOUND" → 404
  On "R2_READ_FAILED" → 502
  Return 200:
    {
      rollback_snapshot_id: string,
      source_snapshot_id: string,
      label: string,
      captured_at: string,
      token_total: number,
      bundle: ContextBundle
    }
```

---

## Prompt 5.2 — Rollback verification

```
Add to tests/snapshots.test.ts:

test("POST /v1/snapshots/:id/rollback creates new snapshot", async () => {
  // Create a snapshot, then POST /v1/snapshots/:id/rollback
  // Assert 200
  // Assert rollback_snapshot_id !== source_snapshot_id
  // Assert label starts with "Rollback to: "
  // Assert bundle is returned with messages array
})

test("POST /v1/snapshots/:id/rollback original snapshot unchanged", async () => {
  // Create snapshot, rollback, GET original snapshot
  // Assert original snapshot label is unchanged
  // Assert original r2Key is unchanged
})

test("POST /v1/snapshots/:id/rollback wrong user → 404", async () => {
  // Create snapshot as user A, rollback as user B
  // Assert 404
})

Run: npm test
All tests must pass before Sprint 6.
```

---

---

