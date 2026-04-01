import { beforeAll, afterAll, describe, test, expect } from "vitest"
import { PrismaClient } from "@prisma/client"

const BASE = "http://localhost:3000"
const AUTH = { Authorization: "Bearer test_key_dev", "Content-Type": "application/json" }
const ENRICH_KEY = { "X-Kontex-Api-Key": "test_key_dev", "Content-Type": "application/json" }

const db = new PrismaClient()

let taskId: string

const minimalBundle = {
  model: "claude-opus-4-5",
  source: "proxy" as const,
  messages: [{ role: "user", content: "hello" }],
}

const enrichmentPayload = {
  files: [
    {
      path: "/src/main.ts",
      content: "console.log('hello')",
      contentHash: "abc123",
      tokenCount: 5,
    },
  ],
  toolCalls: [
    {
      tool: "Read",
      input: { path: "/src/main.ts" },
      output: "console.log('hello')",
      status: "success",
      timestamp: new Date().toISOString(),
    },
  ],
  logEvents: [
    {
      type: "assistant",
      timestamp: new Date().toISOString(),
      data: { text: "reading file" },
    },
  ],
  reasoning: "I should read the main file first.",
}

beforeAll(async () => {
  // Ensure test user + key exist
  await db.user.upsert({
    where: { email: "dev@kontex.local" },
    update: {},
    create: { id: "user_dev", email: "dev@kontex.local" },
  })
  await db.apiKey.upsert({
    where: { key: "test_key_dev" },
    update: {},
    create: { id: "key_dev", key: "test_key_dev", userId: "user_dev", active: true },
  })

  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ name: "enrich-test-session" }),
  })
  const sess = await sessRes.json() as Record<string, unknown>
  const sessionId = sess.id as string

  const taskRes = await fetch(`${BASE}/v1/sessions/${sessionId}/tasks`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ name: "enrich-test-task" }),
  })
  const task = await taskRes.json() as Record<string, unknown>
  taskId = task.id as string
})

afterAll(async () => {
  await db.$disconnect()
})

describe("POST /v1/snapshots/:id/enrich", () => {
  test("enriches snapshot within window → 200, enriched: true", async () => {
    // Create snapshot
    const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ label: "enrich-test", bundle: minimalBundle }),
    })
    expect(snapRes.status).toBe(201)
    const snap = await snapRes.json() as Record<string, unknown>
    const snapshotId = snap.id as string

    // Enrich it
    const res = await fetch(`${BASE}/v1/snapshots/${snapshotId}/enrich`, {
      method: "POST",
      headers: ENRICH_KEY,
      body: JSON.stringify(enrichmentPayload),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body.snapshotId).toBe(snapshotId)
    expect(body.enriched).toBe(true)
    expect(body.enrichedAt).toBeDefined()
  })

  test("GET snapshot after enrich → bundle.files populated", async () => {
    const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ label: "enrich-files-test", bundle: minimalBundle }),
    })
    const snap = await snapRes.json() as Record<string, unknown>
    const snapshotId = snap.id as string

    await fetch(`${BASE}/v1/snapshots/${snapshotId}/enrich`, {
      method: "POST",
      headers: ENRICH_KEY,
      body: JSON.stringify(enrichmentPayload),
    })

    const res = await fetch(`${BASE}/v1/snapshots/${snapshotId}`, { headers: AUTH })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    const bundle = body.bundle as Record<string, unknown>
    expect(Array.isArray(bundle.files)).toBe(true)
    expect((bundle.files as unknown[]).length).toBeGreaterThan(0)
    const file = (bundle.files as Array<Record<string, unknown>>)[0]
    expect(file.path).toBe("/src/main.ts")
    expect(bundle.enriched).toBe(true)
    expect(bundle.reasoning).toBe("I should read the main file first.")
  })

  test("missing api key → 401", async () => {
    const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ label: "unauth-test", bundle: minimalBundle }),
    })
    const snap = await snapRes.json() as Record<string, unknown>
    const snapshotId = snap.id as string

    const res = await fetch(`${BASE}/v1/snapshots/${snapshotId}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrichmentPayload),
    })
    expect(res.status).toBe(401)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("unauthorized")
  })

  test("nonexistent snapshot → 404", async () => {
    const res = await fetch(`${BASE}/v1/snapshots/nonexistent_snap/enrich`, {
      method: "POST",
      headers: ENRICH_KEY,
      body: JSON.stringify(enrichmentPayload),
    })
    expect(res.status).toBe(404)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("not_found")
  })

  test("expired enrichment window → 409", async () => {
    // Create snapshot then manually backdate createdAt beyond the window
    const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ label: "expired-test", bundle: minimalBundle }),
    })
    const snap = await snapRes.json() as Record<string, unknown>
    const snapshotId = snap.id as string

    // Backdate the snapshot by 120 seconds (beyond default 60s window)
    await db.snapshot.update({
      where: { id: snapshotId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    })

    const res = await fetch(`${BASE}/v1/snapshots/${snapshotId}/enrich`, {
      method: "POST",
      headers: ENRICH_KEY,
      body: JSON.stringify(enrichmentPayload),
    })
    expect(res.status).toBe(409)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("enrich_window_expired")
  })

  test("invalid body → 400 validation_error", async () => {
    const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ label: "validation-test", bundle: minimalBundle }),
    })
    const snap = await snapRes.json() as Record<string, unknown>
    const snapshotId = snap.id as string

    const res = await fetch(`${BASE}/v1/snapshots/${snapshotId}/enrich`, {
      method: "POST",
      headers: ENRICH_KEY,
      body: JSON.stringify({ files: "not-an-array" }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as Record<string, unknown>
    expect(body.error).toBe("validation_error")
  })
})
