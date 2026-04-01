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
