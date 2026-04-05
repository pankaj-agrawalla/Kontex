# CLAUDE.md — Kontex API Backend

Read this file completely before writing any code. Sprint prompts are in the buildguide referenced at the bottom — execute them from there, sprint by sprint.

---

## What Kontex Is

Kontex is a **task-state persistence engine for agentic workflows** — a state machine with audit trail.

**Two jobs:**
1. **Capture** — intercept agent context via OpenLLMetry SDK (primary), HTTP proxy fallback (secondary), or explicit MCP checkpoints (advanced)
2. **Restore** — serve snapshot data to agents for rollback, to the dashboard for inspection, to developers for semantic search

**Invariant:** Snapshots are immutable once finalized. Rollback creates a new snapshot — never deletes or mutates history. EvalRuns are computed from snapshots — creating or re-running evals never mutates a Snapshot.

---

## What Is Already Built (Sprints 1–11)

Do not re-implement anything in this list.

- Auth middleware, API key CRUD, rate limiting
- Sessions and tasks (full CRUD, tree structure, ownership checks)
- ContextBundle type and R2 bundle storage (read/write/merge)
- Snapshot engine (create, read, enrich, rollback)
- HTTP Proxy — Anthropic-compatible passthrough with async snapshot capture
- MCP server with 6 write tools + 3 read tools (search, get_context, list_snapshots)
- Dashboard REST API (graph, diff, timeline, usage, search)
- Embed worker — Qdrant indexing via Voyage AI voyage-code-3
- OpenLLMetry OTLP ingest — primary capture path via POST /ingest/v1/traces
- tRPC + SSE — type-safe dashboard API and real-time session feed
- Rate limiting via Redis, Railway deploy, all docs

---

## Capture Path Hierarchy

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
HTTP Proxy        →  POST /proxy/v1/messages  ← FALLBACK
MCP write tools   →  POST /mcp               ← ADVANCED
                            ↓
                     span.processor.ts
                     (OTLP → ContextBundle)
                            ↓
                PostgreSQL + R2 + Qdrant + Redis
                            ↓
                   kontex:eval_jobs (Redis queue)
                            ↓
                     eval.worker.ts
                     ├── runDeterministicEvals()   ← always, free
                     └── runTrajectoryEvals()       ← always, free

LLM judge path (on-demand only — never auto-triggered):
POST /v1/snapshots/:id/evals/run { tier: "llm_judge" }
                            ↓
                   llm-judge.service.ts
                   (Claude API — only when EVAL_JUDGE_ENABLED=true)

Serve paths
──────────────────────────────────────────────────────────────
REST  /v1/*       Third-party tools, CLIs, external contracts
tRPC  /trpc/*     Dashboard frontend only — type-safe
SSE   /sse/*      Dashboard live feed only — real-time push
MCP   /mcp        Agent write tools + read tools
```

- **Ingest flow:** OpenLLMetry SDK → `POST /ingest/v1/traces` → `OtelSpan` stored → Redis queue → span-worker async → ContextBundle → R2 + Snapshot → embed queue + eval queue
- **Eval flow:** eval-worker blpop `kontex:eval_jobs` → deterministic evals → trajectory evals → writes EvalRun records
- **LLM judge flow:** explicit `POST /v1/snapshots/:id/evals/run` → 402 if `EVAL_JUDGE_ENABLED=false` → Claude API → writes EvalRun records
- **SSE flow:** span-worker calls `publishEvent()` → Redis pub/sub → SSE client stream
- **tRPC flow:** Bearer token → `createContext()` → Prisma queries → typed response

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
| LLM judge evals | Anthropic SDK — Claude Haiku (on-demand only) |
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
│   ├── data/
│   │   └── evaluators.ts         ← static registry of all 19 evaluators (NEW)
│   ├── receivers/
│   │   ├── otlp.parser.ts
│   │   ├── span.mapper.ts
│   │   └── span.processor.ts
│   ├── routes/
│   │   ├── sessions.ts
│   │   ├── tasks.ts
│   │   ├── snapshots.ts
│   │   ├── proxy.ts
│   │   ├── enrich.ts
│   │   ├── ingest.ts
│   │   ├── sse.ts
│   │   ├── mcp.ts
│   │   ├── dashboard.ts
│   │   └── evals.ts              ← eval REST endpoints (NEW)
│   ├── middleware/
│   │   ├── auth.ts
│   │   └── logger.ts
│   ├── services/
│   │   ├── snapshot.service.ts   ← modified: enqueues eval job after snapshot creation
│   │   ├── bundle.service.ts
│   │   ├── proxy.service.ts
│   │   ├── enrich.service.ts
│   │   ├── diff.service.ts
│   │   ├── embed.service.ts
│   │   ├── eval.service.ts       ← 8 deterministic evaluators (NEW)
│   │   ├── llm-judge.service.ts  ← 6 LLM judge evaluators via Claude (NEW)
│   │   └── trajectory.service.ts ← 5 trajectory trend evaluators (NEW)
│   ├── trpc/
│   │   ├── context.ts
│   │   ├── router.ts
│   │   ├── trpc.ts
│   │   ├── types.ts
│   │   └── routers/
│   │       ├── sessions.ts
│   │       ├── snapshots.ts
│   │       └── dashboard.ts
│   ├── workers/
│   │   ├── embed.worker.ts
│   │   ├── span.worker.ts
│   │   └── eval.worker.ts        ← processes kontex:eval_jobs queue (NEW)
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── session.tools.ts
│   │       ├── snapshot.tools.ts
│   │       ├── rollback.tools.ts
│   │       └── context.tools.ts
│   └── types/
│       ├── api.ts
│       ├── bundle.ts
│       └── otel.ts
├── watcher/                       ← RETIRED — do not modify or run
├── tests/
│   ├── sessions.test.ts
│   ├── snapshots.test.ts
│   ├── proxy.test.ts
│   ├── enrich.test.ts
│   ├── ingest.test.ts
│   ├── trpc.test.ts
│   ├── sse.test.ts
│   └── evals.test.ts             ← NEW
├── docs/
│   ├── openllmetry-quickstart.md
│   ├── quickstart.md
│   ├── mcp-advanced.md
│   ├── data-model.md
│   └── evals.md                  ← NEW
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
     → Session[]
          └── Task[]  (tree via parentTaskId)
                └── Snapshot[]
                      ├── ContextBundle → R2 blob at bundles/{snapshotId}.json
                      └── EvalRun[]     ← one per evaluator per snapshot

EvalRun
  snapshotId   → Snapshot
  evaluatorId  string         one of the 19 evaluator ids from evaluators.ts
  tier         DETERMINISTIC | LLM_JUDGE | TRAJECTORY
  score        Float?         0–1 for deterministic, 1–5 for LLM judge, null for trajectory
  label        String?        "clean" | "loop_detected" | "low" | "medium" | "high" | trend label
  flagged      Boolean        true when score is below threshold or label is critical
  reasoning    String?        LLM judge only — Claude's 1–2 sentence explanation
  meta         Json?          evaluator-specific: { estimatedMs, costUsd, growthRatio, points, ... }

EvalConfig  (per-user overrides — registry defaults apply when no row exists)
  userId       → User
  evaluatorId  string
  enabled      Boolean        default true
  threshold    Float?         LLM judge only — flag if score below this (default 3/5)
  @@unique([userId, evaluatorId])

OtelSpan → Snapshot?
```

**EvalRun @@unique([snapshotId, evaluatorId])** — re-running evals upserts, never duplicates.

**Trajectory EvalRuns** are anchored to the session's most recent snapshot. Their `meta.points` array carries the time-series data across all snapshots.

---

## Evaluator Registry

Defined in `src/data/evaluators.ts` — static, never stored in DB.

**19 evaluators across 3 tiers:**

| Tier | Count | IDs |
|---|---|---|
| DETERMINISTIC | 8 | token_efficiency, tool_call_success_rate, task_completion_rate, latency_per_turn, cost_per_task, loop_detection, context_bloat, rollback_frequency |
| LLM_JUDGE | 6 | task_adherence, reasoning_quality, tool_selection_quality, response_groundedness, instruction_following, hallucination_risk |
| TRAJECTORY | 5 | quality_trend, workflow_convergence, rollback_recovery, cost_efficiency_curve, tool_learning |

---

## Eval Execution Model

**What runs automatically after every snapshot:**
- All 8 deterministic evaluators — no LLM call, ~1ms each, always free
- All 5 trajectory evaluators — aggregates EvalRun history, no LLM call, always free

**What never runs automatically:**
- LLM judge evaluators — only via explicit `POST /v1/snapshots/:id/evals/run { tier: "llm_judge" }`

**Why:** Zero API cost during development and demos. Flip `EVAL_JUDGE_ENABLED=true` when paying customers are onboarded. Nothing else changes — the re-run endpoint just stops returning 402.

**Re-run endpoint guards (in order):**
1. `tier` includes `llm_judge` AND `EVAL_JUDGE_ENABLED=false` → `402 llm_judge_disabled`
2. `tier` includes `llm_judge` AND `ANTHROPIC_API_KEY` is empty → `503 llm_judge_not_configured`
3. Otherwise → enqueue / run as requested

---

## Environment Variables

All validated in `config.ts` at startup. Missing required vars throw immediately with the var name.

```bash
# Existing (unchanged)
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

# Eval layer (Sprint 13) — ANTHROPIC_API_KEY is optional at startup
ANTHROPIC_API_KEY=                          # leave empty until paying customers
EVAL_JUDGE_MODEL=claude-haiku-4-5-20251001  # haiku: cheapest + fastest judge model
EVAL_JUDGE_TIMEOUT_MS=15000
EVAL_JUDGE_ENABLED=false                    # DEFAULT FALSE — flip only for paying customers
```

`ANTHROPIC_API_KEY` uses `z.string().default("")` — the server starts without it. It is validated at call time in `llm-judge.service.ts`, not at startup.

---

## Coding Standards

All existing standards apply. Eval-specific additions:

**TypeScript:** Strict mode. No `any`. No `ts-ignore`. All functions have explicit return types.

**Zod:** Validates every request body at route level.

**Services:** Pure functions. No Hono context. `eval.service.ts`, `llm-judge.service.ts`, and `trajectory.service.ts` receive `snapshotId` or `sessionId` — never a Hono context object.

**Ownership:** Validate resource belongs to authenticated user. Return `404` (not `403`). Applies to all eval endpoints.

**Eval immutability:** EvalRuns are upserted (`@@unique` on snapshotId + evaluatorId) — re-running overwrites the existing row. Never create duplicates.

**LLM judge is fire-and-forget from the re-run endpoint:** The endpoint enqueues / starts the judge call and returns immediately. It does not await the Claude response before responding to the client.

**Eval worker uses a dedicated Redis client:** Never use the shared `redis` singleton for `blPop` — create a separate client in the worker process.

**LLM judge failure is non-fatal:** If the Claude call fails or times out, log the error and return. Never propagate judge errors into snapshot creation or the eval worker retry loop.

**`EVAL_JUDGE_ENABLED`** defaults to `false`. Never change this default. The flag is flipped in `.env` per deployment — not in code.

**REST error shape:**
```json
{ "error": "snake_case_code", "message": "Human readable", "details": {} }
```

**HTTP status codes (including eval-specific):**
```
400 validation_error       401 unauthorized        403 forbidden
402 llm_judge_disabled     404 not_found           409 conflict
429 rate_limit_exceeded    500 internal_error       502 upstream_error
503 llm_judge_not_configured
```

**Never log API key values. Never expose stack traces in responses.**

---

## Auth Patterns

| Endpoint group | Auth header | How |
|---|---|---|
| `GET/POST /v1/*` (incl. evals) | `Authorization: Bearer {key}` | Standard `auth` middleware |
| `POST /ingest/v1/traces` | `X-Kontex-Api-Key: {key}` | Inline in ingest route |
| `POST /proxy/v1/messages` | `X-Kontex-Api-Key: {key}` | Inline in proxy route |
| `POST /trpc/*` | `Authorization: Bearer {key}` | `createContext()` in tRPC adapter |
| `GET /sse/session/:id/feed` | `Authorization: Bearer {key}` | Inline in SSE route |
| `POST /mcp` | Bearer or `X-Kontex-Api-Key` | MCP server handler |

---

## Package Scripts

```json
"dev":          "dotenv-cli -e .env -- tsx watch src/index.ts",
"worker":       "dotenv-cli -e .env -- tsx watch src/workers/embed.worker.ts",
"span-worker":  "dotenv-cli -e .env -- tsx watch src/workers/span.worker.ts",
"eval-worker":  "dotenv-cli -e .env -- tsx watch src/workers/eval.worker.ts",
"build":        "tsc",
"start":        "node dist/index.js",
"migrate":      "prisma migrate deploy",
"test":         "vitest run"
```

**Full local dev — run all four simultaneously:**
`npm run dev` + `npm run worker` + `npm run span-worker` + `npm run eval-worker`

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

[[services]]
name = "kontex-eval-worker"
startCommand = "node dist/workers/eval.worker.js"
```

---

## Sprint Map

| Sprint | Status | Focus |
|---|---|---|
| 1–8 | ✅ Complete | Foundation, snapshots, proxy, rollback, MCP write tools, dashboard, deploy |
| 9 | ✅ Complete | OpenLLMetry OTLP ingest — primary capture path |
| 10 | ✅ Complete | tRPC + SSE — type-safe dashboard API + real-time feed |
| 11 | ✅ Complete | MCP read tools — agents query their own context |
| **12** | 🔨 **Current** | **Eval data layer + deterministic evaluators** |
| 13 | ⬜ Pending | LLM judge evaluators + trajectory analytics |

Execute prompts in `kontex-eval-backend-buildguide.md` in order.

**When resuming mid-sprint:**
```
Read CLAUDE.md. We are on Sprint 12, Prompt 12.X. Continue from there.
```

---

## Full API Surface

```
# Keys
POST/GET/DELETE /v1/keys

# Sessions + Tasks
POST/GET/PATCH/DELETE /v1/sessions      POST /v1/sessions/:id/link-trace
POST/GET /v1/sessions/:id/tasks         GET/PATCH /v1/tasks/:id

# Snapshots
POST /v1/tasks/:id/snapshots
GET /v1/sessions/:id/snapshots          GET/POST /v1/snapshots/:id
GET /v1/snapshots/:id/bundle            POST /v1/snapshots/:id/rollback
POST /v1/snapshots/:id/enrich

# Dashboard
GET /v1/sessions/:id/graph              GET /v1/sessions/:id/diff?from=&to=
GET /v1/sessions/:id/snapshots/timeline GET /v1/usage
GET /v1/search?q=

# Evals (NEW — Sprints 12–13)
GET    /v1/evaluators
GET    /v1/eval-config
PATCH  /v1/eval-config
GET    /v1/snapshots/:id/evals
GET    /v1/sessions/:id/evals
GET    /v1/sessions/:id/evals/trajectory
GET    /v1/evals/flags
POST   /v1/snapshots/:id/evals/run

# Capture
POST /ingest/v1/traces      ← PRIMARY (OTLP, X-Kontex-Api-Key)
POST /proxy/v1/messages     ← FALLBACK (Anthropic-compatible)
POST /mcp                   ← 6 write tools + 3 read tools
GET  /sse/session/:id/feed  ← text/event-stream

# tRPC (dashboard only)
POST /trpc/sessions.{list,byId,create,update,tasks}
POST /trpc/snapshots.{listBySession,byId,bundle,rollback}
POST /trpc/dashboard.{graph,diff,timeline,usage}

GET /health
```
