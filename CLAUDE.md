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
