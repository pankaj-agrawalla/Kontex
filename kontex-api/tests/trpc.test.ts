import { beforeAll, afterAll, describe, test, expect } from "vitest"
import { PrismaClient } from "@prisma/client"

const BASE  = "http://localhost:3000"
const AUTH  = { "Authorization": "Bearer test_key_dev",   "Content-Type": "application/json" }
const AUTH2 = { "Authorization": "Bearer test_key_dev_2", "Content-Type": "application/json" }

const db = new PrismaClient()

beforeAll(async () => {
  await db.user.upsert({
    where:  { email: "test2@kontex.local" },
    update: {},
    create: { id: "user_test2", email: "test2@kontex.local" },
  })
  await db.apiKey.upsert({
    where:  { key: "test_key_dev_2" },
    update: {},
    create: { id: "key_test2", key: "test_key_dev_2", userId: "user_test2", active: true },
  })
})

afterAll(async () => {
  await db.$disconnect()
})

describe("tRPC sessions", () => {
  test("sessions.list without auth → UNAUTHORIZED", async () => {
    const res  = await fetch(`${BASE}/trpc/sessions.list?input=%7B%7D`)
    const body = await res.json() as Record<string, unknown>
    const error = (body as { error: { data: { code: string } } }).error
    expect(error.data.code).toBe("UNAUTHORIZED")
  })

  test("sessions.create returns new session", async () => {
    const res = await fetch(`${BASE}/trpc/sessions.create`, {
      method:  "POST",
      headers: AUTH,
      body:    JSON.stringify({ name: "tRPC test" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: { id: string; status: string } } }
    expect(body.result.data.id).toBeDefined()
    expect(body.result.data.status).toBe("ACTIVE")
  })

  test("sessions.byId wrong user → NOT_FOUND", async () => {
    // Create session as user A
    const createRes = await fetch(`${BASE}/trpc/sessions.create`, {
      method:  "POST",
      headers: AUTH,
      body:    JSON.stringify({ name: "ownership test" }),
    })
    const created = await createRes.json() as { result: { data: { id: string } } }
    const sessionId = created.result.data.id

    // Query with user B → NOT_FOUND
    const input = encodeURIComponent(JSON.stringify({ id: sessionId }))
    const res   = await fetch(`${BASE}/trpc/sessions.byId?input=${input}`, {
      headers: AUTH2,
    })
    const body = await res.json() as { error: { data: { code: string } } }
    expect(body.error.data.code).toBe("NOT_FOUND")
  })

  test("sessions.list with auth returns paginated result", async () => {
    const input = encodeURIComponent(JSON.stringify({ limit: 5 }))
    const res   = await fetch(`${BASE}/trpc/sessions.list?input=${input}`, {
      headers: { "Authorization": "Bearer test_key_dev" },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: { data: unknown[]; nextCursor: string | null } } }
    expect(Array.isArray(body.result.data.data)).toBe(true)
    expect("nextCursor" in body.result.data).toBe(true)
  })
})

describe("tRPC dashboard", () => {
  test("dashboard.usage returns numeric counts", async () => {
    const res  = await fetch(`${BASE}/trpc/dashboard.usage`, {
      headers: { "Authorization": "Bearer test_key_dev" },
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { result: { data: Record<string, number> } }
    expect(typeof body.result.data.totalSessions).toBe("number")
    expect(typeof body.result.data.totalSnapshots).toBe("number")
    expect(typeof body.result.data.activeSessions).toBe("number")
    expect(typeof body.result.data.totalTokensStored).toBe("number")
  })

  test("dashboard.usage without auth → UNAUTHORIZED", async () => {
    const res  = await fetch(`${BASE}/trpc/dashboard.usage`)
    const body = await res.json() as { error: { data: { code: string } } }
    expect(body.error.data.code).toBe("UNAUTHORIZED")
  })
})
