import { beforeAll, afterAll, describe, test, expect } from "vitest"
import { PrismaClient } from "@prisma/client"

const BASE = "http://localhost:3000"
const KONTEX_KEY = "test_key_dev"

const db = new PrismaClient()

let sessionId: string

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

  // Create a session for proxy tests
  const res = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KONTEX_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "proxy-test-session" }),
  })
  const body = await res.json() as Record<string, unknown>
  sessionId = body.id as string
})

afterAll(async () => {
  await db.$disconnect()
})

describe("POST /proxy/v1/messages", () => {
  test("returns Anthropic response unchanged", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return

    const start = Date.now()
    const res = await fetch(`${BASE}/proxy/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        "X-Kontex-Api-Key": KONTEX_KEY,
        "X-Kontex-Session-Id": sessionId,
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hi" }],
      }),
    })
    const elapsed = Date.now() - start

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.content)).toBe(true)
    expect(elapsed).toBeLessThan(10000)
  })

  test("without session id still returns Anthropic response, no snapshot", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return

    const snapshotsBefore = await db.snapshot.count()

    const res = await fetch(`${BASE}/proxy/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        "X-Kontex-Api-Key": KONTEX_KEY,
        // No X-Kontex-Session-Id
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: "Say hi" }],
      }),
    })

    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(Array.isArray(body.content)).toBe(true)

    // Wait briefly and confirm no new snapshot was created
    await new Promise((r) => setTimeout(r, 300))
    const snapshotsAfter = await db.snapshot.count()
    expect(snapshotsAfter).toBe(snapshotsBefore)
  })

  test("snapshot created after 5 assistant turns", async () => {
    if (!process.env.ANTHROPIC_API_KEY) return

    // Build 5 assistant turns: 5 user + 5 assistant = 10 messages
    const messages: Array<{ role: string; content: string }> = []
    for (let i = 0; i < 5; i++) {
      messages.push({ role: "user", content: `Turn ${i + 1}` })
      messages.push({ role: "assistant", content: `Response ${i + 1}` })
    }

    const snapshotsBefore = await db.snapshot.findMany({
      where: { task: { session: { id: sessionId } } },
    })

    const res = await fetch(`${BASE}/proxy/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.ANTHROPIC_API_KEY}`,
        "X-Kontex-Api-Key": KONTEX_KEY,
        "X-Kontex-Session-Id": sessionId,
        "X-Kontex-Snapshot-Trigger": "every_n_turns",
        "X-Kontex-Snapshot-N": "5",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages,
      }),
    })

    expect(res.status).toBe(200)

    // Wait for async snapshot to complete
    await new Promise((r) => setTimeout(r, 500))

    const snapshotsAfter = await db.snapshot.findMany({
      where: { task: { session: { id: sessionId } }, source: "proxy" },
    })
    expect(snapshotsAfter.length).toBeGreaterThan(snapshotsBefore.length)
    const newest = snapshotsAfter[snapshotsAfter.length - 1]
    expect(newest.source).toBe("proxy")
  })
})
