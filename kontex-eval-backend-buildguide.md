# Kontex Eval Backend — Build Guide
### Sprints 12–13. Sprints 1–11 are complete and untouched.

---

## What This Guide Covers

Sprints 1–11 built capture, storage, tRPC, SSE, and MCP read tools. This guide adds the evaluation layer on top of existing snapshots — no existing capture paths, routes, or services change.

| Sprint | What | Why |
|---|---|---|
| **12** | Data model + deterministic evaluators + REST endpoints | Scores every snapshot automatically. Fast, no LLM calls. |
| **13** | LLM judge evaluators + trajectory analytics | Deep quality scoring and trend analysis via Claude. |

**The one invariant that does not change:** Snapshots are immutable. EvalRuns are computed from them — creating or re-running evals never mutates a Snapshot.

---

## New Architecture Piece

```
Snapshot created (any source)
        ↓
  publishEvent("snapshot_created")
        ↓
  eval.worker.ts  ←─ blpop "kontex:eval_jobs"
        │
        ├── evalDeterministic(snapshot)   ← ALWAYS runs, no LLM call, ~1ms
        │      └── writes EvalRun[]
        │
        └── evalTrajectory(session)       ← ALWAYS runs, aggregates EvalRun history
               └── writes EvalRun[] (TRAJECTORY tier)

POST /v1/snapshots/:id/evals/run { tier: "llm_judge" }   ← EXPLICIT ON-DEMAND ONLY
        ↓
  llm-judge.service.ts                  ← calls Claude, ~3–8s per snapshot
        └── writes EvalRun[]
```

**LLM judge evals are never triggered automatically.** The worker only runs deterministic and trajectory passes. LLM judge evals run only when explicitly requested via the re-run endpoint. This keeps API costs at zero during development and demos — LLM judge is activated per-snapshot on demand, or in bulk once paying customers are onboarded.

`EVAL_JUDGE_ENABLED` defaults to `false` in `.env`. The re-run endpoint checks this flag and returns `402` when it is false, so the UI can surface a clear "upgrade required" message instead of silently doing nothing.

---

## New Files

```
kontex-api/
├── prisma/schema.prisma          ← 2 new models: EvalRun, EvalConfig
├── src/
│   ├── index.ts                  ← mount GET /v1/evaluators, eval REST routes
│   ├── services/
│   │   ├── eval.service.ts       ← run deterministic evaluators, read bundle
│   │   ├── llm-judge.service.ts  ← call Claude for 6 judge evaluators
│   │   └── trajectory.service.ts ← aggregate EvalRun history into trend
│   ├── routes/
│   │   └── evals.ts              ← 8 REST endpoints (see API Surface below)
│   ├── workers/
│   │   └── eval.worker.ts        ← blpop "kontex:eval_jobs", orchestrates all 3 services
│   └── data/
│       └── evaluators.ts         ← static registry of all 19 evaluators
├── tests/
│   └── evals.test.ts
└── docs/
    └── evals.md
```

---

## New Environment Variables

Add to `.env` and `.env.example`:

```bash
# Sprint 13 — LLM judge evaluations (on-demand only, never auto-triggered)
ANTHROPIC_API_KEY=                          # Claude API key for LLM judge calls
EVAL_JUDGE_MODEL=claude-haiku-4-5-20251001  # Model for judge calls (haiku: cheap + fast)
EVAL_JUDGE_TIMEOUT_MS=15000                 # Per-judge call timeout in ms
EVAL_JUDGE_ENABLED=false                    # DEFAULT FALSE — flip to true only for paying customers
```

Add to `config.ts` validation (Sprint 13 only — Sprint 12 needs no new vars):
```typescript
ANTHROPIC_API_KEY:     z.string().default(""),          // empty string = not configured
EVAL_JUDGE_MODEL:      z.string().default("claude-haiku-4-5-20251001"),
EVAL_JUDGE_TIMEOUT_MS: z.coerce.number().default(15000),
EVAL_JUDGE_ENABLED:    z.string().transform(v => v === "true").default("false"),
```

`ANTHROPIC_API_KEY` is intentionally not required at startup — the server starts fine without it. It is only validated at call time inside `llm-judge.service.ts`.

---

## New Dependencies

```bash
# Sprint 12 — no new packages (uses existing db, redis, r2, tiktoken)

# Sprint 13
npm install @anthropic-ai/sdk
```

---

## Sprint Map

| Sprint | Focus | Key deliverables |
|---|---|---|
| 12 | Eval data layer + deterministic evaluators | Schema, EvalConfig CRUD, 8 deterministic evaluators, eval worker, REST read endpoints |
| 13 | LLM judge + trajectory analytics | 6 judge evaluators via Claude, 5 trajectory evaluators, flags endpoint, re-run endpoint |

---

# Sprint 12 — Eval Data Layer + Deterministic Evaluators

**Goal:** Every snapshot gets 8 deterministic scores automatically after creation. Scores are stored in the DB and readable via REST. No LLM calls this sprint.

**Done criteria:**
- [ ] `EvalRun` and `EvalConfig` models added to Prisma schema, migration applied
- [ ] `src/data/evaluators.ts` exports the static registry of all 19 evaluators
- [ ] `eval.service.ts` computes all 8 deterministic scores from a ContextBundle
- [ ] `eval.worker.ts` processes jobs from `kontex:eval_jobs` queue
- [ ] `snapshot.service.ts` enqueues an eval job after every snapshot creation
- [ ] `GET /v1/evaluators` returns the full registry
- [ ] `GET /v1/eval-config` returns effective config for authenticated user
- [ ] `PATCH /v1/eval-config` persists enabled/threshold overrides
- [ ] `GET /v1/snapshots/:id/evals` returns all EvalRuns for one snapshot
- [ ] `GET /v1/sessions/:id/evals` returns per-snapshot EvalRun arrays for a session
- [ ] `npm run eval-worker` starts without error
- [ ] Snapshot creation → deterministic EvalRuns appear within 2 seconds

---

## Prompt 12.1 — Prisma schema additions

```
Add to prisma/schema.prisma. Do not modify existing models.

Add to the Snapshot model (new relation field only):
  evalRuns   EvalRun[]

Add two new models and one new enum:

enum EvalTier {
  DETERMINISTIC
  LLM_JUDGE
  TRAJECTORY
}

model EvalRun {
  id          String   @id @default(cuid())
  snapshotId  String
  snapshot    Snapshot @relation(fields: [snapshotId], references: [id])
  evaluatorId String
  tier        EvalTier
  score       Float?
  label       String?
  flagged     Boolean  @default(false)
  reasoning   String?
  meta        Json?
  createdAt   DateTime @default(now())

  @@unique([snapshotId, evaluatorId])
}

model EvalConfig {
  id          String   @id @default(cuid())
  userId      String
  evaluatorId String
  enabled     Boolean  @default(true)
  threshold   Float?
  updatedAt   DateTime @updatedAt

  @@unique([userId, evaluatorId])
}

After editing: run
  npx prisma migrate dev --name add_eval_layer
```

---

## Prompt 12.2 — Evaluator registry

```
Create src/data/evaluators.ts:

This is a static in-memory registry. It is never stored in the database — it is the
source of truth for evaluator metadata read by GET /v1/evaluators.

export type EvaluatorTier = "DETERMINISTIC" | "LLM_JUDGE" | "TRAJECTORY"

export interface Evaluator {
  id:          string
  displayName: string
  description: string
  tier:        EvaluatorTier
  scoreType:   "float_0_1" | "int_1_5" | "label" | "count"
  higherIsBetter: boolean        // false for latency, cost, bloat, rollbacks, hallucination
  defaultEnabled: boolean
  defaultThreshold: number | null  // LLM judge only: flag if score below this
}

export const EVALUATORS: Evaluator[] = [
  // ── DETERMINISTIC ──────────────────────────────────────────────────────
  {
    id: "token_efficiency",
    displayName: "Token efficiency",
    description: "Ratio of new information tokens to total tokens in the snapshot. High values mean the context is dense and non-repetitive.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "tool_call_success_rate",
    displayName: "Tool call success rate",
    description: "Proportion of tool calls in the snapshot bundle that completed with status 'success'. Low values indicate repeated failures or incorrect tool usage.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "task_completion_rate",
    displayName: "Task completion rate",
    description: "Proportion of tasks in this session that have reached COMPLETED status at the time of this snapshot.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "latency_per_turn",
    displayName: "Latency / turn",
    description: "Estimated average milliseconds per LLM turn, derived from message timestamps in the bundle. Lower is better.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: false,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "cost_per_task",
    displayName: "Cost per task",
    description: "Estimated USD cost for this snapshot's token usage, divided by the number of active tasks. Lower is better.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: false,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "loop_detection",
    displayName: "Loop detection",
    description: "Detects repeated tool call sequences that indicate the agent is stuck in a retry loop. Score 1 = clean, score 0 = loop detected.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "context_bloat",
    displayName: "Context bloat",
    description: "Token growth ratio from the previous snapshot to this one. High values mean context is growing faster than useful work is being done.",
    tier: "DETERMINISTIC",
    scoreType: "float_0_1",
    higherIsBetter: false,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "rollback_frequency",
    displayName: "Rollback count",
    description: "Number of rollback operations recorded for this task at the time of this snapshot. Zero is ideal.",
    tier: "DETERMINISTIC",
    scoreType: "count",
    higherIsBetter: false,
    defaultEnabled: true,
    defaultThreshold: null,
  },

  // ── LLM JUDGE ──────────────────────────────────────────────────────────
  {
    id: "task_adherence",
    displayName: "Task adherence",
    description: "How closely the agent's actions map to the task instructions. Scored 1–5 by the judge.",
    tier: "LLM_JUDGE",
    scoreType: "int_1_5",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: 3,
  },
  {
    id: "reasoning_quality",
    displayName: "Reasoning quality",
    description: "Quality of the agent's step-by-step reasoning and decision-making. Scored 1–5.",
    tier: "LLM_JUDGE",
    scoreType: "int_1_5",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: 3,
  },
  {
    id: "tool_selection_quality",
    displayName: "Tool selection quality",
    description: "Whether the agent selected the appropriate tools for the task context. Scored 1–5.",
    tier: "LLM_JUDGE",
    scoreType: "int_1_5",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: 3,
  },
  {
    id: "response_groundedness",
    displayName: "Response groundedness",
    description: "Whether the agent's responses are grounded in the available context and tool outputs. Scored 1–5.",
    tier: "LLM_JUDGE",
    scoreType: "int_1_5",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: 3,
  },
  {
    id: "instruction_following",
    displayName: "Instruction following",
    description: "How precisely the agent followed system prompt and user instructions. Scored 1–5.",
    tier: "LLM_JUDGE",
    scoreType: "int_1_5",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: 3,
  },
  {
    id: "hallucination_risk",
    displayName: "Hallucination risk",
    description: "Estimated risk that the agent generated factually unsupported content. Label: low | medium | high.",
    tier: "LLM_JUDGE",
    scoreType: "label",
    higherIsBetter: false,
    defaultEnabled: true,
    defaultThreshold: null,
  },

  // ── TRAJECTORY ─────────────────────────────────────────────────────────
  {
    id: "quality_trend",
    displayName: "Overall quality trend",
    description: "Aggregate quality score trend across all snapshots in the session. Derived from task_adherence and instruction_following judge scores.",
    tier: "TRAJECTORY",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "workflow_convergence",
    displayName: "Workflow convergence",
    description: "Whether the agent's workflow is converging toward task completion over time. Derived from task_completion_rate trend.",
    tier: "TRAJECTORY",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "rollback_recovery",
    displayName: "Rollback recovery",
    description: "How effectively the agent recovers after a rollback — does quality improve in subsequent snapshots?",
    tier: "TRAJECTORY",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "cost_efficiency_curve",
    displayName: "Cost efficiency curve",
    description: "Whether cost per task is decreasing over time as the agent learns the workflow.",
    tier: "TRAJECTORY",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
  {
    id: "tool_learning",
    displayName: "Tool learning curve",
    description: "Whether tool call success rate is improving over time within this session.",
    tier: "TRAJECTORY",
    scoreType: "float_0_1",
    higherIsBetter: true,
    defaultEnabled: true,
    defaultThreshold: null,
  },
]

export const EVALUATOR_MAP = new Map(EVALUATORS.map(e => [e.id, e]))
```

---

## Prompt 12.3 — Eval service (deterministic)

```
Create src/services/eval.service.ts:

import { db } from "../db"
import { readBundle } from "./bundle.service"
import type { ContextBundle } from "../types/bundle"
import type { Snapshot, Task } from "@prisma/client"

// Cost estimate: $15 per 1M input tokens (claude-3-5-sonnet baseline)
const COST_PER_TOKEN = 15 / 1_000_000

interface DeterministicInput {
  snapshot: Snapshot & { task: Task & { session: { id: string } } }
  bundle: ContextBundle
  previousSnapshot: Snapshot | null
  previousBundle: ContextBundle | null
  taskCount: number
  completedTaskCount: number
  rollbackCount: number
}

interface EvalResult {
  evaluatorId: string
  score: number | null
  label: string | null
  flagged: boolean
  meta: Record<string, unknown>
}

// ── Individual evaluator functions ─────────────────────────────────────────

function evalTokenEfficiency(input: DeterministicInput): EvalResult {
  const { bundle, previousBundle } = input
  if (!previousBundle) {
    // First snapshot — no delta to compute, return neutral score
    return { evaluatorId: "token_efficiency", score: 0.75, label: null, flagged: false, meta: {} }
  }
  const prevTokens = previousBundle.tokenTotal ?? 0
  const currTokens = bundle.tokenTotal ?? 0
  const delta = currTokens - prevTokens
  if (delta <= 0) return { evaluatorId: "token_efficiency", score: 1.0, label: null, flagged: false, meta: { delta } }
  // Efficiency: new messages added vs total delta
  const newMessages = bundle.messages.length - (previousBundle.messages.length ?? 0)
  const score = newMessages > 0 ? Math.min(1, newMessages / Math.max(1, delta / 100)) : 0.5
  return { evaluatorId: "token_efficiency", score: Math.min(1, Math.max(0, score)), label: null, flagged: false, meta: { delta, newMessages } }
}

function evalToolCallSuccessRate(input: DeterministicInput): EvalResult {
  const { bundle } = input
  const tools = bundle.toolCalls ?? []
  if (tools.length === 0) return { evaluatorId: "tool_call_success_rate", score: null, label: null, flagged: false, meta: { total: 0 } }
  const succeeded = tools.filter(t => t.status === "success").length
  const score = succeeded / tools.length
  return {
    evaluatorId: "tool_call_success_rate",
    score,
    label: null,
    flagged: score < 0.5,
    meta: { succeeded, total: tools.length, failed: tools.length - succeeded },
  }
}

function evalTaskCompletionRate(input: DeterministicInput): EvalResult {
  const { taskCount, completedTaskCount } = input
  if (taskCount === 0) return { evaluatorId: "task_completion_rate", score: null, label: null, flagged: false, meta: {} }
  const score = completedTaskCount / taskCount
  return { evaluatorId: "task_completion_rate", score, label: null, flagged: false, meta: { completed: completedTaskCount, total: taskCount } }
}

function evalLatencyPerTurn(input: DeterministicInput): EvalResult {
  const { bundle } = input
  const messages = bundle.messages ?? []
  if (messages.length < 2) return { evaluatorId: "latency_per_turn", score: null, label: null, flagged: false, meta: {} }
  const timestamps = messages
    .filter(m => m.timestamp)
    .map(m => new Date(m.timestamp!).getTime())
    .sort((a, b) => a - b)
  if (timestamps.length < 2) return { evaluatorId: "latency_per_turn", score: null, label: null, flagged: false, meta: {} }
  const totalMs = timestamps[timestamps.length - 1] - timestamps[0]
  const turns = timestamps.length - 1
  const avgMs = totalMs / turns
  // Normalize: 0ms = score 1.0, 2000ms = score 0.0
  const score = Math.max(0, 1 - avgMs / 2000)
  return { evaluatorId: "latency_per_turn", score, label: null, flagged: avgMs > 3000, meta: { estimatedMs: Math.round(avgMs), turns } }
}

function evalCostPerTask(input: DeterministicInput): EvalResult {
  const { snapshot, taskCount } = input
  const totalCost = snapshot.tokenTotal * COST_PER_TOKEN
  const tasks = Math.max(1, taskCount)
  const costUsd = totalCost / tasks
  // Normalize: $0 = 1.0, $0.10 = 0.0
  const score = Math.max(0, 1 - costUsd / 0.10)
  return { evaluatorId: "cost_per_task", score, label: null, flagged: costUsd > 0.05, meta: { costUsd: parseFloat(costUsd.toFixed(6)), tokenTotal: snapshot.tokenTotal } }
}

function evalLoopDetection(input: DeterministicInput): EvalResult {
  const { bundle } = input
  const tools = bundle.toolCalls ?? []
  if (tools.length < 3) return { evaluatorId: "loop_detection", score: 1, label: "clean", flagged: false, meta: {} }
  // Detect: same tool + same input appearing 3+ times
  const counts = new Map<string, number>()
  for (const t of tools) {
    const key = `${t.tool}::${JSON.stringify(t.input)}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const loopEntry = [...counts.entries()].find(([, n]) => n >= 3)
  if (loopEntry) {
    return { evaluatorId: "loop_detection", score: 0, label: "loop_detected", flagged: true, meta: { tool: loopEntry[0].split("::")[0], count: loopEntry[1] } }
  }
  return { evaluatorId: "loop_detection", score: 1, label: "clean", flagged: false, meta: {} }
}

function evalContextBloat(input: DeterministicInput): EvalResult {
  const { snapshot, previousSnapshot } = input
  if (!previousSnapshot) return { evaluatorId: "context_bloat", score: null, label: null, flagged: false, meta: {} }
  const prev = previousSnapshot.tokenTotal
  const curr = snapshot.tokenTotal
  if (prev === 0) return { evaluatorId: "context_bloat", score: 0, label: null, flagged: false, meta: { growthRatio: 0 } }
  const growthRatio = (curr - prev) / prev
  // Normalize: 0 growth = score 1.0, 100%+ growth = score 0.0
  const score = Math.max(0, 1 - growthRatio)
  return { evaluatorId: "context_bloat", score, label: null, flagged: growthRatio > 0.5, meta: { growthRatio: parseFloat(growthRatio.toFixed(4)) } }
}

function evalRollbackFrequency(input: DeterministicInput): EvalResult {
  const { rollbackCount } = input
  // Normalize: 0 rollbacks = score 1.0, 5+ rollbacks = score 0.0
  const score = Math.max(0, 1 - rollbackCount / 5)
  return { evaluatorId: "rollback_frequency", score, label: null, flagged: rollbackCount >= 3, meta: { rollbackCount } }
}

// ── Public function ─────────────────────────────────────────────────────────

export async function runDeterministicEvals(snapshotId: string): Promise<void> {
  // 1. Load snapshot with task + session
  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } },
  })
  if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`)

  // 2. Load current bundle
  const bundle = await readBundle(snapshot.r2Key)

  // 3. Load previous snapshot in same task (ordered by createdAt desc, skip current)
  const previous = await db.snapshot.findFirst({
    where: { taskId: snapshot.taskId, createdAt: { lt: snapshot.createdAt } },
    orderBy: { createdAt: "desc" },
  })
  const previousBundle = previous ? await readBundle(previous.r2Key).catch(() => null) : null

  // 4. Count tasks and completions in session
  const [taskCount, completedTaskCount] = await Promise.all([
    db.task.count({ where: { sessionId: snapshot.task.sessionId } }),
    db.task.count({ where: { sessionId: snapshot.task.sessionId, status: "COMPLETED" } }),
  ])

  // 5. Count rollbacks in task (snapshots where source contains "rollback")
  const rollbackCount = await db.snapshot.count({
    where: { taskId: snapshot.taskId, label: { contains: "rollback" } },
  })

  const input: DeterministicInput = {
    snapshot,
    bundle,
    previousSnapshot: previous ?? null,
    previousBundle,
    taskCount,
    completedTaskCount,
    rollbackCount,
  }

  // 6. Run all 8 evaluators
  const results: EvalResult[] = [
    evalTokenEfficiency(input),
    evalToolCallSuccessRate(input),
    evalTaskCompletionRate(input),
    evalLatencyPerTurn(input),
    evalCostPerTask(input),
    evalLoopDetection(input),
    evalContextBloat(input),
    evalRollbackFrequency(input),
  ]

  // 7. Upsert EvalRun records (unique: snapshotId + evaluatorId)
  await Promise.all(
    results.map(r =>
      db.evalRun.upsert({
        where: { snapshotId_evaluatorId: { snapshotId, evaluatorId: r.evaluatorId } },
        update: { score: r.score, label: r.label, flagged: r.flagged, meta: r.meta },
        create: {
          snapshotId,
          evaluatorId: r.evaluatorId,
          tier: "DETERMINISTIC",
          score: r.score,
          label: r.label,
          flagged: r.flagged,
          meta: r.meta,
        },
      })
    )
  )
}
```

---

## Prompt 12.4 — Eval worker

```
Create src/workers/eval.worker.ts:

import { createClient } from "redis"
import { config } from "../config"
import { runDeterministicEvals } from "../services/eval.service"

// Use a dedicated Redis client for blocking pop — never use the shared singleton
const redisWorker = createClient({ url: config.REDIS_URL })
await redisWorker.connect()

const MAX_RETRIES = 3

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function processJob(raw: string, attempt = 1): Promise<void> {
  const { snapshotId } = JSON.parse(raw) as { snapshotId: string }
  try {
    await runDeterministicEvals(snapshotId)
    console.log(`[eval-worker] Deterministic evals complete: ${snapshotId}`)
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(Math.pow(2, attempt) * 1000)
      await processJob(raw, attempt + 1)
    } else {
      console.error(`[eval-worker] Deterministic evals failed after ${MAX_RETRIES} attempts:`, snapshotId, err)
    }
  }
}

async function run(): Promise<void> {
  console.log("[eval-worker] Started")
  while (true) {
    const result = await redisWorker.blPop("kontex:eval_jobs", 0)
    if (result) {
      const [, raw] = result
      processJob(raw).catch(console.error)
    }
  }
}

run()

Add to package.json scripts:
  "eval-worker": "dotenv-cli -e .env -- tsx watch src/workers/eval.worker.ts"
```

---

## Prompt 12.5 — Enqueue eval jobs on snapshot creation

```
Modify src/services/snapshot.service.ts.

After the existing redis.rpush for embed jobs, add:

  redis.rPush("kontex:eval_jobs", JSON.stringify({ snapshotId: snapshot.id }))
    .catch(err => console.error("Failed to queue eval job:", err))

This is fire-and-forget — it must never block or throw into the caller.
The eval job runs asynchronously after the snapshot is persisted.

Also modify src/routes/snapshots.ts for the rollback endpoint:
After a rollback creates a new snapshot, enqueue an eval job for the new snapshot id.
Same pattern: redis.rPush(...)  fire-and-forget.
```

---

## Prompt 12.6 — Eval REST routes

```
Create src/routes/evals.ts:

import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { db } from "../db"
import { auth } from "../middleware/auth"
import { EVALUATORS } from "../data/evaluators"

const evals = new Hono()
evals.use("*", auth)

// ── GET /v1/evaluators ──────────────────────────────────────────────────────
// Returns the static registry. No auth needed for reading registry but keep
// behind auth for consistency. No database query — returns EVALUATORS array.
evals.get("/evaluators", (c) => {
  return c.json(EVALUATORS)
})

// ── GET /v1/eval-config ─────────────────────────────────────────────────────
// Returns effective config: registry defaults merged with any user overrides.
// Fields: evaluatorId, enabled, threshold, tier, displayName
evals.get("/eval-config", async (c) => {
  const userId = c.get("userId")
  const overrides = await db.evalConfig.findMany({ where: { userId } })
  const overrideMap = new Map(overrides.map(o => [o.evaluatorId, o]))

  const effective = EVALUATORS.map(ev => {
    const override = overrideMap.get(ev.id)
    return {
      evaluatorId: ev.id,
      displayName: ev.displayName,
      tier: ev.tier,
      enabled: override?.enabled ?? ev.defaultEnabled,
      threshold: override?.threshold ?? ev.defaultThreshold,
    }
  })
  return c.json(effective)
})

// ── PATCH /v1/eval-config ───────────────────────────────────────────────────
// Upserts one evaluator override. Validates evaluatorId exists in registry.
evals.patch(
  "/eval-config",
  zValidator("json", z.object({
    evaluatorId: z.string(),
    enabled:     z.boolean().optional(),
    threshold:   z.number().min(1).max(5).optional(),
  })),
  async (c) => {
    const userId = c.get("userId")
    const { evaluatorId, enabled, threshold } = c.req.valid("json")

    if (!EVALUATORS.find(e => e.id === evaluatorId)) {
      return c.json({ error: "not_found", message: "Evaluator not found" }, 404)
    }

    await db.evalConfig.upsert({
      where: { userId_evaluatorId: { userId, evaluatorId } },
      update: {
        ...(enabled !== undefined && { enabled }),
        ...(threshold !== undefined && { threshold }),
      },
      create: { userId, evaluatorId, enabled: enabled ?? true, threshold: threshold ?? null },
    })
    return c.json({ ok: true })
  }
)

// ── GET /v1/snapshots/:id/evals ─────────────────────────────────────────────
// Returns all EvalRun records for a snapshot. Ownership check via snapshot → task → session.
evals.get("/snapshots/:id/evals", async (c) => {
  const userId = c.get("userId")
  const snapshotId = c.req.param("id")

  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: { include: { session: true } } },
  })
  if (!snapshot || snapshot.task.session.userId !== userId) {
    return c.json({ error: "not_found", message: "Snapshot not found" }, 404)
  }

  const runs = await db.evalRun.findMany({
    where: { snapshotId },
    orderBy: { createdAt: "asc" },
  })
  return c.json(runs)
})

// ── GET /v1/sessions/:id/evals ──────────────────────────────────────────────
// Returns [{ snapshotId, createdAt, tokenTotal, label, evals: EvalRun[] }]
// ordered by snapshot.createdAt desc. Ownership check via session.
evals.get("/sessions/:id/evals", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.param("id")

  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404)
  }

  const snapshots = await db.snapshot.findMany({
    where: { task: { sessionId } },
    include: { evalRuns: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  })

  return c.json(snapshots.map(s => ({
    snapshotId: s.id,
    label: s.label,
    tokenTotal: s.tokenTotal,
    createdAt: s.createdAt,
    evals: s.evalRuns,
  })))
})

// ── GET /v1/evals/flags ─────────────────────────────────────────────────────
// Returns all flagged EvalRuns for the authenticated user.
// Optional ?session_id= scopes to a single session.
evals.get("/evals/flags", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.query("session_id")

  const runs = await db.evalRun.findMany({
    where: {
      flagged: true,
      snapshot: {
        task: {
          session: {
            userId,
            ...(sessionId && { id: sessionId }),
          },
        },
      },
    },
    include: {
      snapshot: {
        select: { id: true, label: true, createdAt: true, taskId: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  })
  return c.json(runs)
})

Mount in src/index.ts:
  import evalsRouter from "./routes/evals"

  // Mount before the catch-all. The /v1/evaluators and /v1/eval-config routes
  // are on the evals router — mount at /v1 to preserve the /v1/* prefix:
  app.route("/v1", evalsRouter)

  // The /v1/evals/flags and /v1/sessions/:id/evals and /v1/snapshots/:id/evals
  // are also on the evals router via the same mount point.
```

---

---

# Sprint 13 — LLM Judge Evaluators + Trajectory Analytics

**Goal:** Each snapshot gets scored by 6 LLM judge evaluators using Claude. Trajectory evaluators compute trend analysis across all snapshots in a session. Re-run endpoint allows manual triggering.

**Done criteria:**
- [ ] `llm-judge.service.ts` calls Claude for all 6 judge evaluators in one batched prompt
- [ ] `trajectory.service.ts` computes 5 trajectory trend evaluations from existing EvalRun history
- [ ] `eval.worker.ts` updated to run trajectory after deterministic — LLM judge is NOT enqueued here
- [ ] `GET /v1/sessions/:id/evals/trajectory` returns trend data with points array
- [ ] `POST /v1/snapshots/:id/evals/run` is the sole trigger for LLM judge evals
- [ ] Re-run endpoint returns `402` with `{ error: "llm_judge_disabled", message: "LLM judge evals require EVAL_JUDGE_ENABLED=true" }` when the flag is off
- [ ] LLM judge respects per-evaluator `enabled` config from EvalConfig table
- [ ] `ANTHROPIC_API_KEY` missing at call time → returns `503` with clear message, does not crash
- [ ] `npm run build` completes without TypeScript errors
- [ ] `evals.test.ts` passes

---

## Prompt 13.1 — LLM judge service

```
Create src/services/llm-judge.service.ts:

import Anthropic from "@anthropic-ai/sdk"
import { db } from "../db"
import { readBundle } from "./bundle.service"
import { config } from "../config"

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

// All 6 judge evaluators are scored in a SINGLE Claude call to minimize latency and cost.
// The prompt asks Claude to return a JSON object with all 6 scores at once.

const JUDGE_SYSTEM = `You are an expert evaluator of AI agent behavior. You will be given a snapshot of an agent's context — the messages, tool calls, and reasoning from a single point in its execution.

Score the agent on the following dimensions. Return ONLY valid JSON, no markdown, no explanation outside the JSON.

Required JSON shape:
{
  "task_adherence": { "score": <1-5 integer>, "reasoning": "<1-2 sentences>" },
  "reasoning_quality": { "score": <1-5 integer>, "reasoning": "<1-2 sentences>" },
  "tool_selection_quality": { "score": <1-5 integer>, "reasoning": "<1-2 sentences>" },
  "response_groundedness": { "score": <1-5 integer>, "reasoning": "<1-2 sentences>" },
  "instruction_following": { "score": <1-5 integer>, "reasoning": "<1-2 sentences>" },
  "hallucination_risk": { "label": "low" | "medium" | "high", "reasoning": "<1-2 sentences>" }
}

Scoring rubric for 1-5 scores:
  5 — Excellent, no issues
  4 — Good, minor issues only
  3 — Acceptable, clear room for improvement
  2 — Poor, significant issues
  1 — Very poor, fundamental problems

Flag rules (set flagged = true if):
  task_adherence < 3
  reasoning_quality < 3
  tool_selection_quality < 3
  response_groundedness < 3
  instruction_following < 3
  hallucination_risk = "high"
`

function buildJudgePrompt(bundle: any, taskName: string): string {
  const messages = (bundle.messages ?? []).slice(-20)  // last 20 messages only
  const toolCalls = (bundle.toolCalls ?? []).slice(-10) // last 10 tool calls
  const reasoning = bundle.reasoning ? bundle.reasoning.slice(0, 1000) : null

  return [
    `Task: ${taskName}`,
    "",
    "Recent messages:",
    messages.map((m: any) => `[${m.role}]: ${String(m.content).slice(0, 500)}`).join("\n"),
    "",
    "Recent tool calls:",
    toolCalls.map((t: any) => `${t.tool}(${JSON.stringify(t.input).slice(0, 200)}) → ${String(t.output).slice(0, 200)} [${t.status}]`).join("\n"),
    reasoning ? `\nAgent reasoning:\n${reasoning}` : "",
  ].join("\n")
}

interface JudgeResult {
  evaluatorId: string
  score: number | null
  label: string | null
  flagged: boolean
  reasoning: string | null
}

export async function runLLMJudgeEvals(snapshotId: string): Promise<void> {
  // This function should only be called from the re-run endpoint after the
  // EVAL_JUDGE_ENABLED and ANTHROPIC_API_KEY guards have already been checked.
  // It is never called from the eval worker.
  if (!config.EVAL_JUDGE_ENABLED || !config.ANTHROPIC_API_KEY) {
    console.warn(`[llm-judge] Called but not enabled/configured — skipping ${snapshotId}`)
    return
  }

  const snapshot = await db.snapshot.findUnique({
    where: { id: snapshotId },
    include: { task: true },
  })
  if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`)

  const bundle = await readBundle(snapshot.r2Key)

  // Check which judge evaluators are enabled for this user
  const userId = (await db.task.findUnique({
    where: { id: snapshot.taskId },
    include: { session: { select: { userId: true } } },
  }))?.session.userId
  if (!userId) return

  const configs = await db.evalConfig.findMany({
    where: { userId, tier: undefined },
  })
  // Build set of disabled evaluator ids
  const disabledSet = new Set(configs.filter(c => !c.enabled).map(c => c.evaluatorId))
  const JUDGE_IDS = ["task_adherence", "reasoning_quality", "tool_selection_quality", "response_groundedness", "instruction_following", "hallucination_risk"]
  const enabledJudges = JUDGE_IDS.filter(id => !disabledSet.has(id))
  if (enabledJudges.length === 0) return

  const userPrompt = buildJudgePrompt(bundle, snapshot.task.name)

  let parsed: Record<string, { score?: number; label?: string; reasoning?: string }> = {}
  try {
    const response = await Promise.race([
      anthropic.messages.create({
        model: config.EVAL_JUDGE_MODEL,
        max_tokens: 1024,
        system: JUDGE_SYSTEM,
        messages: [{ role: "user", content: userPrompt }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM judge timeout")), config.EVAL_JUDGE_TIMEOUT_MS)
      ),
    ])
    const raw = response.content[0].type === "text" ? response.content[0].text : ""
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(`[llm-judge] Failed to get or parse judge response for ${snapshotId}:`, err)
    return  // Do not rethrow — LLM judge failure should not block the pipeline
  }

  // Load thresholds
  const thresholdMap = new Map(configs.map(c => [c.evaluatorId, c.threshold]))

  const results: JudgeResult[] = JUDGE_IDS.map(id => {
    if (!enabledJudges.includes(id)) return null
    const raw = parsed[id]
    if (!raw) return { evaluatorId: id, score: null, label: null, flagged: false, reasoning: null }

    const threshold = thresholdMap.get(id) ?? 3

    if (id === "hallucination_risk") {
      const label = raw.label ?? "low"
      return {
        evaluatorId: id,
        score: null,
        label,
        flagged: label === "high",
        reasoning: raw.reasoning ?? null,
      }
    }

    const score = typeof raw.score === "number" ? raw.score : null
    return {
      evaluatorId: id,
      score,
      label: null,
      flagged: score !== null && score < threshold,
      reasoning: raw.reasoning ?? null,
    }
  }).filter(Boolean) as JudgeResult[]

  await Promise.all(
    results.map(r =>
      db.evalRun.upsert({
        where: { snapshotId_evaluatorId: { snapshotId, evaluatorId: r.evaluatorId } },
        update: { score: r.score, label: r.label, flagged: r.flagged, reasoning: r.reasoning },
        create: {
          snapshotId,
          evaluatorId: r.evaluatorId,
          tier: "LLM_JUDGE",
          score: r.score,
          label: r.label,
          flagged: r.flagged,
          reasoning: r.reasoning,
        },
      })
    )
  )
}
```

---

## Prompt 13.2 — Trajectory service

```
Create src/services/trajectory.service.ts:

Trajectory evaluators aggregate existing EvalRun history for a session.
They do NOT call any external service — they compute from DB records only.

import { db } from "../db"

type TrendLabel = "improving" | "degrading" | "stable" | "volatile" | "insufficient_data"

interface TrajectoryPoint {
  snapshotId: string
  score: number
  createdAt: Date
}

interface TrajectoryResult {
  evaluatorId: string
  trend: TrendLabel
  summary: string
  points: TrajectoryPoint[]
}

// Computes linear regression slope from an array of y values.
// Returns positive for improving, negative for degrading, near-zero for stable.
function slope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const xMean = (n - 1) / 2
  const yMean = values.reduce((a, b) => a + b, 0) / n
  const num = values.reduce((s, y, x) => s + (x - xMean) * (y - yMean), 0)
  const den = values.reduce((s, _, x) => s + (x - xMean) ** 2, 0)
  return den === 0 ? 0 : num / den
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
}

function classifyTrend(points: TrajectoryPoint[], higherIsBetter: boolean): TrendLabel {
  if (points.length < 3) return "insufficient_data"
  const scores = points.map(p => p.score)
  const s = slope(scores)
  const v = variance(scores)
  const range = Math.max(...scores) - Math.min(...scores)
  if (range > 0.3 && v > 0.02) return "volatile"
  const threshold = 0.02
  if (higherIsBetter) {
    if (s > threshold) return "improving"
    if (s < -threshold) return "degrading"
    return "stable"
  } else {
    if (s < -threshold) return "improving"
    if (s > threshold) return "degrading"
    return "stable"
  }
}

function trendSummary(evaluatorId: string, trend: TrendLabel, points: TrajectoryPoint[]): string {
  const n = points.length
  const display: Record<string, string> = {
    quality_trend: "Overall quality",
    workflow_convergence: "Workflow convergence",
    rollback_recovery: "Rollback recovery",
    cost_efficiency_curve: "Cost efficiency",
    tool_learning: "Tool usage quality",
  }
  const name = display[evaluatorId] ?? evaluatorId
  const summaries: Record<TrendLabel, string> = {
    improving: `${name} is improving across ${n} snapshots.`,
    degrading: `${name} has been declining — review recent snapshots.`,
    stable: `${name} is holding steady across ${n} snapshots.`,
    volatile: `${name} is fluctuating. The agent's behavior is inconsistent.`,
    insufficient_data: `Not enough data yet (${n} snapshot${n !== 1 ? "s" : ""} recorded).`,
  }
  return summaries[trend]
}

export async function runTrajectoryEvals(sessionId: string): Promise<void> {
  // Load all snapshots for this session, oldest first
  const snapshots = await db.snapshot.findMany({
    where: { task: { sessionId } },
    orderBy: { createdAt: "asc" },
    include: { evalRuns: true },
  })

  if (snapshots.length === 0) return

  const results: TrajectoryResult[] = []

  // ── quality_trend: mean of task_adherence + instruction_following scores ──
  {
    const points: TrajectoryPoint[] = snapshots.flatMap(s => {
      const runs = s.evalRuns.filter(r =>
        r.evaluatorId === "task_adherence" || r.evaluatorId === "instruction_following"
      ).filter(r => r.score !== null)
      if (runs.length === 0) return []
      const mean = runs.reduce((a, b) => a + (b.score ?? 0), 0) / runs.length
      return [{ snapshotId: s.id, score: mean / 5, createdAt: s.createdAt }]
    })
    const trend = classifyTrend(points, true)
    results.push({ evaluatorId: "quality_trend", trend, summary: trendSummary("quality_trend", trend, points), points })
  }

  // ── workflow_convergence: task_completion_rate scores ─────────────────────
  {
    const points: TrajectoryPoint[] = snapshots.flatMap(s => {
      const run = s.evalRuns.find(r => r.evaluatorId === "task_completion_rate" && r.score !== null)
      return run ? [{ snapshotId: s.id, score: run.score!, createdAt: s.createdAt }] : []
    })
    const trend = classifyTrend(points, true)
    results.push({ evaluatorId: "workflow_convergence", trend, summary: trendSummary("workflow_convergence", trend, points), points })
  }

  // ── rollback_recovery: quality scores in snapshots immediately after rollbacks ─
  {
    const rollbackIndices = snapshots
      .map((s, i) => (s.label.toLowerCase().includes("rollback") ? i : -1))
      .filter(i => i >= 0)
    const points: TrajectoryPoint[] = rollbackIndices.flatMap(ri => {
      const recovery = snapshots[ri + 1]
      if (!recovery) return []
      const run = recovery.evalRuns.find(r => r.evaluatorId === "task_adherence" && r.score !== null)
      return run ? [{ snapshotId: recovery.id, score: run.score! / 5, createdAt: recovery.createdAt }] : []
    })
    const trend = classifyTrend(points, true)
    results.push({ evaluatorId: "rollback_recovery", trend, summary: trendSummary("rollback_recovery", trend, points), points })
  }

  // ── cost_efficiency_curve: cost_per_task scores ───────────────────────────
  {
    const points: TrajectoryPoint[] = snapshots.flatMap(s => {
      const run = s.evalRuns.find(r => r.evaluatorId === "cost_per_task" && r.score !== null)
      return run ? [{ snapshotId: s.id, score: run.score!, createdAt: s.createdAt }] : []
    })
    const trend = classifyTrend(points, false) // lower cost = better
    results.push({ evaluatorId: "cost_efficiency_curve", trend, summary: trendSummary("cost_efficiency_curve", trend, points), points })
  }

  // ── tool_learning: tool_call_success_rate scores ──────────────────────────
  {
    const points: TrajectoryPoint[] = snapshots.flatMap(s => {
      const run = s.evalRuns.find(r => r.evaluatorId === "tool_call_success_rate" && r.score !== null)
      return run ? [{ snapshotId: s.id, score: run.score!, createdAt: s.createdAt }] : []
    })
    const trend = classifyTrend(points, true)
    results.push({ evaluatorId: "tool_learning", trend, summary: trendSummary("tool_learning", trend, points), points })
  }

  // Upsert trajectory EvalRuns — use the session's most recent snapshot as the anchor
  const anchorSnapshot = snapshots[snapshots.length - 1]
  await Promise.all(
    results.map(r =>
      db.evalRun.upsert({
        where: { snapshotId_evaluatorId: { snapshotId: anchorSnapshot.id, evaluatorId: r.evaluatorId } },
        update: { score: null, label: r.trend, meta: { trend: r.trend, summary: r.summary, points: r.points } },
        create: {
          snapshotId: anchorSnapshot.id,
          evaluatorId: r.evaluatorId,
          tier: "TRAJECTORY",
          score: null,
          label: r.trend,
          flagged: r.trend === "degrading" || r.trend === "volatile",
          meta: { trend: r.trend, summary: r.summary, points: r.points },
        },
      })
    )
  )
}
```

---

## Prompt 13.3 — Update eval worker for LLM judge + trajectory

```
Update src/workers/eval.worker.ts:

Add imports:
  import { runTrajectoryEvals } from "../services/trajectory.service"
  // DO NOT import llm-judge.service here — LLM judge is never auto-triggered

Update processJob to run deterministic + trajectory only:

async function processJob(raw: string, attempt = 1): Promise<void> {
  const { snapshotId } = JSON.parse(raw) as { snapshotId: string }
  try {
    // Phase 1: deterministic (fast, no LLM, always runs)
    await runDeterministicEvals(snapshotId)
    console.log(`[eval-worker] Deterministic complete: ${snapshotId}`)

    // Phase 2: trajectory (aggregates session history, no LLM, always runs)
    const { db } = await import("../db")
    const snapshot = await db.snapshot.findUnique({
      where: { id: snapshotId },
      include: { task: { select: { sessionId: true } } },
    })
    if (snapshot?.task.sessionId) {
      await runTrajectoryEvals(snapshot.task.sessionId)
      console.log(`[eval-worker] Trajectory complete for session: ${snapshot.task.sessionId}`)
    }

    // LLM judge: NOT triggered here. Use POST /v1/snapshots/:id/evals/run to trigger on demand.
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(Math.pow(2, attempt) * 1000)
      await processJob(raw, attempt + 1)
    } else {
      console.error(`[eval-worker] Failed after ${MAX_RETRIES} attempts:`, snapshotId, err)
    }
  }
}
```

---

## Prompt 13.4 — Trajectory endpoint + re-run endpoint

```
Add to src/routes/evals.ts:

// ── GET /v1/sessions/:id/evals/trajectory ───────────────────────────────────
// Returns trajectory evaluator results from the most recent snapshot's EvalRuns.
// Response: [{ evaluatorId, trend, summary, points: [{ snapshotId, score, createdAt }] }]
evals.get("/sessions/:id/evals/trajectory", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.param("id")

  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404)
  }

  // Trajectory results live on the most recent snapshot as tier=TRAJECTORY runs
  const anchorSnapshot = await db.snapshot.findFirst({
    where: { task: { sessionId } },
    orderBy: { createdAt: "desc" },
    include: {
      evalRuns: {
        where: { tier: "TRAJECTORY" },
      },
    },
  })

  if (!anchorSnapshot || anchorSnapshot.evalRuns.length === 0) {
    return c.json([])
  }

  const result = anchorSnapshot.evalRuns.map(run => {
    const meta = (run.meta ?? {}) as {
      trend?: string
      summary?: string
      points?: { snapshotId: string; score: number; createdAt: string }[]
    }
    return {
      evaluatorId: run.evaluatorId,
      trend: run.label ?? meta.trend ?? "insufficient_data",
      summary: meta.summary ?? null,
      points: (meta.points ?? []).map(p => ({
        snapshotId: p.snapshotId,
        score: p.score,
        createdAt: p.createdAt,
      })),
    }
  })

  return c.json(result)
})

// ── POST /v1/snapshots/:id/evals/run ────────────────────────────────────────
// Manually trigger an eval re-run for one snapshot.
// Body: { tier: "deterministic" | "llm_judge" | "all" }
//
// tier = "deterministic" or "all" with llm_judge disabled → enqueues to eval worker (free)
// tier = "llm_judge" or "all" with llm_judge enabled     → calls llm-judge.service directly (paid)
// tier = "llm_judge" with EVAL_JUDGE_ENABLED=false        → 402 payment_required
evals.post(
  "/snapshots/:id/evals/run",
  zValidator("json", z.object({
    tier: z.enum(["deterministic", "llm_judge", "all"]).default("deterministic"),
  })),
  async (c) => {
    const userId = c.get("userId")
    const snapshotId = c.req.param("id")
    const { tier } = c.req.valid("json")

    const snapshot = await db.snapshot.findUnique({
      where: { id: snapshotId },
      include: { task: { include: { session: true } } },
    })
    if (!snapshot || snapshot.task.session.userId !== userId) {
      return c.json({ error: "not_found", message: "Snapshot not found" }, 404)
    }

    const wantsJudge = tier === "llm_judge" || tier === "all"

    // Guard: LLM judge requires EVAL_JUDGE_ENABLED=true
    if (wantsJudge && !config.EVAL_JUDGE_ENABLED) {
      return c.json(
        { error: "llm_judge_disabled", message: "LLM judge evaluations are not enabled on this instance." },
        402
      )
    }

    // Guard: LLM judge requires ANTHROPIC_API_KEY
    if (wantsJudge && !config.ANTHROPIC_API_KEY) {
      return c.json(
        { error: "llm_judge_not_configured", message: "ANTHROPIC_API_KEY is not configured." },
        503
      )
    }

    if (tier === "deterministic" || tier === "all") {
      // Enqueue to worker — deterministic is always free
      const { redis } = await import("../redis")
      redis.rPush("kontex:eval_jobs", JSON.stringify({ snapshotId, tier: "deterministic" }))
        .catch(err => console.error("Failed to queue deterministic re-run:", err))
    }

    if (wantsJudge) {
      // Run LLM judge inline (not via worker queue) so the caller can await it
      const { runLLMJudgeEvals } = await import("../services/llm-judge.service")
      runLLMJudgeEvals(snapshotId).catch(err =>
        console.error("LLM judge re-run failed:", snapshotId, err)
      )
      // Fire-and-forget — response returns immediately, results appear within ~10s
      return c.json({ ok: true, snapshotId, tier, note: "LLM judge running asynchronously — results appear within ~30s" })
    }

    return c.json({ ok: true, snapshotId, tier })
  }
)
```

---

## Prompt 13.5 — Tests + docs

```
Create tests/evals.test.ts using Vitest.

Test coverage required:
  1. runDeterministicEvals: mock db and readBundle, verify 8 EvalRun upserts are called
  2. loop_detection: bundle with 3 identical tool calls → score 0, flagged true
  3. loop_detection: bundle with unique tool calls → score 1, flagged false
  4. context_bloat: tokenTotal doubles → growthRatio = 1.0, flagged true
  5. GET /v1/evaluators → 200, returns array of 19 evaluators
  6. GET /v1/eval-config → 200, returns effective config (defaults when no overrides)
  7. PATCH /v1/eval-config → 200, upserts override
  8. PATCH /v1/eval-config with unknown evaluatorId → 404
  9. GET /v1/snapshots/:id/evals → 200 with own snapshot, 404 with other user's snapshot
  10. GET /v1/sessions/:id/evals → 200 with own session, 404 with other user's session
  11. GET /v1/evals/flags → 200, returns only flagged runs for authenticated user
  12. POST /v1/snapshots/:id/evals/run { tier: "deterministic" } → 200, enqueues job
  13. POST /v1/snapshots/:id/evals/run { tier: "llm_judge" } with EVAL_JUDGE_ENABLED=false → 402
  14. POST /v1/snapshots/:id/evals/run { tier: "llm_judge" } with EVAL_JUDGE_ENABLED=true but no ANTHROPIC_API_KEY → 503
  15. slope() helper: [0,1,2,3,4] → positive slope, [4,3,2,1,0] → negative slope

Mock pattern (same as existing tests):
  vi.mock("../src/db", () => ({ db: { snapshot: {...}, evalRun: {...}, ... } }))
  vi.mock("../src/services/bundle.service", () => ({ readBundle: vi.fn() }))

Create docs/evals.md covering:
  - What the evaluation layer does and when each tier runs
  - The 3 tiers: deterministic (always auto), LLM judge (on-demand only), trajectory (always auto)
  - How to read EvalRun.score vs EvalRun.label
  - How to configure evaluators via PATCH /v1/eval-config
  - The flagging logic and threshold customization
  - How to trigger a manual LLM judge run via POST /v1/snapshots/:id/evals/run { tier: "llm_judge" }
  - The EVAL_JUDGE_ENABLED flag: default false, set to true only when ready to incur API costs
  - What the 402 response means and how to communicate it to users in the dashboard

Final verification:
  npm run build      → no TypeScript errors
  npm test           → all tests pass including evals.test.ts
  npm run eval-worker → starts, prints "[eval-worker] Started"
  Create a snapshot via proxy or ingest → within 5s, EvalRuns appear in DB
  GET /v1/evaluators → 200, 19 items
  GET /v1/evals/flags → 200 (may be empty)
```

---

## API Surface Added by This Guide

```
GET    /v1/evaluators                      ← static registry, 19 evaluators
GET    /v1/eval-config                     ← effective config for authenticated user
PATCH  /v1/eval-config                     ← toggle evaluator, set threshold

GET    /v1/snapshots/:id/evals             ← all EvalRuns for one snapshot
GET    /v1/sessions/:id/evals              ← per-snapshot EvalRun arrays for session
GET    /v1/sessions/:id/evals/trajectory   ← trajectory trend data with points arrays
GET    /v1/evals/flags                     ← flagged EvalRuns for user [?session_id=]
POST   /v1/snapshots/:id/evals/run         ← manual re-run trigger
```

No existing endpoints change.

---

## Updated Railway Services

```toml
[[services]]
name = "kontex-eval-worker"
startCommand = "node dist/workers/eval.worker.js"
```

Add alongside the existing `kontex-span-worker` and `kontex-embed-worker` services.

---

*Kontex Eval Backend Build Guide · v1.0*
*Sprints 12–13 · 10 prompts*
*Prerequisite: Sprints 1–11 of kontex-backend-2.0-buildguide.md complete*
*Stack: Hono · Prisma · PostgreSQL · Redis · Anthropic SDK (Claude Haiku for judge evals)*
*No existing routes, services, or workers modified*
