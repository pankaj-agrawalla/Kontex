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
