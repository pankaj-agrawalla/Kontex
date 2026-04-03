# Kontex Backend 2.0 — Build Guide
### Changes only. Sprints 1–8 are complete and untouched.

---

## What This Guide Covers

Sprints 1–8 built the foundation: auth, sessions, tasks, snapshots, R2 bundles, HTTP proxy, rollback, MCP write tools, dashboard REST API, semantic search, rate limiting, and Railway deploy. That code is not touched.

This guide adds three things:

| Sprint | What | Why |
|---|---|---|
| **9** | OpenLLMetry OTLP ingest | Replaces the Anthropic-only proxy as primary capture path. Any provider, any framework, two lines of developer setup. |
| **10** | tRPC + SSE | Type-safe dashboard API. Real-time timeline push instead of polling. |
| **11** | MCP read tools | Agents can query their own context history during execution, not just write checkpoints. |

These three sprints are independent. Sprint 11 has no dependency on Sprint 10. Execute in order but each is self-contained.

---

## The One Invariant That Doesn't Change

Snapshots are immutable once finalized. Rollback creates a new snapshot — it never deletes or mutates history. This rule applies to all new capture paths identically.

---

## Updated Architecture

```
Capture paths
─────────────────────────────────────────────────────
OpenLLMetry SDK   →  POST /ingest/v1/traces  ─┐  ← PRIMARY (new, Sprint 9)
HTTP Proxy        →  POST /proxy/v1/messages ─┤  ← FALLBACK (existing)
MCP write tools   →  POST /mcp              ─┘  ← ADVANCED (existing)
                           ↓
                    span.processor.ts
                    (OTLP → ContextBundle)
                           ↓
               PostgreSQL + R2 + Qdrant + Redis

Serve paths
─────────────────────────────────────────────────────
REST  /v1/*         Third-party tools, CLIs          ← existing, unchanged
tRPC  /trpc/*       Dashboard frontend only          ← new, Sprint 10
SSE   /sse/*        Dashboard live feed only         ← new, Sprint 10
MCP   /mcp          Agent read + write tools         ← read tools new, Sprint 11
```

---

## Updated Project Structure

New files only. Every existing file is unchanged.

```
kontex-api/
├── prisma/
│   └── schema.prisma           ← two migrations added in Sprint 9
├── src/
│   ├── index.ts                ← two new route mounts added
│   ├── lib/
│   │   └── events.ts           ← Redis pub/sub publish helpers (new)
│   ├── receivers/              ← new directory
│   │   ├── otlp.parser.ts
│   │   ├── span.mapper.ts
│   │   └── span.processor.ts
│   ├── routes/
│   │   ├── ingest.ts           ← new: POST /ingest/v1/traces
│   │   └── sse.ts              ← new: GET /sse/session/:id/feed
│   ├── trpc/                   ← new directory
│   │   ├── context.ts
│   │   ├── router.ts
│   │   ├── trpc.ts
│   │   ├── types.ts
│   │   └── routers/
│   │       ├── sessions.ts
│   │       ├── snapshots.ts
│   │       └── dashboard.ts
│   ├── workers/
│   │   └── span.worker.ts      ← new worker process
│   └── mcp/
│       └── tools/
│           └── context.tools.ts ← new: 3 read tools
├── tests/
│   ├── ingest.test.ts          ← new
│   ├── trpc.test.ts            ← new
│   └── sse.test.ts             ← new
└── docs/
    └── openllmetry-quickstart.md ← new
```

---

## Updated Environment Variables

No new environment variables. The span-worker uses the existing PostgreSQL, R2, and Redis connections.

The Redis queue key `kontex:span_jobs` is an internal implementation constant — it is not deployment-configurable.

---

## Updated Package Scripts

Add to `package.json`. All existing scripts unchanged.

```json
{
  "scripts": {
    "span-worker": "dotenv-cli -e .env -- tsx watch src/workers/span.worker.ts"
  }
}
```

---

## Updated Dependencies

```bash
# Sprint 9
# No new npm packages required.
# OpenLLMetry sends standard OTLP/HTTP JSON — no decoder library needed.
# The span-worker reuses existing db, redis, r2 singletons.

# Sprint 10
npm install @trpc/server @hono/trpc-server

# Sprint 11
# No new packages. Uses existing db and embed.service (Qdrant + Voyage).
```

---

---

# SPRINT 9 — OpenLLMetry OTLP Ingest

**Prerequisite:** Sprints 1–8 complete.

**What this adds:** A single OTLP/HTTP endpoint that accepts spans from the OpenLLMetry SDK. OpenLLMetry auto-instruments Anthropic, OpenAI, LangChain, LlamaIndex, CrewAI, Bedrock, Gemini, and 15+ other providers. Developers point the SDK at Kontex and every LLM call becomes a snapshot automatically — no framework-specific code on Kontex's side.

**How OpenLLMetry connects to Kontex:**

Node.js:
```typescript
import * as traceloop from "@traceloop/node-server-sdk"
// Import BEFORE any LLM library
traceloop.initialize({
  baseUrl: "https://api.usekontex.com",
  headers: {
    "X-Kontex-Api-Key":    process.env.KONTEX_API_KEY,
    "X-Kontex-Session-Id": process.env.KONTEX_SESSION_ID,
  },
  disableBatch: process.env.NODE_ENV === "development",
})
```

Python:
```python
from traceloop.sdk import Traceloop
# Call BEFORE importing any LLM library
Traceloop.init(
    app_name="my-agent",
    base_url="https://api.usekontex.com",
    headers={
        "X-Kontex-Api-Key":    os.environ["KONTEX_API_KEY"],
        "X-Kontex-Session-Id": os.environ["KONTEX_SESSION_ID"],
    },
)
```

**Key OpenLLMetry attribute schema** (what the span.mapper reads):

```
traceloop.span.kind        "llm" | "workflow" | "task" | "agent" | "tool"
traceloop.workflow.name    from @workflow decorator
traceloop.task.name        from @task decorator
traceloop.agent.name       from @agent decorator
traceloop.tool.name        from @tool decorator
traceloop.entity.input     tool input (JSON string)
traceloop.entity.output    tool output (JSON string)

llm.request.model          "claude-opus-4-6", "gpt-4o", etc.
llm.response.model         actual model used
llm.usage.prompt_tokens    input token count
llm.usage.completion_tokens output token count
llm.usage.total_tokens     total
llm.prompts                JSON string of messages array — OR indexed:
llm.prompts.0.role         indexed format (varies by SDK version)
llm.prompts.0.content
llm.completions            JSON string of completions — OR indexed:
llm.completions.0.content
```

Only `traceloop.span.kind === "llm"` spans create Snapshot records.
Workflow/task/agent/tool spans are stored as `OtelSpan` records for graph construction but do not become snapshots.

**Done criteria:**
- [ ] `POST /ingest/v1/traces` accepts OTLP/HTTP JSON, returns `200 { received: N }`
- [ ] Auth via `X-Kontex-Api-Key` header — missing/invalid → 401
- [ ] Raw `OtelSpan` upserted to Postgres before 200 returns (data safe)
- [ ] Duplicate `spanId` is idempotent — upsert, not error
- [ ] Span processing async via Redis queue — 200 returns before any Snapshot is created
- [ ] `llm` spans → Snapshot + R2 bundle with correct messages, tokens, model
- [ ] Non-`llm` spans → `OtelSpan` record only, no Snapshot
- [ ] `X-Kontex-Session-Id` header auto-links `traceId` to session on first span
- [ ] Unlinked spans stored as `OtelSpan`, warning logged, no Snapshot created
- [ ] `Snapshot.source === "openllmetry"`
- [ ] `npm test` passes including new `ingest.test.ts`

---

## Prompt 9.1 — Prisma migration

```
Make two changes to prisma/schema.prisma:

─── 1. Add OtelSpan model ───────────────────────────────────────────────────

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

─── 2. Add externalTraceId to Session ───────────────────────────────────────

In the Session model, add:
  externalTraceId String? @unique

─── 3. Run ──────────────────────────────────────────────────────────────────

npx prisma migrate dev --name openllmetry_ingest
npx prisma generate

─── 4. Update src/types/api.ts ──────────────────────────────────────────────

Change SnapshotSource to:
  export type SnapshotSource = "proxy" | "log_watcher" | "mcp" | "openllmetry"

─── Verify ──────────────────────────────────────────────────────────────────

npx prisma studio
Confirm: OtelSpan table present, Session.externalTraceId column present.
```

---

## Prompt 9.2 — OTLP type definitions

```
Create src/types/otel.ts

These types represent the OTLP/HTTP JSON wire format. Do not invent —
these are the exact structures the OpenLLMetry SDK sends.

─────────────────────────────────────────────────────────────────────────────

export interface OtlpAttributeValue {
  stringValue?: string
  intValue?: string        // int64 encoded as string in OTLP spec
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values: OtlpAttributeValue[] }
}

export interface OtlpAttribute {
  key: string
  value: OtlpAttributeValue
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OtlpAttribute[]
  events?: Array<{
    timeUnixNano: string
    name: string
    attributes?: OtlpAttribute[]
  }>
  status?: { code: number; message?: string }
}

export interface OtlpTracesPayload {
  resourceSpans: Array<{
    resource?: { attributes?: OtlpAttribute[] }
    scopeSpans: Array<{
      scope?: { name?: string; version?: string }
      spans: OtlpSpan[]
    }>
  }>
}

// Flattened span after parsing — what span.mapper and span.processor receive.
export interface FlatSpan {
  traceId: string
  spanId: string
  parentSpanId: string | undefined
  operationName: string
  serviceName: string
  spanKind: string
  startTime: Date
  endTime: Date
  durationMs: number
  attributes: Record<string, string | number | boolean>
}

─────────────────────────────────────────────────────────────────────────────

// Flatten OtlpAttribute[] to a plain key-value Record.
// Handles string, int (parsed), double, bool. Skips arrayValue.
export function extractAttributes(
  attrs: OtlpAttribute[] | undefined
): Record<string, string | number | boolean> {
  if (!attrs) return {}
  const result: Record<string, string | number | boolean> = {}
  for (const attr of attrs) {
    const v = attr.value
    if (v.stringValue !== undefined)      result[attr.key] = v.stringValue
    else if (v.intValue !== undefined)    result[attr.key] = parseInt(v.intValue, 10)
    else if (v.doubleValue !== undefined) result[attr.key] = v.doubleValue
    else if (v.boolValue !== undefined)   result[attr.key] = v.boolValue
  }
  return result
}

// Convert nanosecond timestamp string to Date.
// Uses BigInt — nanosecond values overflow Number precision.
export function nanoToDate(nanoStr: string): Date {
  return new Date(Number(BigInt(nanoStr) / 1_000_000n))
}
```

---

## Prompt 9.3 — OTLP payload parser

```
Create src/receivers/otlp.parser.ts

Parses the raw HTTP body into FlatSpan[].
This is the only file that knows the OTLP wire format.
Never throws — malformed individual spans are skipped with a warning.

─────────────────────────────────────────────────────────────────────────────

import { OtlpTracesPayload, FlatSpan, extractAttributes, nanoToDate } from "../types/otel"

export function parseOtlpPayload(body: unknown): FlatSpan[] {
  if (!body || typeof body !== "object") return []
  const payload = body as OtlpTracesPayload
  if (!Array.isArray(payload.resourceSpans)) return []

  const spans: FlatSpan[] = []

  for (const resourceSpan of payload.resourceSpans) {
    const resourceAttrs = extractAttributes(resourceSpan.resource?.attributes)
    const serviceName = String(resourceAttrs["service.name"] ?? "unknown-service")

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const rawSpan of scopeSpan.spans ?? []) {
        try {
          const attrs     = extractAttributes(rawSpan.attributes)
          const startTime = nanoToDate(rawSpan.startTimeUnixNano)
          const endTime   = nanoToDate(rawSpan.endTimeUnixNano)
          spans.push({
            traceId:       rawSpan.traceId,
            spanId:        rawSpan.spanId,
            parentSpanId:  rawSpan.parentSpanId || undefined,
            operationName: rawSpan.name,
            serviceName,
            spanKind:      String(attrs["traceloop.span.kind"] ?? "unknown"),
            startTime,
            endTime,
            durationMs:    endTime.getTime() - startTime.getTime(),
            attributes:    attrs,
          })
        } catch (err) {
          console.warn("[otlp-parser] Skipping malformed span:", (err as Error).message)
        }
      }
    }
  }

  return spans
}
```

---

## Prompt 9.4 — Span mapper

```
Create src/receivers/span.mapper.ts

Maps OpenLLMetry span attributes to ContextBundle fields.
All the attribute key constants are defined here — nowhere else references raw strings.

─────────────────────────────────────────────────────────────────────────────

import { FlatSpan } from "../types/otel"
import { Message, ToolCall } from "../types/bundle"

const TRACELOOP = {
  SPAN_KIND: "traceloop.span.kind",
  WORKFLOW:  "traceloop.workflow.name",
  TASK:      "traceloop.task.name",
  AGENT:     "traceloop.agent.name",
  TOOL:      "traceloop.tool.name",
  ENTITY:    "traceloop.entity.name",
  INPUT:     "traceloop.entity.input",
  OUTPUT:    "traceloop.entity.output",
} as const

const LLM = {
  REQUEST_MODEL:       "llm.request.model",
  RESPONSE_MODEL:      "llm.response.model",
  PROMPT_TOKENS:       "llm.usage.prompt_tokens",
  COMPLETION_TOKENS:   "llm.usage.completion_tokens",
  TOTAL_TOKENS:        "llm.usage.total_tokens",
  PROMPTS:             "llm.prompts",
  COMPLETIONS:         "llm.completions",
  TOOL_INPUT:          "llm.tool.input",
  TOOL_OUTPUT:         "llm.tool.output",
} as const

export type TraceloopSpanKind = "workflow" | "task" | "agent" | "tool" | "llm" | "unknown"

export interface MappedSpan {
  spanKind:      TraceloopSpanKind
  isLlmCall:     boolean
  model:         string
  tokenTotal:    number
  inputTokens:   number
  outputTokens:  number
  messages:      Message[]
  toolCalls:     ToolCall[]
  workflowName:  string | undefined
  taskName:      string | undefined
  agentName:     string | undefined
  toolName:      string | undefined
}

export function mapSpan(span: FlatSpan): MappedSpan {
  const a = span.attributes

  const rawKind  = String(a[TRACELOOP.SPAN_KIND] ?? "unknown").toLowerCase()
  const validKinds: TraceloopSpanKind[] = ["workflow","task","agent","tool","llm"]
  const spanKind = (validKinds.includes(rawKind as TraceloopSpanKind)
    ? rawKind : "unknown") as TraceloopSpanKind

  const isLlmCall    = spanKind === "llm"
  const model        = String(a[LLM.RESPONSE_MODEL] ?? a[LLM.REQUEST_MODEL] ?? "unknown")
  const inputTokens  = Number(a[LLM.PROMPT_TOKENS]    ?? 0)
  const outputTokens = Number(a[LLM.COMPLETION_TOKENS] ?? 0)
  const tokenTotal   = Number(a[LLM.TOTAL_TOKENS]      ?? inputTokens + outputTokens)

  // ── Parse input messages ──────────────────────────────────────────────────
  // OpenLLMetry emits one of two formats depending on SDK version:
  //   Format A — JSON string: llm.prompts = '[{"role":"user","content":"..."}]'
  //   Format B — indexed:     llm.prompts.0.role, llm.prompts.0.content, ...
  const messages: Message[] = []

  if (a[LLM.PROMPTS]) {
    try {
      const raw = JSON.parse(String(a[LLM.PROMPTS]))
      if (Array.isArray(raw)) {
        for (const m of raw) {
          messages.push({
            role:      m.role ?? "user",
            content:   m.content ?? m.text ?? "",
            timestamp: span.startTime.toISOString(),
          })
        }
      }
    } catch { /* fall through to indexed format */ }
  }

  if (messages.length === 0) {
    let i = 0
    while (a[`llm.prompts.${i}.role`] !== undefined) {
      messages.push({
        role:      String(a[`llm.prompts.${i}.role`]),
        content:   String(a[`llm.prompts.${i}.content`] ?? ""),
        timestamp: span.startTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse completions → append as assistant message(s) ───────────────────
  // Anthropic wraps content in c.text or c.message.content (array of blocks).
  // OpenAI wraps in c.message.content (string). Both handled below.
  if (a[LLM.COMPLETIONS]) {
    try {
      const raw = JSON.parse(String(a[LLM.COMPLETIONS]))
      if (Array.isArray(raw)) {
        for (const c of raw) {
          let content = ""
          if (typeof c.text === "string") {
            content = c.text
          } else if (typeof c.message?.content === "string") {
            content = c.message.content
          } else if (Array.isArray(c.message?.content)) {
            content = c.message.content
              .map((b: { text?: string }) => b.text ?? "")
              .join("")
          } else if (typeof c.content === "string") {
            content = c.content
          }
          messages.push({ role: "assistant", content, timestamp: span.endTime.toISOString() })
        }
      }
    } catch { /* skip malformed completions */ }
  }

  if (!a[LLM.COMPLETIONS]) {
    let i = 0
    while (a[`llm.completions.${i}.content`] !== undefined) {
      messages.push({
        role:      "assistant",
        content:   String(a[`llm.completions.${i}.content`]),
        timestamp: span.endTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse tool calls (spanKind === "tool") ────────────────────────────────
  const toolCalls: ToolCall[] = []
  if (spanKind === "tool") {
    const toolName = String(a[TRACELOOP.TOOL] ?? a[TRACELOOP.ENTITY] ?? span.operationName)
    const inputStr  = String(a[LLM.TOOL_INPUT]  ?? a[TRACELOOP.INPUT]  ?? "{}")
    const outputStr = String(a[LLM.TOOL_OUTPUT] ?? a[TRACELOOP.OUTPUT] ?? "{}")
    let input: unknown = {}
    let output: unknown = {}
    try { input  = JSON.parse(inputStr)  } catch { input  = inputStr  }
    try { output = JSON.parse(outputStr) } catch { output = outputStr }
    toolCalls.push({
      tool:      toolName,
      input,
      output,
      status:    a["error"] ? "error" : "success",
      timestamp: span.startTime.toISOString(),
    })
  }

  return {
    spanKind,
    isLlmCall,
    model,
    tokenTotal,
    inputTokens,
    outputTokens,
    messages,
    toolCalls,
    workflowName: a[TRACELOOP.WORKFLOW] !== undefined ? String(a[TRACELOOP.WORKFLOW]) : undefined,
    taskName:     a[TRACELOOP.TASK]     !== undefined ? String(a[TRACELOOP.TASK])     : undefined,
    agentName:    a[TRACELOOP.AGENT]    !== undefined ? String(a[TRACELOOP.AGENT])    : undefined,
    toolName:     a[TRACELOOP.TOOL]     !== undefined ? String(a[TRACELOOP.TOOL])     : undefined,
  }
}

// Human-readable Snapshot.label derived from the span.
export function buildLabel(span: FlatSpan, mapped: MappedSpan): string {
  if (mapped.workflowName) return `workflow: ${mapped.workflowName}`
  if (mapped.agentName)    return `agent: ${mapped.agentName}`
  if (mapped.taskName)     return `task: ${mapped.taskName}`
  if (mapped.toolName)     return `tool: ${mapped.toolName}`
  if (mapped.isLlmCall)    return `${mapped.model} · ${span.durationMs}ms`
  return span.operationName
}
```

---

## Prompt 9.5 — Span processor

```
Create src/receivers/span.processor.ts

Runs inside span.worker.ts. Reads a stored OtelSpan record, maps it,
creates a Snapshot + R2 bundle if it is an LLM span, marks it PROCESSED.

─────────────────────────────────────────────────────────────────────────────

import { nanoid }     from "nanoid"
import { db }         from "../db"
import { redis }      from "../redis"
import { writeBundle } from "../services/bundle.service"
import { mapSpan, buildLabel } from "./span.mapper"
import type { FlatSpan } from "../types/otel"
import type { ContextBundle } from "../types/bundle"

export async function processSpan(otelSpanId: string): Promise<void> {
  const raw = await db.otelSpan.findUnique({ where: { id: otelSpanId } })
  if (!raw || raw.status !== "PENDING") return

  try {
    const span: FlatSpan = {
      traceId:       raw.traceId,
      spanId:        raw.spanId,
      parentSpanId:  raw.parentSpanId ?? undefined,
      operationName: raw.operationName,
      serviceName:   raw.serviceName,
      spanKind:      raw.spanKind,
      startTime:     raw.startTime,
      endTime:       raw.endTime,
      durationMs:    raw.durationMs,
      attributes:    raw.attributes as Record<string, string | number | boolean>,
    }

    const mapped = mapSpan(span)

    // Non-LLM spans: mark processed but do not create a Snapshot.
    // They are stored for future graph construction but are not snapshots.
    if (!mapped.isLlmCall) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      return
    }

    // Find the Kontex session linked to this traceId.
    // Linking happens via POST /v1/sessions/:id/link-trace
    // or automatically via the X-Kontex-Session-Id header on the ingest request.
    const session = await db.session.findFirst({ where: { externalTraceId: raw.traceId } })

    if (!session) {
      await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "PROCESSED" } })
      console.warn(
        `[span-processor] No session linked for traceId ${raw.traceId}. ` +
        `Pass X-Kontex-Session-Id on the /ingest request, or call POST /v1/sessions/:id/link-trace.`
      )
      return
    }

    // Find or create the auto-task for this session.
    let task = await db.task.findFirst({
      where: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
    })
    if (!task) {
      task = await db.task.create({
        data: { sessionId: session.id, name: "openllmetry-auto", status: "ACTIVE" },
      })
    }

    const snapshotId = nanoid(21)
    const label      = buildLabel(span, mapped)

    const bundle: ContextBundle = {
      snapshotId,
      taskId:     task.id,
      sessionId:  session.id,
      capturedAt: raw.startTime.toISOString(),
      model:      mapped.model,
      tokenTotal: mapped.tokenTotal,
      source:     "openllmetry",
      enriched:   true,   // OpenLLMetry spans are self-contained — no enrichment window
      files:      [],
      toolCalls:  mapped.toolCalls,
      messages:   mapped.messages,
      reasoning:  undefined,
      logEvents: [{
        type:      "openllmetry_span",
        timestamp: raw.startTime.toISOString(),
        data: {
          traceId:       raw.traceId,
          spanId:        raw.spanId,
          spanKind:      mapped.spanKind,
          operationName: raw.operationName,
          durationMs:    raw.durationMs,
          workflowName:  mapped.workflowName,
          agentName:     mapped.agentName,
          taskName:      mapped.taskName,
        },
      }],
    }

    const r2Key    = await writeBundle(snapshotId, bundle)
    const snapshot = await db.snapshot.create({
      data: {
        id:         snapshotId,
        taskId:     task.id,
        label,
        tokenTotal: mapped.tokenTotal,
        model:      mapped.model,
        source:     "openllmetry",
        r2Key,
        enriched:   true,
        enrichedAt: new Date(),
      },
    })

    await db.otelSpan.update({
      where: { id: otelSpanId },
      data:  { status: "PROCESSED", snapshotId: snapshot.id },
    })

    // Queue for Qdrant embedding (same queue as proxy snapshots)
    redis.rpush("kontex:embed_jobs", JSON.stringify({ snapshotId: snapshot.id }))
      .catch(err => console.error("[span-processor] Failed to queue embed job:", err))

  } catch (err) {
    await db.otelSpan.update({ where: { id: otelSpanId }, data: { status: "FAILED" } })
    console.error(`[span-processor] Failed to process span ${otelSpanId}:`, err)
  }
}
```

---

## Prompt 9.6 — Span worker

```
Create src/workers/span.worker.ts

Separate process. Reads span IDs from Redis queue, calls processSpan.
One bad span never stops the worker.

─────────────────────────────────────────────────────────────────────────────

import { redis } from "../redis"
import { processSpan } from "../receivers/span.processor"

async function run(): Promise<void> {
  console.log("[span-worker] Started — waiting for OpenLLMetry spans")
  while (true) {
    const result = await redis.blpop("kontex:span_jobs", 0)
    if (!result) continue
    const [, raw] = result
    try {
      const { otelSpanId } = JSON.parse(raw)
      processSpan(otelSpanId).catch(err =>
        console.error("[span-worker] Error processing span:", otelSpanId, err)
      )
    } catch (err) {
      console.error("[span-worker] Malformed job payload:", raw, err)
    }
  }
}

run()
```

---

## Prompt 9.7 — Ingest route + link-trace endpoint

```
─── Create src/routes/ingest.ts ─────────────────────────────────────────────

POST /ingest/v1/traces

Auth: X-Kontex-Api-Key header (same pattern as /proxy — NOT Bearer auth).
  Lookup ApiKey: must exist and active → 401 if not.
  Set userId from apiKey.userId.

Content-Type check:
  Accept application/json only.
  Anything else → 415 { error: "unsupported_media_type", message: "Only application/json OTLP supported" }

Processing:
  1. Parse body: const spans = parseOtlpPayload(await c.req.json())
     If spans is empty → return 200 { received: 0 }

  2. Auto-link convenience:
     Read X-Kontex-Session-Id header.
     If present → find session where id = sessionId AND userId = userId
     If found AND session.externalTraceId is null:
       db.session.update({ where: { id: sessionId }, data: { externalTraceId: spans[0].traceId } })
       Await this — it is fast and needed before span processing begins.
     If externalTraceId already set → skip (never overwrite).

  3. For each FlatSpan, upsert to OtelSpan:
     db.otelSpan.upsert({
       where:  { spanId: span.spanId },
       create: {
         traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
         serviceName: span.serviceName, operationName: span.operationName,
         spanKind: span.spanKind, startTime: span.startTime, endTime: span.endTime,
         durationMs: span.durationMs, attributes: span.attributes as Prisma.InputJsonValue,
       },
       update: {},   // idempotent — duplicate spanId, do nothing
     })
     Collect returned/found ids.

  4. For each stored OtelSpan, push to Redis queue (fire-and-forget):
     redis.rpush("kontex:span_jobs", JSON.stringify({ otelSpanId }))
       .catch(err => console.error("[ingest] Failed to queue:", err))

  5. Return 200: { received: spans.length }

  The 200 must return before any span processing.
  Steps 1–3 are awaited (raw data persisted before responding).
  Step 4 is fire-and-forget.

─── Add to src/routes/sessions.ts ───────────────────────────────────────────

POST /v1/sessions/:id/link-trace

Auth: standard Bearer auth (this is a REST endpoint, not ingest).
Zod body: { traceId: z.string().min(1) }

Validate session ownership → 404 if not found or wrong user.

If session.externalTraceId already set AND !== incoming traceId:
  Return 409 { error: "conflict",
    message: "Session already linked to a different traceId. Create a new session for a new trace." }
If session.externalTraceId === incoming traceId:
  Return 200 { sessionId: id, externalTraceId: traceId }  // idempotent
Otherwise:
  db.session.update({ where: { id }, data: { externalTraceId: traceId } })
  Return 200 { sessionId: id, externalTraceId: traceId }

Also update GET /v1/sessions/:id to include externalTraceId in the response.
Also update PATCH /v1/sessions/:id Zod body to accept externalTraceId?: z.string().optional().

─── Update src/index.ts ─────────────────────────────────────────────────────

Add these two lines after all existing route mounts:

  import ingestRouter from "./routes/ingest"
  app.route("/ingest", ingestRouter)

  Note: /ingest/* does NOT use the standard /v1/* Bearer auth middleware.
  The ingest route handles its own auth via X-Kontex-Api-Key.

─── Update railway.toml ─────────────────────────────────────────────────────

Add a third service:

[[services]]
name = "kontex-span-worker"
startCommand = "node dist/workers/span.worker.js"
```

---

## Prompt 9.8 — Ingest tests

```
Create tests/ingest.test.ts

─── Test fixture ────────────────────────────────────────────────────────────

const makeSpan = (overrides: Partial<{
  traceId: string; spanId: string; model: string;
  promptTokens: number; completionTokens: number
}> = {}) => ({
  resourceSpans: [{
    resource: {
      attributes: [{ key: "service.name", value: { stringValue: "test-agent" } }]
    },
    scopeSpans: [{
      scope: { name: "opentelemetry.instrumentation.anthropic" },
      spans: [{
        traceId:           overrides.traceId          ?? "aabb" + "0".repeat(28),
        spanId:            overrides.spanId           ?? "ccdd" + "0".repeat(12),
        name:              "anthropic.messages.create",
        kind:              3,
        startTimeUnixNano: "1700000000000000000",
        endTimeUnixNano:   "1700000001500000000",
        attributes: [
          { key: "traceloop.span.kind",         value: { stringValue: "llm" } },
          { key: "llm.request.model",           value: { stringValue: overrides.model ?? "claude-opus-4-6" } },
          { key: "llm.response.model",          value: { stringValue: overrides.model ?? "claude-opus-4-6" } },
          { key: "llm.usage.prompt_tokens",     value: { intValue: String(overrides.promptTokens    ?? 120) } },
          { key: "llm.usage.completion_tokens", value: { intValue: String(overrides.completionTokens ?? 45)  } },
          { key: "llm.usage.total_tokens",      value: { intValue: String((overrides.promptTokens ?? 120) + (overrides.completionTokens ?? 45)) } },
          { key: "llm.prompts.0.role",          value: { stringValue: "user" } },
          { key: "llm.prompts.0.content",       value: { stringValue: "Refactor the auth module" } },
          { key: "llm.completions.0.content",   value: { stringValue: "Here is the refactored auth module..." } },
        ],
        events: [],
        status: { code: 1 }
      }]
    }]
  }]
})

─── Tests ───────────────────────────────────────────────────────────────────

test("POST /ingest/v1/traces returns 200 { received: 1 }", async () => {
  const res = await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(200)
  expect((await res.json()).received).toBe(1)
})

test("Missing auth → 401", async () => {
  const res = await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(401)
})

test("OtelSpan record created in DB", async () => {
  const spanId = "test-" + Date.now()
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan({ spanId })),
  })
  await new Promise(r => setTimeout(r, 200))
  const record = await db.otelSpan.findUnique({ where: { spanId } })
  expect(record).not.toBeNull()
  expect(record?.spanKind).toBe("llm")
})

test("Duplicate spanId is idempotent", async () => {
  const spanId = "dedup-" + Date.now()
  const payload = makeSpan({ spanId })
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(payload),
  })
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(payload),
  })
  const count = await db.otelSpan.count({ where: { spanId } })
  expect(count).toBe(1)
})

test("Linked session → Snapshot created with source openllmetry", async () => {
  const traceId = "trace-" + Date.now()

  // Create session + link trace
  const sessRes = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "OpenLLMetry test" }),
  })
  const { id: sessionId } = await sessRes.json()

  await fetch(`http://localhost:3000/v1/sessions/${sessionId}/link-trace`, {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ traceId }),
  })

  // Send span
  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": "test_key_dev" },
    body: JSON.stringify(makeSpan({ traceId, spanId: "snap-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 1000))  // wait for span-worker

  const snapRes = await fetch(`http://localhost:3000/v1/sessions/${sessionId}/snapshots`, {
    headers: { "Authorization": "Bearer test_key_dev" },
  })
  const { data } = await snapRes.json()
  expect(data.length).toBeGreaterThan(0)
  expect(data[0].source).toBe("openllmetry")
})

test("X-Kontex-Session-Id header auto-links trace", async () => {
  const traceId = "auto-" + Date.now()
  const sessRes = await fetch("http://localhost:3000/v1/sessions", {
    method: "POST",
    headers: { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Auto-link test" }),
  })
  const { id: sessionId } = await sessRes.json()

  await fetch("http://localhost:3000/ingest/v1/traces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Kontex-Api-Key": "test_key_dev",
      "X-Kontex-Session-Id": sessionId,
    },
    body: JSON.stringify(makeSpan({ traceId, spanId: "autolink-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 200))
  const sess = await db.session.findUnique({ where: { id: sessionId } })
  expect(sess?.externalTraceId).toBe(traceId)
})

Run: npm test
All existing sprint 1–8 tests must still pass.
```

---

## Prompt 9.9 — OpenLLMetry quickstart docs

```
Write docs/openllmetry-quickstart.md

─────────────────────────────────────────────────────────────────────────────

# Kontex + OpenLLMetry Quickstart

## What you get

Every LLM call your agent makes — regardless of provider or framework — captured as an
immutable Kontex snapshot. Anthropic, OpenAI, Gemini, Bedrock, LangChain, LlamaIndex,
CrewAI, and 15+ others. Two lines of setup. Zero changes to agent logic.

## Supported providers and frameworks

LLM providers: Anthropic · OpenAI · Azure OpenAI · Amazon Bedrock · Google Gemini ·
Google VertexAI · Cohere · Mistral AI · Groq · Ollama · HuggingFace · IBM watsonx ·
Replicate · together.ai

Frameworks: LangChain (Python + JS) · LlamaIndex (Python + JS) · CrewAI ·
Haystack · Agno · Burr · LiteLLM · OpenAI Agents SDK · AWS Strands

## Step 1: Create a session

  curl -X POST https://api.usekontex.com/v1/sessions \
    -H "Authorization: Bearer {KONTEX_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"name": "my-agent-session"}'

  Save the returned id as KONTEX_SESSION_ID.

## Step 2: Install OpenLLMetry

  npm install @traceloop/node-server-sdk    # Node.js
  pip install traceloop-sdk                 # Python

## Step 3: Initialize before any LLM import

### Node.js

  // MUST come before any import of Anthropic, OpenAI, LangChain, etc.
  import * as traceloop from "@traceloop/node-server-sdk"

  traceloop.initialize({
    baseUrl: "https://api.usekontex.com",
    headers: {
      "X-Kontex-Api-Key":    process.env.KONTEX_API_KEY!,
      "X-Kontex-Session-Id": process.env.KONTEX_SESSION_ID!,
    },
    disableBatch: process.env.NODE_ENV === "development",
  })

  // Now import LLM libraries — they are automatically instrumented
  import Anthropic from "@anthropic-ai/sdk"

### Python

  # MUST come before any import of anthropic, openai, langchain, etc.
  from traceloop.sdk import Traceloop

  Traceloop.init(
      app_name="my-agent",
      base_url="https://api.usekontex.com",
      headers={
          "X-Kontex-Api-Key":    os.environ["KONTEX_API_KEY"],
          "X-Kontex-Session-Id": os.environ["KONTEX_SESSION_ID"],
      },
      disable_batch=os.environ.get("ENV") == "development",
  )

  # Now import LLM libraries — they are automatically instrumented
  import anthropic

## Step 4: Run your agent unchanged

Your existing agent code runs as-is. Every LLM call is captured.

## Step 5: Verify

  curl https://api.usekontex.com/v1/sessions/{KONTEX_SESSION_ID}/snapshots \
    -H "Authorization: Bearer {KONTEX_API_KEY}"

## Framework examples

### LangChain (Python)
  Call Traceloop.init() at top of file, then use LangChain agents and chains normally.
  Every LLM call inside chains is auto-captured.

### LangChain.js
  Call traceloop.initialize() before importing langchain. Normal chain code after.

### LlamaIndex (Python)
  Call Traceloop.init(), then use QueryEngine, AgentRunner, etc. normally.

### CrewAI
  Call Traceloop.init(), then define Crew, Agent, Task normally.
  Each agent's LLM calls become separate snapshots.

### Raw OpenAI SDK (Python)
  Call Traceloop.init(), then openai.chat.completions.create() is auto-captured.

## Adding workflow structure (optional)

Wrap your own code to add semantic labels in the dashboard:

### Node.js
  import { withWorkflow, withTask, withAgent, withTool } from "@traceloop/node-server-sdk"

  const result = await withWorkflow({ name: "refactor-agent" }, async () => {
    const plan = await withTask({ name: "plan" }, () => generatePlan())
    const code = await withTask({ name: "execute" }, () => writeCode(plan))
    return code
  })

### Python
  from traceloop.sdk.decorators import workflow, task, agent, tool

  @workflow(name="refactor-agent")
  def run_agent():
      plan = generate_plan()
      return write_code(plan)

  @task(name="generate-plan")
  def generate_plan(): ...

## Import order is critical

OpenLLMetry patches LLM libraries at import time. If you import Anthropic or OpenAI
before calling initialize() / Traceloop.init(), the instrumentation will not activate.
Always initialize first.

## Using the HTTP proxy instead

If you cannot modify your agent code, see docs/quickstart.md for the proxy fallback.
The proxy works with Anthropic-compatible APIs only.

─────────────────────────────────────────────────────────────────────────────

Done criteria:
  - [ ] npm run dev + npm run span-worker running simultaneously
  - [ ] Send OTLP test payload: tsx tests/ingest-e2e.ts
  - [ ] GET /v1/sessions/:id/snapshots shows source "openllmetry"
  - [ ] docs/openllmetry-quickstart.md accurate against local endpoint
```

---

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

# SPRINT 11 — MCP Read Tools

**Prerequisite:** Sprint 9 complete. (Sprint 10 not required for this sprint.)

**What this adds:** Three read tools to the existing MCP server. Agents can now query their own context history during execution — searching past snapshots, retrieving prior context, and listing what's been captured. The six write tools from Sprint 6 are unchanged.

**Done criteria:**
- [ ] `kontex_search` returns formatted semantically relevant snapshots
- [ ] `kontex_get_context` returns formatted ContextBundle ready for agent re-injection
- [ ] `kontex_list_snapshots` returns recent snapshot table for a session
- [ ] All three tools scoped to authenticated user — no cross-user reads
- [ ] All tools return descriptive strings, never stack traces
- [ ] Total MCP tool count: 9 (6 existing + 3 new)
- [ ] `docs/mcp-advanced.md` updated with read tool documentation and CLAUDE.md snippet

---

## Prompt 11.1 — MCP read tools

```
Create src/mcp/tools/context.tools.ts

Import: db, embed.service (Qdrant + Voyage), snapshot.service, config

─── Tool 1: kontex_search ───────────────────────────────────────────────────

Name: kontex_search
Description:
  "Search past snapshots semantically. Use this when you need to recall what was done
   in a previous run, find prior context for the current task, or check whether a similar
   problem was already solved. Returns snapshot IDs — call kontex_get_context with any ID
   to retrieve the full bundle."
Input schema:
  query:      string — natural language description of what you're looking for
  limit?:     number — default 5, max 20
  session_id?: string — if provided, search within that session only

Handler:
  If config.QDRANT_URL or config.VOYAGE_API_KEY is empty string:
    return "Semantic search is not configured on this Kontex instance. Use kontex_list_snapshots to browse by recency."
  Embed query: voyage.embed({ input: [query], model: "voyage-code-3" })
  Build Qdrant filter: must match userId; if session_id provided also match sessionId
  Search Qdrant: { vector: queryVector, limit, filter, with_payload: true }
  Format response as a plain-text list the agent can read directly:

    "Found {N} relevant snapshots:

     1. [{label}] — {capturedAt} — {tokenTotal} tokens — source: {source}
        Snapshot ID: {snapshotId}

     2. [...]

     Call kontex_get_context with any Snapshot ID above to retrieve the full bundle."

  All results must be scoped to userId — never return another user's data.

─── Tool 2: kontex_get_context ──────────────────────────────────────────────

Name: kontex_get_context
Description:
  "Retrieve the full context bundle for a snapshot. Use this to inspect prior agent
   state — the bundle contains the complete message history, tool call log, and
   reasoning trace captured at that point in time. Also shows how to roll back to it."
Input schema:
  snapshot_id: string

Handler:
  Call getSnapshot(snapshot_id, userId) from snapshot.service
  If NOT_FOUND: return "Snapshot not found or access denied. Use kontex_list_snapshots to find available IDs."
  If R2_READ_FAILED: return "Failed to read snapshot bundle from storage. Try again."
  Format response:

    "Snapshot: {label}
     Captured: {capturedAt} | Model: {model} | Tokens: {tokenTotal} | Source: {source}

     === MESSAGES ({count}) ===
     {For each message — role: ROLE, content truncated to 300 chars, note [truncated] if cut}

     === TOOL CALLS ({count}) ===
     {For each — tool_name → status (timestamp)}

     === TO ROLLBACK ===
     Call kontex_rollback with snapshot_id: \"{snapshotId}\"
     Or POST /v1/snapshots/{snapshotId}/rollback via REST API."

─── Tool 3: kontex_list_snapshots ───────────────────────────────────────────

Name: kontex_list_snapshots
Description:
  "List recent snapshots for a session. Use this to see what has been captured and
   find snapshot IDs for kontex_get_context or kontex_rollback."
Input schema:
  session_id: string
  limit?:     number — default 10, max 50

Handler:
  Validate session ownership via db.session.findUnique — if not found or wrong user:
    return "Session not found or access denied."
  Fetch snapshots: taskId in session's task IDs, ordered createdAt desc, take limit
  Format as a readable table:

    "Recent snapshots for session {sessionId} ({N} shown):

     ID                    | Label                    | Captured        | Tokens | Source
     ──────────────────────┼──────────────────────────┼─────────────────┼────────┼─────────────
     {id first 20 chars}.. | {label first 30 chars}   | YYYY-MM-DD HH:MM| {N}    | {source}
     ...

     Call kontex_get_context with any full ID above to retrieve the bundle."

  Use full snapshot IDs in the table, not truncated ones — agents need to pass them to kontex_get_context.
  The display truncation in the label column is cosmetic only.

─── Register in src/mcp/server.ts ───────────────────────────────────────────

Import and register all three new tools alongside the existing six.
Total tool count after this sprint: 9.

─── Update docs/mcp-advanced.md ─────────────────────────────────────────────

Add new section: ## Reading context during agent execution (new in v2)

Explain when to call each read tool. Include this updated CLAUDE.md snippet:

  "Kontex MCP tools are available for session state management.

   WRITE tools — call during execution:
   - kontex_session_start:  at the beginning of a new working session
   - kontex_task_start:     when beginning a discrete unit of work
   - kontex_snapshot:       after completing meaningful steps — use descriptive labels
   - kontex_task_done:      when a task succeeds or fails
   - kontex_rollback:       if the current approach is failing and a prior state should be restored

   READ tools — call to query history:
   - kontex_list_snapshots: see what has been captured in this session
   - kontex_search:         find past snapshots relevant to the current problem
   - kontex_get_context:    retrieve the full context bundle for any snapshot

   If you suspect you are repeating work already done, call kontex_search before starting.
   If the current approach is clearly failing, call kontex_list_snapshots and kontex_rollback
   rather than retrying from scratch."
```

---

## Prompt 11.2 — MCP read tool tests

```
Add to tests/mcp.test.ts (or create if it doesn't exist):

These tests assume the MCP server is running and accessible at POST /mcp
with Authorization: Bearer test_key_dev.

test("kontex_list_snapshots returns formatted table", async () => {
  // Create a session with at least one snapshot (use existing test data or create)
  // Call kontex_list_snapshots via POST /mcp with the session_id
  // Assert response contains the column headers (ID, Label, Captured, Tokens, Source)
  // Assert response is a string (not an error object)
})

test("kontex_get_context returns message count", async () => {
  // Get a known snapshot_id from the session
  // Call kontex_get_context via POST /mcp
  // Assert response string contains "=== MESSAGES"
  // Assert response string contains "=== TO ROLLBACK"
})

test("kontex_get_context wrong user → access denied message", async () => {
  // Create snapshot as user A
  // Call kontex_get_context as user B
  // Assert response contains "not found or access denied"
})

test("kontex_search without Qdrant configured → graceful message", async () => {
  // If QDRANT_URL is empty, call kontex_search
  // Assert response contains "not configured"
  // Assert no crash
})

Run: npm test — all sprint 1–10 tests still pass.
```

---

---

## Final Verification — All Three Sprints

```
Run this checklist after all three sprints complete:

Infrastructure
  □ npm run dev starts cleanly
  □ npm run span-worker starts cleanly
  □ npm run build — zero TypeScript errors
  □ npm test — all tests pass

Sprint 9 — OpenLLMetry
  □ POST /ingest/v1/traces → 200 { received: N }
  □ Duplicate spanId → idempotent (still 200, one DB record)
  □ X-Kontex-Session-Id header auto-links traceId
  □ POST /v1/sessions/:id/link-trace → 200
  □ LLM span → Snapshot in DB with source "openllmetry"
  □ Non-LLM span → OtelSpan only, no Snapshot
  □ Snapshot bundle has correct messages and token count
  □ Snapshot queued for Qdrant embedding

Sprint 10 — tRPC + SSE
  □ POST /trpc/sessions.list without auth → UNAUTHORIZED
  □ POST /trpc/sessions.create → returns session with id
  □ POST /trpc/snapshots.bundle → returns ContextBundle
  □ GET /sse/session/:id/feed → Content-Type: text/event-stream
  □ Send OTLP span to linked session → SSE stream emits snapshot.created within ~1s
  □ REST /v1/* endpoints still return identical responses (no regression)

Sprint 11 — MCP read tools
  □ kontex_list_snapshots returns formatted table with IDs
  □ kontex_get_context returns message history and rollback instruction
  □ kontex_search returns results (or graceful "not configured" message)
  □ All read tools return strings, never throw, never expose stack traces
  □ Total MCP tool list: 9 tools

Deploy
  □ railway.toml has three services: kontex-api, kontex-embed-worker, kontex-span-worker
  □ railway up succeeds
  □ GET /health → 200 in production
  □ POST /ingest/v1/traces → 200 in production
  □ railway logs -f — no errors across all three services
```

---

## Updated API Surface (additions only)

```
# Sprint 9 additions
POST  /ingest/v1/traces              OpenLLMetry OTLP/HTTP ingest
POST  /v1/sessions/:id/link-trace    Link OTel traceId to session

# Sprint 10 additions
POST  /trpc/*                        tRPC procedures (dashboard only)
GET   /sse/session/:id/feed          SSE live feed (dashboard only)

# Sprint 11 additions
POST  /mcp  kontex_search            semantic search read tool
POST  /mcp  kontex_get_context       bundle retrieval read tool
POST  /mcp  kontex_list_snapshots    session snapshot list read tool
```

---

*Kontex Backend 2.0 Build Guide*
*Changes only — assumes Sprints 1–8 complete*
*Sprint 9: OpenLLMetry · Sprint 10: tRPC + SSE · Sprint 11: MCP read tools*
