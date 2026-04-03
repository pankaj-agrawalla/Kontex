import { Hono } from "hono"
import { Prisma } from "@prisma/client"
import { db }    from "../db"
import { redis } from "../redis"
import { parseOtlpPayload } from "../receivers/otlp.parser"

const ingest = new Hono()

// POST /ingest/v1/traces
ingest.post("/v1/traces", async (c) => {
  // ── Auth: X-Kontex-Api-Key ────────────────────────────────────────────────
  const apiKeyValue = c.req.header("X-Kontex-Api-Key")
  if (!apiKeyValue) {
    return c.json({ error: "unauthorized", message: "Missing X-Kontex-Api-Key header" }, 401)
  }
  const apiKey = await db.apiKey.findUnique({ where: { key: apiKeyValue } })
  if (!apiKey || !apiKey.active) {
    return c.json({ error: "unauthorized", message: "Invalid or inactive API key" }, 401)
  }
  const userId = apiKey.userId
  db.apiKey.update({ where: { key: apiKeyValue }, data: { lastUsed: new Date() } }).catch(() => {})

  // ── Content-Type check ────────────────────────────────────────────────────
  const contentType = c.req.header("Content-Type") ?? ""
  if (!contentType.includes("application/json")) {
    return c.json(
      { error: "unsupported_media_type", message: "Only application/json OTLP supported" },
      415
    )
  }

  // ── 1. Parse body ─────────────────────────────────────────────────────────
  const body = await c.req.json().catch(() => null)
  const spans = parseOtlpPayload(body)
  if (spans.length === 0) {
    return c.json({ received: 0 })
  }

  // ── 2. Auto-link via X-Kontex-Session-Id ──────────────────────────────────
  const sessionId = c.req.header("X-Kontex-Session-Id")
  if (sessionId) {
    const session = await db.session.findFirst({
      where: { id: sessionId, userId },
    })
    if (session && session.externalTraceId === null) {
      await db.session.update({
        where: { id: sessionId },
        data:  { externalTraceId: spans[0].traceId },
      })
    }
  }

  // ── 3. Upsert OtelSpan records (awaited — data safe before responding) ────
  const storedIds: string[] = []
  for (const span of spans) {
    const stored = await db.otelSpan.upsert({
      where:  { spanId: span.spanId },
      create: {
        traceId:       span.traceId,
        spanId:        span.spanId,
        parentSpanId:  span.parentSpanId,
        serviceName:   span.serviceName,
        operationName: span.operationName,
        spanKind:      span.spanKind,
        startTime:     span.startTime,
        endTime:       span.endTime,
        durationMs:    span.durationMs,
        attributes:    span.attributes as Prisma.InputJsonValue,
      },
      update: {},  // idempotent — duplicate spanId, do nothing
    })
    storedIds.push(stored.id)
  }

  // ── 4. Queue for async processing (fire-and-forget) ───────────────────────
  for (const otelSpanId of storedIds) {
    redis.rpush("kontex:span_jobs", JSON.stringify({ otelSpanId }))
      .catch(err => console.error("[ingest] Failed to queue:", err))
  }

  // ── 5. Return before any span processing ─────────────────────────────────
  return c.json({ received: spans.length })
})

export default ingest
