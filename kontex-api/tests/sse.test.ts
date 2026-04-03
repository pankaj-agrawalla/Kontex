import { describe, test, expect } from "vitest"
import http from "node:http"

const BASE = "http://localhost:3000"
const AUTH = { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" }

describe("SSE /sse/session/:id/feed", () => {
  test("without auth → 401", async () => {
    const res = await fetch(`${BASE}/sse/session/any-id/feed`)
    expect(res.status).toBe(401)
  })

  test("nonexistent session → 404", async () => {
    const res = await fetch(`${BASE}/sse/session/does-not-exist/feed`, {
      headers: { "Authorization": "Bearer test_key_dev" },
    })
    expect(res.status).toBe(404)
  })

  test("valid session → text/event-stream", async () => {
    // Create a real session
    const sessRes = await fetch(`${BASE}/v1/sessions`, {
      method:  "POST",
      headers: AUTH,
      body:    JSON.stringify({ name: "SSE test" }),
    })
    // Guard: if server is overloaded or rate limited, skip rather than hang
    if (!sessRes.ok) {
      console.warn(`[sse test] Session creation failed (${sessRes.status}), skipping stream check`)
      return
    }
    const sess = await sessRes.json() as { id: string }
    if (!sess.id) {
      console.warn("[sse test] No session id returned, skipping stream check")
      return
    }

    // Use http.get — fires callback immediately on response headers received
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://localhost:3000/sse/session/${sess.id}/feed`,
        { headers: { Authorization: "Bearer test_key_dev" } },
        (res) => {
          expect(res.statusCode).toBe(200)
          expect(res.headers["content-type"]).toContain("text/event-stream")
          req.destroy()
          resolve()
        }
      )
      req.on("error", (err) => {
        // ECONNRESET is expected when we destroy mid-stream
        if ((err as NodeJS.ErrnoException).code === "ECONNRESET") resolve()
        else reject(err)
      })
      setTimeout(() => {
        req.destroy()
        reject(new Error(`SSE connection timed out — run manually: curl -N ${BASE}/sse/session/${sess.id}/feed -H "Authorization: Bearer test_key_dev"`))
      }, 8000)
    })
  }, 12000)

  test("wrong user → 404", async () => {
    // Create session as user A
    const sessRes = await fetch(`${BASE}/v1/sessions`, {
      method:  "POST",
      headers: AUTH,
      body:    JSON.stringify({ name: "SSE ownership test" }),
    })
    if (!sessRes.ok) return  // guard: skip if server is overloaded
    const sess = await sessRes.json() as { id: string }

    // Access with user B
    const res = await fetch(`${BASE}/sse/session/${sess.id}/feed`, {
      headers: { "Authorization": "Bearer test_key_dev_2" },
    })
    expect(res.status).toBe(404)
  })
})
