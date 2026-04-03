import { beforeAll, afterAll, test, expect } from "vitest"
import { PrismaClient } from "@prisma/client"

const BASE   = "http://localhost:3000"
const API_KEY = "test_key_dev"

const db = new PrismaClient()

beforeAll(async () => {
  // Ensure the primary test user + key exist — same convention as all other test files
  await db.user.upsert({
    where:  { email: "dev@kontex.local" },
    update: {},
    create: { id: "user_dev", email: "dev@kontex.local" },
  })
  await db.apiKey.upsert({
    where:  { key: API_KEY },
    update: {},
    create: { id: "key_dev", key: API_KEY, userId: "user_dev", active: true },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

// ── Fixture ───────────────────────────────────────────────────────────────────

const makeSpan = (overrides: Partial<{
  traceId: string
  spanId: string
  model: string
  promptTokens: number
  completionTokens: number
}> = {}) => ({
  resourceSpans: [{
    resource: {
      attributes: [{ key: "service.name", value: { stringValue: "test-agent" } }],
    },
    scopeSpans: [{
      scope: { name: "opentelemetry.instrumentation.anthropic" },
      spans: [{
        traceId:           overrides.traceId ?? "aabb" + "0".repeat(28),
        spanId:            overrides.spanId  ?? "ccdd" + "0".repeat(12),
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
        status: { code: 1 },
      }],
    }],
  }],
})

// ── Tests ─────────────────────────────────────────────────────────────────────

test("POST /ingest/v1/traces returns 200 { received: 1 }", async () => {
  const res = await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": API_KEY },
    body:    JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(200)
  expect((await res.json() as Record<string, unknown>).received).toBe(1)
})

test("Missing auth → 401", async () => {
  const res = await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(makeSpan()),
  })
  expect(res.status).toBe(401)
})

test("Wrong content-type → 415", async () => {
  const res = await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-protobuf", "X-Kontex-Api-Key": API_KEY },
    body:    "binary",
  })
  expect(res.status).toBe(415)
})

test("OtelSpan record created in DB", async () => {
  const spanId = "test-" + Date.now()
  await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": API_KEY },
    body:    JSON.stringify(makeSpan({ spanId })),
  })
  await new Promise(r => setTimeout(r, 200))
  const record = await db.otelSpan.findUnique({ where: { spanId } })
  expect(record).not.toBeNull()
  expect(record?.spanKind).toBe("llm")
})

test("Duplicate spanId is idempotent", async () => {
  const spanId  = "dedup-" + Date.now()
  const payload = makeSpan({ spanId })
  await fetch(`${BASE}/ingest/v1/traces`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": API_KEY },
    body: JSON.stringify(payload),
  })
  await fetch(`${BASE}/ingest/v1/traces`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": API_KEY },
    body: JSON.stringify(payload),
  })
  const count = await db.otelSpan.count({ where: { spanId } })
  expect(count).toBe(1)
})

test("Linked session → Snapshot created with source openllmetry", async () => {
  const traceId = "trace-" + Date.now()

  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ name: "OpenLLMetry test" }),
  })
  const { id: sessionId } = await sessRes.json() as { id: string }

  await fetch(`${BASE}/v1/sessions/${sessionId}/link-trace`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ traceId }),
  })

  await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "X-Kontex-Api-Key": API_KEY },
    body:    JSON.stringify(makeSpan({ traceId, spanId: "snap-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 1500))  // wait for span-worker

  const snapRes = await fetch(`${BASE}/v1/sessions/${sessionId}/snapshots`, {
    headers: { "Authorization": `Bearer ${API_KEY}` },
  })
  const { data } = await snapRes.json() as { data: Array<{ source: string }> }
  expect(data.length).toBeGreaterThan(0)
  expect(data[0].source).toBe("openllmetry")
})

test("X-Kontex-Session-Id header auto-links trace", async () => {
  const traceId = "auto-" + Date.now()

  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ name: "Auto-link test" }),
  })
  const { id: sessionId } = await sessRes.json() as { id: string }

  await fetch(`${BASE}/ingest/v1/traces`, {
    method:  "POST",
    headers: {
      "Content-Type":        "application/json",
      "X-Kontex-Api-Key":    API_KEY,
      "X-Kontex-Session-Id": sessionId,
    },
    body: JSON.stringify(makeSpan({ traceId, spanId: "autolink-" + Date.now() })),
  })

  await new Promise(r => setTimeout(r, 300))
  const sess = await db.session.findUnique({ where: { id: sessionId } })
  expect(sess?.externalTraceId).toBe(traceId)
})
