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
# SPRINT 2 — Snapshot Engine

**Goal:** Core snapshot write/read. ContextBundle type defined. Stored in R2. Token counting. This is the fundamental Kontex primitive — everything else builds on it.

**Done criteria:**
- [ ] `POST /v1/tasks/:id/snapshots` creates Postgres record + R2 blob
- [ ] `GET /v1/snapshots/:id` returns metadata + full bundle
- [ ] R2 key format: `bundles/{snapshotId}.json`
- [ ] `source` field defaults to `"proxy"`
- [ ] `enriched` defaults false
- [ ] Cross-user snapshot access → 403
- [ ] R2 error → 502, process does not crash
- [ ] Token total stored correctly

---

## Prompt 2.1 — ContextBundle types

```
Create src/types/bundle.ts with the complete ContextBundle type:

export interface ContextFile {
  path: string
  content?: string          // populated by log watcher, empty on proxy creation
  contentHash: string       // sha256 of file content
  tokenCount: number
}

export interface ToolCall {
  tool: string
  input: unknown
  output: unknown
  status: "success" | "error"
  timestamp: string         // ISO
}

export interface Message {
  role: "user" | "assistant"
  content: string | unknown[]
  timestamp?: string
}

export interface LogEvent {
  type: string
  timestamp: string
  data: unknown             // raw Claude Code JSONL event
}

export interface ContextBundle {
  snapshotId: string
  taskId: string
  sessionId: string
  capturedAt: string        // ISO
  model: string
  tokenTotal: number
  source: "proxy" | "log_watcher" | "mcp"
  enriched: boolean
  files: ContextFile[]      // empty on proxy creation, filled by log watcher
  toolCalls: ToolCall[]     // partial on proxy, complete after log watcher
  messages: Message[]       // from proxy messages array
  reasoning?: string        // from thinking blocks (proxy) or log watcher
  logEvents: LogEvent[]     // raw JSONL events, empty until log watcher runs
}

Also add to src/types/api.ts:
  export interface ApiError {
    error: string
    message: string
    details?: unknown
  }

  export type SnapshotSource = "proxy" | "log_watcher" | "mcp"
```

---

## Prompt 2.2 — Bundle service (R2 read/write)

```
Create src/services/bundle.service.ts:

Import: { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
Import: { r2, R2_BUCKET } from "../r2"
Import: { ContextBundle } from "../types/bundle"

export async function writeBundle(snapshotId: string, bundle: ContextBundle): Promise<string> {
  const key = `bundles/${snapshotId}.json`
  const body = JSON.stringify(bundle)
  try {
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json"
    }))
    return key
  } catch (err) {
    throw new Error(`R2_WRITE_FAILED: ${(err as Error).message}`)
  }
}

export async function readBundle(r2Key: string): Promise<ContextBundle> {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: r2Key }))
    const body = await res.Body?.transformToString()
    if (!body) throw new Error("Empty body from R2")
    return JSON.parse(body) as ContextBundle
  } catch (err) {
    throw new Error(`R2_READ_FAILED: ${(err as Error).message}`)
  }
}

export async function mergeBundle(r2Key: string, enrichment: {
  files?: ContextFile[]
  toolCalls?: ToolCall[]
  logEvents?: LogEvent[]
  reasoning?: string
}): Promise<void> {
  const existing = await readBundle(r2Key)
  const merged: ContextBundle = {
    ...existing,
    enriched: true,
    files: enrichment.files ?? existing.files,
    toolCalls: enrichment.toolCalls ?? existing.toolCalls,
    logEvents: [...existing.logEvents, ...(enrichment.logEvents ?? [])],
    reasoning: enrichment.reasoning ?? existing.reasoning,
  }
  await writeBundle(existing.snapshotId, merged)
}

All errors must throw with a typed message string starting with an error code (R2_WRITE_FAILED, R2_READ_FAILED).
Routes catch these and return 502 upstream_error.
```

---

## Prompt 2.3 — Snapshot service

```
Create src/services/snapshot.service.ts:

Import: db, bundle.service, tiktoken, types

export async function createSnapshot(params: {
  taskId: string
  label: string
  bundle: ContextBundle
  userId: string
}): Promise<Snapshot> {
  // 1. Validate task exists and belongs to userId (via task.session.userId)
  const task = await db.task.findUnique({
    where: { id: params.taskId },
    include: { session: true }
  })
  if (!task || task.session.userId !== params.userId) {
    throw new Error("NOT_FOUND: Task not found")
  }

  // 2. Count tokens (use bundle.tokenTotal if already set, else count messages)
  const tokenTotal = params.bundle.tokenTotal || countTokens(params.bundle)

  // 3. Write bundle to R2
  const bundleWithId = { ...params.bundle, snapshotId: "pending", tokenTotal }
  const snapshotId = generateId()  // use nanoid
  bundleWithId.snapshotId = snapshotId
  const r2Key = await writeBundle(snapshotId, bundleWithId)

  // 4. Create Snapshot record in Postgres
  const snapshot = await db.snapshot.create({
    data: {
      id: snapshotId,
      taskId: params.taskId,
      label: params.label,
      tokenTotal,
      model: params.bundle.model,
      source: params.bundle.source,
      r2Key,
    }
  })

  return snapshot
}

export async function getSnapshot(snapshotId: string, userId: string): Promise<{
  snapshot: Snapshot
  bundle: ContextBundle
}> {
  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } }
  })
  if (!snapshot || snapshot.task.session.userId !== userId) {
    throw new Error("NOT_FOUND: Snapshot not found")
  }
  const bundle = await readBundle(snapshot.r2Key)
  return { snapshot, bundle }
}

export async function enrichSnapshot(params: {
  snapshotId: string
  enrichment: { files?: ContextFile[], toolCalls?: ToolCall[], logEvents?: LogEvent[], reasoning?: string }
  userId: string
}): Promise<void> {
  const snapshot = await db.snapshot.findUnique({
    where: { id: params.snapshotId },
    include: { task: { include: { session: true } } }
  })
  if (!snapshot || snapshot.task.session.userId !== params.userId) {
    throw new Error("NOT_FOUND: Snapshot not found")
  }

  // Check enrichment window
  const windowMs = Number(config.ENRICH_WINDOW_SECONDS) * 1000
  const age = Date.now() - snapshot.createdAt.getTime()
  if (age > windowMs) {
    throw new Error("ENRICH_WINDOW_EXPIRED: Enrichment window has closed")
  }

  await mergeBundle(snapshot.r2Key, params.enrichment)
  await db.snapshot.update({
    where: { id: params.snapshotId },
    data: { enriched: true, enrichedAt: new Date() }
  })
}

Helper: countTokens(bundle: ContextBundle): number
  Use tiktoken to count tokens in messages array
  Sum with file tokenCounts
  Return total

Helper: generateId(): string
  Use nanoid(21) for IDs
```

---

## Prompt 2.4 — Snapshot routes

```
Create src/routes/snapshots.ts. Mount in index.ts.

POST /v1/tasks/:taskId/snapshots
  Zod body:
    label: z.string().min(1).max(200)
    bundle: z.object({
      model: z.string(),
      tokenTotal: z.number().optional(),
      source: z.enum(["proxy", "log_watcher", "mcp"]).default("proxy"),
      files: z.array(z.any()).default([]),
      toolCalls: z.array(z.any()).default([]),
      messages: z.array(z.any()),
      reasoning: z.string().optional(),
      logEvents: z.array(z.any()).default([]),
    })
  Call: snapshot.service.createSnapshot
  On "NOT_FOUND" error → 404
  On "R2_WRITE_FAILED" error → 502 upstream_error
  Return 201: { id, taskId, label, tokenTotal, source, enriched, createdAt }

GET /v1/sessions/:sessionId/snapshots
  Validate session ownership → 404 if not
  Fetch all snapshots across all tasks in session
  Join through: session → tasks → snapshots
  Order: createdAt desc
  Query params: limit (default 20, max 100), cursor
  Return 200: { data: SnapshotMeta[], nextCursor }
  SnapshotMeta = snapshot fields WITHOUT bundle (metadata only)

GET /v1/snapshots/:id
  Call: snapshot.service.getSnapshot
  On "NOT_FOUND" → 404
  On "R2_READ_FAILED" → 502
  Return 200: { ...snapshotMetadata, bundle: ContextBundle }

GET /v1/snapshots/:id/bundle
  Same as above but return only the bundle JSON, no metadata wrapper

Mount in index.ts:
  app.route("/v1", snapshotsRouter)
```

---

## Prompt 2.5 — Sprint 2 verification

```
Create tests/snapshots.test.ts:

Test setup: create a session and task using the seeded test_key_dev user.

test("POST /v1/tasks/:id/snapshots creates snapshot", async () => {
  // POST a snapshot with a minimal bundle
  // Assert 201, id defined, source === "proxy", enriched === false
})

test("GET /v1/snapshots/:id returns bundle", async () => {
  // Create snapshot, then GET it
  // Assert bundle.messages is returned
  // Assert bundle.files is []
})

test("GET /v1/snapshots/:id wrong user → 404", async () => {
  // Create snapshot as user A, GET with user B key
  // Assert 404
})

Then manually verify:
  - POST creates a file in R2 at bundles/{snapshotId}.json
  - GET /v1/snapshots/:id/bundle returns raw ContextBundle JSON
  - R2 key format is correct
  - source field is "proxy" by default
  - enriched field is false by default

Run: npm test
Fix all failures before Sprint 3.
```

---

---
