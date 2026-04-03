import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import Redis from "ioredis"
import { db } from "../db"
import { config } from "../config"
import type { KontexEvent } from "../lib/events"

const sse = new Hono()

sse.get("/session/:id/feed", async (c) => {
  // Auth — Bearer token
  const authHeader = c.req.header("Authorization") ?? ""
  const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!key) return c.text("Unauthorized", 401)

  const apiKey = await db.apiKey.findUnique({ where: { key } })
  if (!apiKey || !apiKey.active) return c.text("Unauthorized", 401)

  const userId = apiKey.userId
  const id     = c.req.param("id")

  // Ownership check
  const session = await db.session.findUnique({ where: { id } })
  if (!session || session.userId !== userId) return c.text("Not found", 404)

  // Dedicated Redis connection — never use shared singleton for subscribe
  const sub = new Redis(config.REDIS_URL)

  // Disable Nginx buffering on Railway
  c.header("X-Accel-Buffering", "no")

  return streamSSE(c, async (stream) => {
    // Flush headers immediately by sending an empty data event
    await stream.writeSSE({ data: "" })

    // Subscribe to session events
    await sub.subscribe(`session:${id}:events`)

    const heartbeatInterval = setInterval(() => {
      stream.writeSSE({ data: "" }).catch(() => {})
    }, 30_000)

    // Forward Redis messages to SSE stream
    sub.on("message", (_channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as KontexEvent
        stream.writeSSE({ event: event.type, data: raw }).catch(() => {})
      } catch {
        // malformed message — skip
      }
    })

    sub.on("error", (err: Error) => {
      console.error("[sse] Redis subscriber error:", err)
      clearInterval(heartbeatInterval)
      sub.unsubscribe().catch(() => {})
      sub.disconnect()
    })

    // Keep stream open until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeatInterval)
        sub.unsubscribe().catch(() => {})
        sub.disconnect()
        resolve()
      })
    })
  })
})

export default sse
