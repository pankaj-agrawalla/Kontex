# Kontex Backend — Build Guide
### VSCode + Claude Code CLI · Hono · PostgreSQL · R2 · Qdrant · Railway
### Proxy-first · Log Watcher secondary · MCP advanced

---

## 0. What You Are Building

Kontex is a **task-state persistence engine for agentic workflows**.

It is not a memory store. It is not a chat logger. It is a state machine with audit trail.

**Two jobs:**
1. **Capture** — intercept agent context state via HTTP proxy (primary), enrich via Claude Code log file watching (secondary), or accept explicit checkpoints via MCP tools (advanced)
2. **Restore** — serve snapshot data back to agents for rollback, to the dashboard for inspection, to developers for semantic search

**The one invariant that must never be violated:**
Snapshots are immutable once finalized. Rollback creates a new snapshot — it never deletes or mutates history.

---

## 1. Write Path Hierarchy

```
PRIMARY    HTTP Proxy       zero friction, any runtime, change one line
SECONDARY  Log Watcher      Claude Code disk logs, enriches proxy snapshots
ADVANCED   MCP Tools        explicit named checkpoints, power users only
```

The proxy creates snapshot skeletons from the API message stream. The log watcher reads Claude Code's JSONL session files on disk and enriches those skeletons with file contents, full tool I/O, and reasoning traces. MCP adds voluntary named checkpoints on top. MCP is never required.

---

## 2. Architecture

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

---

## 3. Data Model

```
User → ApiKey[]
     → Session[]
          └── Task[] (tree via parentTaskId)
                └── Snapshot[]
                      └── ContextBundle (R2 JSON blob)

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

## 4. Tech Stack

| Concern | Choice |
|---|---|
| Framework | Hono + @hono/node-server |
| ORM | Prisma |
| Database | PostgreSQL (Railway) |
| Object storage | Cloudflare R2 (S3-compatible) |
| Cache / Queue | Redis (Railway) |
| Vector store | Qdrant Cloud |
| Embeddings | Voyage AI voyage-code-3 |
| Validation | Zod |
| Token counting | tiktoken |
| Log watching | chokidar + tail-file-stream |
| Language | TypeScript strict |

---

## 5. Prerequisites

```bash
node -v    # >= 20.x
npm -v     # >= 10.x

npm install -g @anthropic-ai/claude-code
npm install -g @railway/cli
npm install -g wrangler

docker --version
```

VSCode extensions: **REST Client**, **Prisma**, **ESLint**, **DotENV**

---

## 6. Project Scaffold

```bash
mkdir kontex-api && cd kontex-api
npm init -y

npm install hono @hono/node-server
npm install @prisma/client
npm install @aws-sdk/client-s3
npm install ioredis
npm install voyageai
npm install @qdrant/js-client-rest
npm install zod nanoid tiktoken
npm install chokidar tail-file-stream

npm install -D prisma typescript tsx @types/node dotenv-cli vitest

npx tsc --init
npx prisma init
code .
```

---

## 7. Project Structure

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
│   ├── sessions.test.ts
│   ├── snapshots.test.ts
│   ├── proxy.test.ts
│   └── enrich.test.ts
├── docs/
│   ├── quickstart.md
│   ├── log-watcher.md
│   ├── mcp-advanced.md
│   └── data-model.md
├── .env / .env.example
├── package.json
├── tsconfig.json
└── railway.toml
```

---

## 8. Environment Variables

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

## 9. Package Scripts

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

## 10. Local Dev

```bash
docker run -d --name kontex-pg \
  -e POSTGRES_DB=kontex -e POSTGRES_USER=kontex -e POSTGRES_PASSWORD=kontex \
  -p 5432:5432 postgres:16

docker run -d --name kontex-redis -p 6379:6379 redis:7

npx prisma migrate dev --name init
npm run dev
```

---

## 11. Coding Standards

Apply in every file, every sprint.

- **TypeScript strict.** No `any`. No `ts-ignore`. All functions have explicit return types.
- **Zod validates every request body** at route level before reaching service layer.
- **Services are pure.** No Hono context in service layer. Receive `userId` explicitly for ownership checks.
- **Services do not call other services.** Routes orchestrate.
- **Ownership always checked.** A user must never receive another user's data. Return `404` (not `403`) when a resource is not found or belongs to another user — do not reveal existence.
- **R2 errors → `502`.** Never crash the process on R2 failure.
- **Proxy snapshot is always async.** Never awaited in request cycle. Anthropic response must return even if Kontex snapshot throws.
- **Snapshots are immutable.** Once `enrichedAt` is set and enrichment window has passed, the bundle is sealed. Never overwrite a sealed bundle.
- **Rollback creates, never deletes.** New snapshot record, new R2 blob. History is sacred.
- **Error shape everywhere:**
  ```json
  { "error": "snake_case_code", "message": "Human readable", "details": {} }
  ```
- **Standard codes:** `unauthorized` 401, `forbidden` 403, `not_found` 404, `validation_error` 400, `rate_limit_exceeded` 429, `upstream_error` 502, `internal_error` 500.
- **Never log API key values.**
- **R2 key format:** `bundles/{snapshotId}.json`

---

## 12. Full API Reference

```
# Keys
POST   /v1/keys
GET    /v1/keys
DELETE /v1/keys/:id

# Sessions
POST   /v1/sessions
GET    /v1/sessions
GET    /v1/sessions/:id
PATCH  /v1/sessions/:id
DELETE /v1/sessions/:id

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

# Dashboard
GET    /v1/sessions/:id/graph
GET    /v1/sessions/:id/diff?from=&to=
GET    /v1/sessions/:id/snapshots/timeline
GET    /v1/usage
GET    /v1/search?q=

# Proxy (PRIMARY)
POST   /proxy/v1/messages

# MCP (ADVANCED)
POST   /mcp

# System
GET    /health
```

---

---

# SPRINT 1 — Foundation

**Goal:** Running Hono server, PostgreSQL schema, API key auth, full CRUD for sessions and tasks. Nothing else. No snapshots yet.

**Done criteria:**
- [ ] `npm run dev` starts without errors
- [ ] `GET /health` → `{ status: "ok", ts, version: "0.1.0" }`
- [ ] Prisma migrations run, all tables in Studio
- [ ] Request without auth → 401
- [ ] Session + task CRUD all return correct status codes and shapes
- [ ] Accessing another user's session → 404
- [ ] All errors follow `{ error, message }` shape, no stack traces
- [ ] `npm test` passes

---

## Prompt 1.1 — Bootstrap

```
Set up the Kontex API project from scratch.

1. Create package.json and install all dependencies:
   npm install hono @hono/node-server @prisma/client @aws-sdk/client-s3 ioredis voyageai @qdrant/js-client-rest zod nanoid tiktoken chokidar tail-file-stream
   npm install -D prisma typescript tsx @types/node dotenv-cli vitest

2. Create tsconfig.json:
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "CommonJS",
       "moduleResolution": "node",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "outDir": "dist",
       "rootDir": "src"
     },
     "include": ["src/**/*", "watcher/**/*"]
   }

3. Run: npx prisma init

4. Create the full directory structure from the build guide section 7.
   Placeholder empty files for everything not built yet.

5. Create .env.example with all variables from build guide section 8.

6. Set package.json scripts exactly as in build guide section 9.

7. Create src/index.ts: minimal Hono app, GET /health returns
   { status: "ok", ts: new Date().toISOString(), version: "0.1.0" }

Verify: npm run dev starts, curl http://localhost:3000/health returns the health object.
```

---

## Prompt 1.2 — Config + singletons

```
Create the four singleton/config files. Every subsequent sprint imports these.

src/config.ts:
  - Use Zod to validate all env vars
  - Required (throw on missing with message "Missing required env var: {NAME}"):
    PORT, NODE_ENV, DATABASE_URL, REDIS_URL,
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME, R2_ENDPOINT, API_KEY_SECRET
  - Optional (use defaults):
    QDRANT_URL="", QDRANT_API_KEY="", QDRANT_COLLECTION="kontex_snapshots",
    VOYAGE_API_KEY="", ANTHROPIC_API_URL="https://api.anthropic.com",
    ENRICH_WINDOW_SECONDS="60"
  - Export typed `config` object

src/db.ts:
  - Prisma singleton, export as `db`
  - Dev: log queries. Prod: log errors only.
  - Use global pattern to prevent duplicate instances in tsx watch:
    const globalForPrisma = global as unknown as { prisma: PrismaClient }
    export const db = globalForPrisma.prisma || new PrismaClient(...)
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db

src/redis.ts:
  - ioredis singleton, export as `redis`
  - Connect on import using config.REDIS_URL
  - On error: log warning, do NOT crash (Redis optional in Sprint 1)
  - Export `isRedisReady: boolean` updated on connect/error events

src/r2.ts:
  - S3Client from @aws-sdk/client-s3, export as `r2`
  - endpoint: config.R2_ENDPOINT, region: "auto"
  - credentials: { accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY }
  - Also export: R2_BUCKET = config.R2_BUCKET_NAME
  - Lazy — no connection test on import

Verify: import all four in index.ts, npm run dev starts cleanly with no errors.
```

---

## Prompt 1.3 — Prisma schema

```
Write the complete Prisma schema to prisma/schema.prisma:

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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

Then run:
  npx prisma migrate dev --name init
  npx prisma generate

Verify:
  - Migration runs without errors
  - npx prisma studio shows all five tables: User, ApiKey, Session, Task, Snapshot
  - All enums present
  - Seed via Studio: one User (email: dev@kontex.local), one ApiKey (key: "test_key_dev", active: true)
```

---

## Prompt 1.4 — Auth + logger middleware

```
Create src/middleware/auth.ts:

Behavior:
  1. Read Authorization header, expect "Bearer {key}". Missing or malformed → 401.
  2. db.apiKey.findUnique({ where: { key } }) — must exist AND active === true → else 401
  3. Fire-and-forget lastUsed update:
       db.apiKey.update({ where: { key }, data: { lastUsed: new Date() } })
       Do NOT await. Do not let its failure propagate.
  4. c.set("userId", apiKey.userId)
     c.set("apiKeyId", apiKey.id)
  5. await next()

On any failure: return 401 { error: "unauthorized", message: "Invalid or missing API key" }
Never log the key value.

Declare Hono Variables type in src/types/api.ts:
  export type Variables = { userId: string; apiKeyId: string }
Use it in index.ts: const app = new Hono<{ Variables: Variables }>()

Create src/middleware/logger.ts:
  Hono middleware that logs every request:
  Format: [2025-01-15T10:30:00.000Z] POST /v1/sessions → 201 (42ms)
  Measure duration with Date.now() before/after next()

Update src/index.ts:
  app.use("*", logger)
  app.use("/v1/*", auth)
  GET /health remains public (defined before the /v1/* middleware, or excluded explicitly)

Verify:
  curl http://localhost:3000/v1/sessions → 401
  curl http://localhost:3000/v1/sessions -H "Authorization: Bearer test_key_dev" → 200
  curl http://localhost:3000/health → 200 (no auth needed)
```

---

## Prompt 1.5 — Sessions routes

```
Create src/routes/sessions.ts. Mount at /v1/sessions in index.ts.

POST /v1/sessions
  Zod body: { name: z.string().min(1).max(200), description: z.string().max(500).optional() }
  Validation failure → 400 { error: "validation_error", message: "...", details: zodError.flatten() }
  Create session: status ACTIVE, userId from c.get("userId")
  Return 201: { id, name, description, status, createdAt, updatedAt }

GET /v1/sessions
  Query: status? (enum), limit (number, default 20 max 100), cursor (string)
  Filter: userId = c.get("userId") always
  Cursor pagination: if cursor, add { id: { lt: cursor } } to where
  Order: updatedAt desc
  Return 200: { data: Session[], nextCursor: string | null }
  nextCursor = last item's id if data.length === limit, else null

GET /v1/sessions/:id
  Find where id = params.id AND userId = c.get("userId")
  Not found or wrong user → 404 { error: "not_found", message: "Session not found" }
  Include _count: { select: { tasks: true } }
  Return 200: { id, name, description, status, taskCount, createdAt, updatedAt }

PATCH /v1/sessions/:id
  Zod body: { name?: string, description?: string, status?: SessionStatus }
  Find + validate ownership → 404 if missing or wrong user
  Update only provided fields
  Return 200: same shape as GET /:id response

DELETE /v1/sessions/:id
  Find + validate ownership → 404 if missing or wrong user
  Soft delete: set status COMPLETED (do not delete row)
  Return 204 no body

Rules:
  - Routes only: parse → DB call → return. No business logic.
  - Ownership check: always query with userId filter, never trust the id alone.
  - Errors follow { error, message } shape always.
```

---

## Prompt 1.6 — Tasks routes

```
Create src/routes/tasks.ts. Mount in index.ts.

POST /v1/sessions/:sessionId/tasks
  Zod body: { name: z.string().min(1).max(200), parentTaskId: z.string().optional() }
  Validate: session exists AND session.userId === c.get("userId") → 404 if not
  If parentTaskId: validate parent task exists AND parent.sessionId === sessionId → 400 if not
  Create task: status PENDING
  Return 201: { id, sessionId, parentTaskId, name, status, createdAt }

GET /v1/sessions/:sessionId/tasks
  Validate session ownership → 404 if not
  Fetch all tasks for session, ordered createdAt asc
  Build nested tree in application code (not SQL):
    type TaskNode = Task & { children: TaskNode[] }
    root nodes = tasks where parentTaskId === null
    attach children recursively
  Return 200: { data: TaskNode[] }

GET /v1/tasks/:id
  Fetch task, include task.session
  Validate task.session.userId === c.get("userId") → 404 if not
  Include _count: { select: { snapshots: true } }
  Return 200: { id, sessionId, parentTaskId, name, status, snapshotCount, createdAt, updatedAt }

PATCH /v1/tasks/:id
  Zod body: { name?: z.string().optional(), status?: TaskStatus.optional() }
  Fetch task + session, validate ownership → 404 if not
  Update only provided fields
  Return 200: same shape as GET /:id (with snapshotCount)

Mount routing in index.ts:
  sessionsRouter handles: POST /v1/sessions/:id/tasks and GET /v1/sessions/:id/tasks
  tasksRouter handles: GET /v1/tasks/:id and PATCH /v1/tasks/:id
```

---

## Prompt 1.7 — Tests + Sprint 1 verification

```
Create tests/sessions.test.ts with vitest.

Use fetch against http://localhost:3000. Start the server before running tests.
Use the seeded test_key_dev API key for auth.

Write these tests:

test("POST /v1/sessions happy path", async () => {
  const res = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test session" })
  })
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.id).toBeDefined()
  expect(body.status).toBe("ACTIVE")
})

test("POST /v1/sessions missing name → 400", async () => {
  const res = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({})
  })
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body.error).toBe("validation_error")
})

test("GET /v1/sessions without auth → 401", async () => {
  const res = await fetch("http://localhost:3000/v1/sessions")
  expect(res.status).toBe(401)
  const body = await res.json()
  expect(body.error).toBe("unauthorized")
})

test("GET /v1/sessions/:id wrong user → 404", async () => {
  // Seed a second ApiKey for a second user in the test setup
  // Create session as user A, attempt GET as user B
  // Assert 404
})

Run: npm test

Then manually verify every Sprint 1 done criteria item. Fix all failures before Sprint 2.
```

---

---

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

# SPRINT 3 — HTTP Proxy (Primary Write Path)

**Goal:** Transparent Anthropic-compatible proxy. Developer changes one line and adds one header. Auto-snapshots on configurable triggers. The Anthropic response is always returned identically — snapshot is async and never adds latency. This is the default onboarding path.

**Done criteria:**
- [ ] `POST /proxy/v1/messages` forwards request to Anthropic and returns identical response
- [ ] Response overhead < 50ms (async snapshot)
- [ ] Auto-snapshot fires at correct trigger — Snapshot record appears in DB
- [ ] Snapshot failure does NOT affect the Anthropic response
- [ ] Missing `X-Kontex-Session-Id` → proxy forwards, no snapshot, warning logged
- [ ] Snapshot `source` is `"proxy"`
- [ ] `files` and `logEvents` in bundle are `[]` on proxy creation
- [ ] `docs/quickstart.md` complete
- [ ] Test script works end-to-end with real Anthropic API key

---

## Prompt 3.1 — Proxy service

```
Create src/services/proxy.service.ts:

import fetch from "node-fetch" (or native fetch in Node 20+)
import { config } from "../config"
import { ContextBundle, ToolCall, Message } from "../types/bundle"

Interface for proxy options:
export interface ProxyOptions {
  sessionId: string
  userId: string
  trigger: "every_n_turns" | "on_tool_end" | "token_threshold"
  triggerN: number
}

export function extractBundleFromProxy(
  requestBody: unknown,
  responseBody: unknown
): Omit<ContextBundle, "snapshotId" | "taskId" | "sessionId" | "capturedAt"> {
  // Parse requestBody as Anthropic /v1/messages request
  // Parse responseBody as Anthropic /v1/messages response
  //
  // Extract:
  //   messages: requestBody.messages mapped to Message[]
  //   model: requestBody.model
  //   toolCalls: from response content blocks where type === "tool_use"
  //              map to ToolCall[] with status "success", timestamp now
  //   reasoning: from response content blocks where type === "thinking"
  //              join all thinking.thinking strings
  //   tokenTotal: response.usage.input_tokens + response.usage.output_tokens
  //   source: "proxy"
  //   enriched: false
  //   files: []
  //   logEvents: []
  //
  // Return the partial bundle
}

export function shouldSnapshot(
  requestBody: unknown,
  responseBody: unknown,
  options: ProxyOptions
): boolean {
  // every_n_turns: count assistant messages in requestBody.messages
  //   snapshot if count % options.triggerN === 0
  // on_tool_end: true if response contains any tool_use content blocks
  // token_threshold: true if tokenTotal >= options.triggerN
  // return false if sessionId is missing
}

export async function forwardToAnthropic(
  requestBody: unknown,
  anthropicApiKey: string
): Promise<{ responseBody: unknown; status: number; headers: Record<string, string> }> {
  const res = await fetch(`${config.ANTHROPIC_API_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anthropicApiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  })
  const responseBody = await res.json()
  const headers: Record<string, string> = {}
  res.headers.forEach((val, key) => { headers[key] = val })
  return { responseBody, status: res.status, headers }
}
```

---

## Prompt 3.2 — Proxy route

```
Create src/routes/proxy.ts:

POST /proxy/v1/messages

Auth: read X-Kontex-Api-Key header (NOT the standard Authorization header — that's the Anthropic key)
  Use same ApiKey lookup logic as auth middleware
  If missing or invalid → still forward to Anthropic, but do not snapshot
  Attach userId if found

Parse headers:
  anthropicApiKey = Authorization header value (strip "Bearer ")
  sessionId = X-Kontex-Session-Id header (optional)
  trigger = X-Kontex-Snapshot-Trigger header (default: "every_n_turns")
  triggerN = parseInt(X-Kontex-Snapshot-N) (default: 5)

Steps:
  1. Parse request body as JSON
  2. Forward to Anthropic via forwardToAnthropic(requestBody, anthropicApiKey)
  3. Return the Anthropic response IMMEDIATELY — do not await snapshot

  4. ASYNC (do not await, fire-and-forget):
     If sessionId and userId are present:
       a. Check shouldSnapshot(requestBody, responseBody, { sessionId, userId, trigger, triggerN })
       b. If true:
          - Find or create a default task for this session:
            find task where sessionId = sessionId AND name = "proxy-auto" AND status = ACTIVE
            if not found, create it
          - Extract bundle from extractBundleFromProxy(requestBody, responseBody)
          - Set bundle.taskId, bundle.sessionId, bundle.capturedAt
          - Call snapshot.service.createSnapshot
       c. Log any errors — do NOT throw, do NOT affect the response

Rule: The Anthropic response MUST be returned before any snapshot logic completes.
      Wrap the entire async block in try/catch. If it throws, just console.error and continue.

Mount in index.ts:
  app.route("/proxy", proxyRouter)
  Note: /proxy/* routes do NOT use the standard auth middleware
  They handle their own auth via X-Kontex-Api-Key header
```

---

## Prompt 3.3 — Proxy integration test

```
Create tests/proxy.test.ts:

test("POST /proxy/v1/messages returns Anthropic response unchanged", async () => {
  // Use process.env.ANTHROPIC_API_KEY for the real key
  // Skip test if key not set: if (!process.env.ANTHROPIC_API_KEY) return
  //
  // Send a minimal message to /proxy/v1/messages:
  //   Authorization: Bearer {anthropic key}
  //   X-Kontex-Api-Key: test_key_dev
  //   X-Kontex-Session-Id: {a real session id}
  //   Body: { model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "Say hi" }] }
  //
  // Assert: response.status === 200
  // Assert: response body has "content" array (valid Anthropic response shape)
  // Assert: response arrived in < 10 seconds
})

test("POST /proxy/v1/messages without session id still works", async () => {
  // No X-Kontex-Session-Id header
  // Assert: still returns 200 Anthropic response
  // Assert: no snapshot created in DB
})

test("POST /proxy/v1/messages snapshot created after 5 turns", async () => {
  // Build a messages array with 5 pairs (10 messages total)
  // Send with X-Kontex-Snapshot-Trigger: every_n_turns and X-Kontex-Snapshot-N: 5
  // Wait 500ms for async snapshot to complete
  // Assert: snapshot exists in DB with source === "proxy"
})

Also create a standalone test script at tests/proxy-manual.ts:
  A simple Node.js script developers can run to manually verify the proxy:
  - Creates a session via /v1/sessions
  - Points Anthropic SDK baseURL to http://localhost:3000/proxy
  - Sends 3 messages in conversation
  - Prints the snapshots created
  Run: tsx tests/proxy-manual.ts
```

---

## Prompt 3.4 — Quickstart docs

```
Write docs/quickstart.md — the primary developer onboarding document.

Structure:
  # Kontex Quickstart

  ## What you get
  Brief: automatic agent context snapshots, time-travel, rollback. Zero code change beyond baseURL.

  ## Step 1: Create an account and get your API key
  curl example for POST /v1/keys

  ## Step 2: Create a session
  curl example for POST /v1/sessions
  Show the response, highlight the id field — you'll need this as your session ID

  ## Step 3: Point your agent at the Kontex proxy
  Show before/after for three runtimes:
    Node.js (Anthropic SDK):
      Before: new Anthropic()
      After:  new Anthropic({ baseURL: "https://proxy.usekontex.com", defaultHeaders: { "X-Kontex-Api-Key": "...", "X-Kontex-Session-Id": "..." } })
    Python (Anthropic SDK):
      Before: anthropic.Anthropic()
      After:  anthropic.Anthropic(base_url="https://proxy.usekontex.com", default_headers={...})
    curl:
      Before: curl https://api.anthropic.com/v1/messages
      After:  curl https://proxy.usekontex.com/proxy/v1/messages -H "X-Kontex-Api-Key: ..." -H "X-Kontex-Session-Id: ..."

  ## Step 4: Run your agent
  Snapshots are created automatically. Default: every 5 assistant turns.

  ## Step 5: View snapshots in the dashboard
  Link to dashboard. Brief description of what they'll see.

  ## Configuring snapshot triggers
  Table showing X-Kontex-Snapshot-Trigger options with examples.

  ## Next: Enriching snapshots with the log watcher
  Brief teaser + link to docs/log-watcher.md
```

---

---

# SPRINT 4 — Log Watcher (Secondary Write Path)

**Goal:** A CLI process (`npx kontex-watch`) that tails Claude Code's JSONL session logs, parses events, and pushes enrichment to the snapshot API. The proxy creates skeleton snapshots; the log watcher fills them with file contents, full tool I/O, and reasoning traces.

**Done criteria:**
- [ ] `npm run watch` starts and tails `~/.claude/projects/` directory
- [ ] Parser correctly extracts file reads, tool calls, and reasoning from Claude Code JSONL
- [ ] `POST /v1/snapshots/:id/enrich` within window → 200, enriched: true, bundle updated in R2
- [ ] `POST /v1/snapshots/:id/enrich` after 60s → 409 window expired
- [ ] ContextBundle files[] and toolCalls[] populated after enrichment
- [ ] Log watcher failure does NOT affect proxy operation
- [ ] `docs/log-watcher.md` complete

---

## Prompt 4.1 — Enrich endpoint + service

```
Create src/services/enrich.service.ts:

Re-export enrichSnapshot from snapshot.service (or implement here if cleaner).

The service already exists in snapshot.service.ts from Sprint 2 Prompt 2.3.
This file is a thin wrapper that formats enrichment service errors for route use.

export async function applyEnrichment(params: {
  snapshotId: string
  userId: string
  files: ContextFile[]
  toolCalls: ToolCall[]
  logEvents: LogEvent[]
  reasoning?: string
}): Promise<{ snapshotId: string; enriched: true; enrichedAt: Date }> {
  try {
    await enrichSnapshot({
      snapshotId: params.snapshotId,
      enrichment: {
        files: params.files,
        toolCalls: params.toolCalls,
        logEvents: params.logEvents,
        reasoning: params.reasoning,
      },
      userId: params.userId,
    })
    const updated = await db.snapshot.findUnique({ where: { id: params.snapshotId } })
    return { snapshotId: params.snapshotId, enriched: true, enrichedAt: updated!.enrichedAt! }
  } catch (err) {
    throw err  // re-throw, let route handle
  }
}

Create src/routes/enrich.ts:

POST /v1/snapshots/:id/enrich
  Auth: same X-Kontex-Api-Key header as proxy route (log watcher uses API key auth)
  Zod body:
    files: z.array(ContextFileSchema).default([])
    toolCalls: z.array(ToolCallSchema).default([])
    logEvents: z.array(LogEventSchema).default([])
    reasoning: z.string().optional()
  On "NOT_FOUND" → 404
  On "ENRICH_WINDOW_EXPIRED" → 409 { error: "enrich_window_expired", message: "Enrichment window has closed for this snapshot" }
  On "R2_READ_FAILED" or "R2_WRITE_FAILED" → 502
  Return 200: { snapshotId, enriched: true, enrichedAt }

Mount in index.ts under /v1.
```

---

## Prompt 4.2 — JSONL parser

```
Create watcher/parser.ts:

Claude Code writes JSONL events to ~/.claude/projects/{hash}/*.jsonl
Each line is one JSON object. Key event shapes to handle:

export interface ParsedToolUse {
  type: "tool_use"
  id: string
  tool: string
  input: unknown
  timestamp: string
}

export interface ParsedToolResult {
  type: "tool_result"
  toolUseId: string
  tool: string
  output: string
  timestamp: string
}

export interface ParsedAssistantTurn {
  type: "assistant"
  thinking?: string
  text?: string
  toolUses: ParsedToolUse[]
  timestamp: string
}

export interface ParsedUserTurn {
  type: "user"
  text: string
  timestamp: string
}

export type ParsedEvent =
  | ParsedToolUse
  | ParsedToolResult
  | ParsedAssistantTurn
  | ParsedUserTurn
  | { type: "unknown"; raw: unknown }

export function parseLine(line: string): ParsedEvent | null {
  // Try to parse JSON
  // If parse fails: return null (skip malformed lines)
  // Pattern match on common Claude Code event shapes:
  //   { type: "assistant", message: { content: [...] } }
  //     → extract thinking blocks, text blocks, tool_use blocks
  //   { type: "user", message: { content: [...] } }
  //     → extract text
  //   Raw tool_use / tool_result events if present
  // Return typed ParsedEvent or { type: "unknown", raw }
}

export function extractFilesFromEvents(events: ParsedEvent[]): ContextFile[] {
  // Find tool_result events where tool === "Read" or tool === "read_file"
  // Extract path from matching tool_use input
  // Extract content from tool_result output
  // Compute contentHash: sha256 of content
  // Count tokens with tiktoken
  // Return ContextFile[]
}

export function extractToolCallsFromEvents(events: ParsedEvent[]): ToolCall[] {
  // Pair ParsedToolUse with matching ParsedToolResult (by toolUseId)
  // Map to ToolCall[]
  // Mark status "success" if result found, "error" if not
}

export function extractReasoningFromEvents(events: ParsedEvent[]): string | undefined {
  // Collect all thinking strings from ParsedAssistantTurn events
  // Join with "\n\n"
  // Return undefined if none
}
```

---

## Prompt 4.3 — Log file tailer

```
Create watcher/tail.ts:

import chokidar from "chokidar"
import { createReadStream } from "fs"
import { parseLine, ParsedEvent } from "./parser"

const CLAUDE_LOG_DIR = path.join(os.homedir(), ".claude", "projects")

export interface TailOptions {
  onEvent: (event: ParsedEvent, filePath: string) => void
  onNewFile: (filePath: string) => void
}

export function startWatcher(options: TailOptions): () => void {
  // Watch CLAUDE_LOG_DIR for .jsonl files
  // Use chokidar to detect new files and changes

  const watcher = chokidar.watch(`${CLAUDE_LOG_DIR}/**/*.jsonl`, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  })

  const filePositions = new Map<string, number>()  // track read position per file

  watcher.on("add", (filePath) => {
    filePositions.set(filePath, 0)
    options.onNewFile(filePath)
    readNewLines(filePath, filePositions, options.onEvent)
  })

  watcher.on("change", (filePath) => {
    readNewLines(filePath, filePositions, options.onEvent)
  })

  return () => watcher.close()
}

function readNewLines(
  filePath: string,
  positions: Map<string, number>,
  onEvent: (event: ParsedEvent, filePath: string) => void
): void {
  // Read from last known position to end of file
  // Parse each new line with parseLine()
  // Emit non-null events via onEvent
  // Update position in map
}
```

---

## Prompt 4.4 — Watcher entry + push

```
Create watcher/push.ts:

export async function pushEnrichment(params: {
  snapshotId: string
  apiKey: string
  apiUrl: string
  files: ContextFile[]
  toolCalls: ToolCall[]
  logEvents: LogEvent[]
  reasoning?: string
}): Promise<"ok" | "expired" | "error"> {
  try {
    const res = await fetch(`${params.apiUrl}/v1/snapshots/${params.snapshotId}/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kontex-Api-Key": params.apiKey,
      },
      body: JSON.stringify({
        files: params.files,
        toolCalls: params.toolCalls,
        logEvents: params.logEvents,
        reasoning: params.reasoning,
      })
    })
    if (res.status === 200) return "ok"
    if (res.status === 409) return "expired"
    return "error"
  } catch {
    return "error"
  }
}

Create watcher/index.ts — the CLI entry point:

#!/usr/bin/env node
// Parse CLI args: --api-key, --session-id, --api-url (default: http://localhost:3000)
// If args missing, print usage and exit

// Start the log watcher
// Maintain a buffer of ParsedEvents per active file
// Poll GET /v1/sessions/:id/snapshots?limit=1 every 5 seconds
//   to detect the most recent proxy snapshot
// When a new snapshot is detected (id differs from last known):
//   extract files, toolCalls, reasoning from buffered events
//   call pushEnrichment with the new snapshot id
//   if "ok": log success, clear buffer
//   if "expired": log warning, clear buffer
//   if "error": log error, retain buffer for retry
// Print: "[kontex-watch] Watching ~/.claude/projects/ — enriching session {session_id}"

Add a bin entry to package.json:
  "bin": { "kontex-watch": "./dist/watcher/index.js" }
```

---

## Prompt 4.5 — Log watcher docs + verification

```
Write docs/log-watcher.md:

  # Kontex Log Watcher

  ## Why use the log watcher
  The proxy captures the API message stream. The log watcher reads Claude Code's
  local session files and adds:
    - Full file contents (not just paths)
    - Complete tool call inputs and outputs
    - Agent reasoning traces
  This makes snapshot rollback significantly more useful.

  ## What it reads
  Explain: ~/.claude/projects/{hash}/*.jsonl
  JSONL format, one event per line, written by Claude Code automatically.

  ## Setup
  npx kontex-watch --api-key=YOUR_KEY --session-id=YOUR_SESSION_ID
  Optional: --api-url=http://localhost:3000 (defaults to production)

  ## Running proxy + watcher together
  Terminal 1: your agent code (with proxy baseURL set)
  Terminal 2: npx kontex-watch --api-key=... --session-id=...

  ## What gets enriched
  Diagram or table: proxy captures X, watcher adds Y

  ## Enrichment window
  60 seconds. After that, enrichment is attached to the next snapshot.

Then verify manually:
  1. npm run watch --api-key=test_key_dev --session-id={valid session}
  2. Trigger a proxy snapshot
  3. Within 60s: verify POST /v1/snapshots/:id/enrich returns 200
  4. GET /v1/snapshots/:id — verify bundle.files[] is populated
  5. After 60s: verify POST /v1/snapshots/:id/enrich returns 409

Run: npm test (enrich.test.ts should pass)
```

---

---

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

# SPRINT 6 — MCP Server (Advanced Path)

**Goal:** MCP server for power users who want explicit checkpoint control on top of automatic proxy+watcher capture. Not required for basic usage. Documented as advanced.

**Done criteria:**
- [ ] MCP server responds to tool list request
- [ ] All 6 tools implemented and return correct shapes
- [ ] Snapshot from MCP has `source: "mcp"`
- [ ] All tools return descriptive error strings, not stack traces
- [ ] End-to-end verified in a live Claude Code session
- [ ] `docs/mcp-advanced.md` complete

---

## Prompt 6.1 — MCP server setup

```
Create src/mcp/server.ts:

Set up an MCP server using the @modelcontextprotocol/sdk package (add to dependencies):
  npm install @modelcontextprotocol/sdk

The MCP server exposes tools for explicit agent control.
It shares auth with the REST API — same ApiKey lookup.

Create src/routes/mcp.ts:
  Mount the MCP server at POST /mcp
  Read X-Kontex-Api-Key or Authorization header for auth
  Pass userId to all tool handlers

The MCP server handles tool discovery (list tools) and tool execution (call tool).
Keep server.ts as the setup/registration file.
Tool implementations live in mcp/tools/*.ts.
```

---

## Prompt 6.2 — MCP session + task tools

```
Create src/mcp/tools/session.tools.ts:

Tool: kontex_session_start
  Input schema: { name: string, description?: string }
  Handler: calls db.session.create with userId, returns { session_id, message: "Session started: {name}" }

Tool: kontex_session_pause
  Input schema: { session_id: string }
  Handler: validates ownership, sets status PAUSED, returns { success: true }

Tool: kontex_task_start
  Input schema: { session_id: string, name: string, parent_task_id?: string }
  Handler: validates session ownership, creates task with status ACTIVE
  Returns { task_id, message: "Task started: {name}" }

Tool: kontex_task_done
  Input schema: { task_id: string, status: "completed" | "failed" }
  Handler: validates ownership via task.session, updates task status
  Returns { success: true }

Register all four tools in src/mcp/server.ts.

Error handling for all tools:
  Catch service errors
  Return human-readable error string as tool result content
  Never expose stack traces or internal error codes in tool results
```

---

## Prompt 6.3 — MCP snapshot + rollback tools

```
Create src/mcp/tools/snapshot.tools.ts:

Tool: kontex_snapshot
  Input schema:
    task_id: string
    label: string
    files?: ContextFile[]
    tool_calls?: ToolCall[]
    messages?: Message[]
    reasoning?: string
    model?: string
  Handler:
    Build ContextBundle from inputs:
      source: "mcp"
      enriched: false
      tokenTotal: count from messages + files
      files: input.files ?? []
      toolCalls: input.tool_calls ?? []
      messages: input.messages ?? []
      logEvents: []
    Call snapshot.service.createSnapshot
  Returns { snapshot_id, token_total, message: "Snapshot saved: {label}" }

Create src/mcp/tools/rollback.tools.ts:

Tool: kontex_rollback
  Input schema: { snapshot_id: string }
  Handler: calls snapshot.service.rollbackToSnapshot
  Returns:
    {
      snapshot_id: rollbackSnapshotId,
      label: label,
      captured_at: capturedAt,
      bundle: bundle (full ContextBundle),
      message: "Restored to: {label}. Re-inject bundle.messages as your conversation history."
    }

Register both in src/mcp/server.ts.

The rollback tool message must clearly instruct the agent on how to re-inject context:
  "Restored to: {label}. To resume from this state:
   1. Use bundle.messages as your conversation history
   2. Re-open files listed in bundle.files
   3. bundle.toolCalls shows what was done up to this point"
```

---

## Prompt 6.4 — MCP docs + verification

```
Write docs/mcp-advanced.md:

  # Kontex MCP Tools (Advanced)

  ## When to use MCP
  The proxy + log watcher handle snapshots automatically.
  Use MCP when you want:
    - Named checkpoints at specific semantic moments
    - Explicit task structure (parent/child tasks)
    - Agent-initiated rollback ("this approach isn't working, go back")

  ## Setup
  Add to ~/.claude/mcp_servers.json:
  {
    "kontex": {
      "url": "https://api.usekontex.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KONTEX_API_KEY"
      }
    }
  }

  ## CLAUDE.md snippet
  Paste this in your project's CLAUDE.md to instruct the agent:

  "Kontex MCP tools are available for session state management:
  - Call kontex_session_start at the beginning of a new working session
  - Call kontex_task_start when beginning a discrete unit of work
  - Call kontex_snapshot after completing meaningful steps
  - Call kontex_rollback if the current approach is failing and you need to restore a prior state
  - Call kontex_task_done when a task completes or fails
  Always provide descriptive labels to kontex_snapshot — they appear in the dashboard."

  ## Tool reference
  Table: tool name, inputs, returns, when to call it

  ## Using MCP with proxy (recommended)
  Run both together: proxy auto-snapshots, MCP adds named checkpoints on top.

Then verify:
  1. Connect Claude Code to the MCP server at http://localhost:3000/mcp
  2. In a Claude Code session: call kontex_session_start → kontex_task_start → kontex_snapshot → kontex_rollback
  3. Verify snapshot in DB has source === "mcp"
  4. Verify rollback returns full bundle with re-injection message
  5. All tools return clean messages, no stack traces

Run: npm test
```

---

---

# SPRINT 7 — Dashboard API

**Goal:** All REST endpoints the Kontex Dashboard frontend needs. Task graph, context diff, snapshot timeline, usage stats.

**Done criteria:**
- [ ] `/graph` returns valid ReactFlow-ready JSON
- [ ] `/diff` returns typed diff with correct token delta
- [ ] `/timeline` returns ordered snapshots with source + enriched fields and token deltas
- [ ] `/usage` returns correct aggregated stats per user
- [ ] Dashboard frontend connects and renders from these endpoints

---

## Prompt 7.1 — Diff service

```
Create src/services/diff.service.ts:

import { ContextBundle, ContextFile, ToolCall, Message } from "../types/bundle"

export interface DiffResult {
  added: {
    files: ContextFile[]
    toolCalls: ToolCall[]
    messages: Message[]
  }
  removed: {
    files: ContextFile[]
    toolCalls: ToolCall[]
    messages: Message[]
  }
  tokenDelta: number
}

export function diffBundles(bundleA: ContextBundle, bundleB: ContextBundle): DiffResult {
  // Files: compare by path
  //   added = files in B where path not in A
  //   removed = files in A where path not in B
  const filePathsA = new Set(bundleA.files.map(f => f.path))
  const filePathsB = new Set(bundleB.files.map(f => f.path))

  // Tool calls: compare by timestamp
  //   Get latest timestamp in A. Calls in B after that timestamp = added.
  const latestATimestamp = bundleA.toolCalls.reduce(...)

  // Messages: compare by array index
  //   messages in B beyond bundleA.messages.length = added
  //   messages in A beyond bundleB.messages.length = removed

  // tokenDelta: bundleB.tokenTotal - bundleA.tokenTotal

  return { added, removed, tokenDelta }
}
```

---

## Prompt 7.2 — Dashboard routes

```
Create src/routes/dashboard.ts. Mount in index.ts under /v1.

GET /v1/sessions/:id/graph
  Validate session ownership → 404
  Fetch all tasks for session with snapshot count
  Build ReactFlow-compatible JSON:
    nodes: tasks mapped to:
      { id: task.id, data: { label: task.name, status: task.status, tokenTotal: sum of snapshot tokenTotals, snapshotCount }, position: { x: 300, y: index * 120 } }
    edges: tasks with parentTaskId mapped to:
      { id: "e_{parentId}_{childId}", source: parentTaskId, target: task.id, animated: task.status === "ACTIVE" || task.status === "PENDING" }
  Return 200: { nodes, edges }

GET /v1/sessions/:id/diff?from={snapshot_id}&to={snapshot_id}
  Validate session ownership
  Validate both snapshot ids belong to this session → 400 if not
  Read both bundles from R2
  Call diff.service.diffBundles
  Return 200: { added: { files, toolCalls, messages }, removed: { files, toolCalls, messages }, token_delta }

GET /v1/sessions/:id/snapshots/timeline
  Validate session ownership
  Fetch all snapshots across all tasks in session
  Order: createdAt asc
  Join with task name
  Compute tokenDelta per snapshot (diff from previous snapshot's tokenTotal, 0 for first)
  Return 200: [{
    id, label, taskId, taskName, source, enriched,
    tokenTotal, tokenDelta, createdAt
  }]

GET /v1/usage
  For c.get("userId"):
  Return 200: {
    total_sessions: count of sessions,
    active_sessions: count where status ACTIVE,
    total_snapshots: count of all snapshots,
    total_tokens_stored: sum of all snapshot tokenTotals,
    snapshots_this_month: count where createdAt >= start of current month,
    tokens_this_month: sum where createdAt >= start of current month
  }
  All counts scoped to the authenticated user via session.userId

Verify each endpoint returns correct data.
```

---

---

# SPRINT 8 — Semantic Search + Rate Limiting + Deploy

**Goal:** Snapshots indexed and semantically searchable. Rate limited. Error-standardized. API key management. Deployed to Railway.

**Done criteria:**
- [ ] Embed worker processes jobs from Redis
- [ ] `GET /v1/search?q=auth+bug` returns semantically relevant results
- [ ] Search results scoped to authenticated user
- [ ] Rate limiting returns 429 with retry_after
- [ ] API key CRUD works
- [ ] All errors follow standardized shape
- [ ] `railway up` deploys both services
- [ ] `GET /health` returns 200 in production
- [ ] All four docs complete

---

## Prompt 8.1 — Embed service + worker

```
Create src/services/embed.service.ts:

import { VoyageAIClient } from "voyageai"
import { QdrantClient } from "@qdrant/js-client-rest"
import { config } from "../config"
import { readBundle } from "./bundle.service"
import { db } from "../db"

const voyage = new VoyageAIClient({ apiKey: config.VOYAGE_API_KEY })
const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY })

export async function embedSnapshot(snapshotId: string): Promise<void> {
  // 1. Read snapshot + task + session from DB
  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } }
  })
  if (!snapshot) throw new Error("Snapshot not found")

  // 2. Read bundle from R2
  const bundle = await readBundle(snapshot.r2Key)

  // 3. Build embedding input string:
  //    "{label} | {taskName} | {sessionName}
  //     Files: {filePaths joined by comma}
  //     Tools: {toolNames joined by comma}
  //     Reasoning: {first 500 chars of reasoning}"
  const input = buildEmbedInput(snapshot, bundle)

  // 4. Call Voyage AI
  const result = await voyage.embed({ input: [input], model: "voyage-code-3" })
  const vector = result.data[0].embedding

  // 5. Upsert to Qdrant
  await qdrant.upsert(config.QDRANT_COLLECTION, {
    wait: true,
    points: [{
      id: snapshotId,
      vector,
      payload: {
        snapshotId, taskId: snapshot.taskId, sessionId: snapshot.task.sessionId,
        userId: snapshot.task.session.userId,
        label: snapshot.label, source: snapshot.source, createdAt: snapshot.createdAt.toISOString()
      }
    }]
  })

  // 6. Mark embedded
  await db.snapshot.update({ where: { id: snapshotId }, data: { embedded: true } })
}

Update snapshot.service.ts createSnapshot to push to Redis after creation:
  import { redis } from "../redis"
  // After db.snapshot.create:
  redis.rpush("kontex:embed_jobs", JSON.stringify({ snapshotId: snapshot.id }))
    .catch(err => console.error("Failed to queue embed job:", err))

Create src/workers/embed.worker.ts:

  import { redis } from "../r2"  // use a separate redis instance for blocking
  import { embedSnapshot } from "../services/embed.service"

  const MAX_RETRIES = 3

  async function processJob(raw: string, attempt = 1): Promise<void> {
    const { snapshotId } = JSON.parse(raw)
    try {
      await embedSnapshot(snapshotId)
      console.log(`[embed-worker] Embedded ${snapshotId}`)
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000
        await sleep(delay)
        await processJob(raw, attempt + 1)
      } else {
        console.error(`[embed-worker] Failed after ${MAX_RETRIES} attempts:`, snapshotId, err)
      }
    }
  }

  async function run(): Promise<void> {
    console.log("[embed-worker] Started")
    while (true) {
      const result = await redis.blpop("kontex:embed_jobs", 0)
      if (result) {
        const [, raw] = result
        processJob(raw).catch(console.error)
      }
    }
  }

  run()
```

---

## Prompt 8.2 — Search endpoint

```
Add to src/routes/dashboard.ts:

GET /v1/search
  Query: q (string, required, min 1), session_id (string, optional), limit (number, default 10, max 50)
  Validate: q present → 400 if missing

  1. Embed the query:
     const result = await voyage.embed({ input: [q], model: "voyage-code-3" })
     const queryVector = result.data[0].embedding

  2. Build Qdrant filter:
     Must match userId = c.get("userId")
     If session_id provided: also match sessionId = session_id

  3. Search Qdrant:
     const results = await qdrant.search(config.QDRANT_COLLECTION, {
       vector: queryVector,
       limit,
       filter: { must: [{ key: "userId", match: { value: userId } }, ...] },
       with_payload: true
     })

  4. Return 200:
     [{
       snapshotId, taskId, sessionId,
       label, source, score,
       createdAt
     }]

Handle missing QDRANT_URL or VOYAGE_API_KEY gracefully:
  If either is empty string: return 503 { error: "search_unavailable", message: "Semantic search not configured" }
```

---

## Prompt 8.3 — Rate limiting + API key management

```
Create src/middleware/ratelimit.ts:

Using Redis for rate limit counters.

export async function rateLimit(c: Context, next: Next): Promise<Response | void> {
  const apiKeyId = c.get("apiKeyId")
  if (!apiKeyId) return next()  // unauthed requests already blocked by auth middleware

  const isWritePath = c.req.method === "POST" &&
    (c.req.path.includes("/snapshots") || c.req.path.includes("/proxy"))

  const hourlyKey = `rl:${apiKeyId}:hourly:${getHourBucket()}`
  const writeKey = `rl:${apiKeyId}:writes:${getHourBucket()}`

  const [hourly, writes] = await redis.mget(hourlyKey, writeKey)

  if (parseInt(hourly ?? "0") >= 1000) {
    return c.json({ error: "rate_limit_exceeded", message: "Hourly request limit reached", details: { retry_after: secondsUntilNextHour() } }, 429)
  }
  if (isWritePath && parseInt(writes ?? "0") >= 100) {
    return c.json({ error: "rate_limit_exceeded", message: "Hourly snapshot write limit reached", details: { retry_after: secondsUntilNextHour() } }, 429)
  }

  await redis.incr(hourlyKey)
  await redis.expire(hourlyKey, 3600)
  if (isWritePath) {
    await redis.incr(writeKey)
    await redis.expire(writeKey, 3600)
  }

  return next()
}

function getHourBucket(): string { return new Date().toISOString().slice(0, 13) }
function secondsUntilNextHour(): number { ... }

Apply in index.ts: app.use("/v1/*", rateLimit) after auth middleware.

Create src/routes/keys.ts:

POST /v1/keys
  Zod body: { label?: string }
  Generate API key: "kontex_" + nanoid(32)
  Create: db.apiKey.create({ data: { key, label, userId } })
  Return 201: { id, key, label, createdAt }
  NOTE: key is returned only here. Never returned again in any other endpoint.

GET /v1/keys
  Return all active keys for userId: [{ id, label, lastUsed, active, createdAt }]
  NEVER include the key value in this response.

DELETE /v1/keys/:id
  Validate ownership (apiKey.userId === c.get("userId")) → 404 if not
  Set active: false (never hard delete)
  Return 204

Mount in index.ts: app.route("/v1/keys", keysRouter)
```

---

## Prompt 8.4 — Railway deploy config

```
Create railway.toml:

[build]
builder = "NIXPACKS"

[deploy]
startCommand = "npm run start"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

[[services]]
name = "kontex-api"

[[services]]
name = "kontex-embed-worker"
startCommand = "node dist/workers/embed.worker.js"

Create docs/data-model.md covering:
  - Sessions, Tasks, Snapshots explained in plain language
  - ContextBundle structure and what each field means
  - The enrichment window concept
  - The immutability invariant and why rollback creates, not deletes
  - Source field values and what they mean

Then run production build and verify:
  npm run build
  - Must complete without TypeScript errors

Deploy:
  railway login
  railway init
  railway up

  railway run npm run migrate   ← run migrations in production

Verify:
  curl https://your-app.railway.app/health → { status: "ok" }
  railway logs -f → no errors

Final checklist — verify every Sprint 8 done criteria item.
```

---

## Prompt 8.5 — Final verification pass

```
Run a full verification pass across all 8 sprints.

1. All Sprint done criteria checked ✓
2. npm run build completes without TypeScript errors
3. npm test passes all tests
4. GET /health → 200
5. POST /proxy/v1/messages → returns Anthropic response
6. Snapshot created after proxy call
7. POST /v1/snapshots/:id/enrich → 200 within window
8. GET /v1/sessions/:id/graph → valid ReactFlow JSON
9. GET /v1/search?q=test → 200 (or 503 if Qdrant not configured)
10. POST /v1/keys → returns key (only time)
11. Rate limit: 1001st request → 429
12. All error responses follow { error, message } shape
13. No stack traces in any API response
14. No API key values in any log output
15. Rollback creates new snapshot, original unchanged
16. docs/quickstart.md, log-watcher.md, mcp-advanced.md, data-model.md all present

Fix every failure found. The backend is done when this list passes completely.
```

---

## 13. Full API Reference

```
# Keys
POST   /v1/keys
GET    /v1/keys
DELETE /v1/keys/:id

# Sessions
POST   /v1/sessions
GET    /v1/sessions
GET    /v1/sessions/:id
PATCH  /v1/sessions/:id
DELETE /v1/sessions/:id

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

# Dashboard
GET    /v1/sessions/:id/graph
GET    /v1/sessions/:id/diff?from=&to=
GET    /v1/sessions/:id/snapshots/timeline
GET    /v1/usage
GET    /v1/search?q=

# Proxy (PRIMARY write path)
POST   /proxy/v1/messages

# MCP (ADVANCED write path)
POST   /mcp

# System
GET    /health
```

---

*Kontex Backend Build Guide · v2.0 · Proxy-first · Log watcher secondary · MCP advanced*
*8 sprints · 35 Claude Code prompts*
