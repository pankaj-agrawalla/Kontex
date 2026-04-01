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
