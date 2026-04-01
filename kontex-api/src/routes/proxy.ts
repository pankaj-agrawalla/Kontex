import { Hono } from "hono"
import { db } from "../db"
import { forwardToAnthropic, extractBundleFromProxy, shouldSnapshot } from "../services/proxy.service"
import { createSnapshot } from "../services/snapshot.service"
import type { ContextBundle } from "../types/bundle"

const proxy = new Hono()

proxy.post("/v1/messages", async (c) => {
  // Auth via X-Kontex-Api-Key (not the standard Authorization header)
  let userId: string | undefined
  const kontexApiKey = c.req.header("X-Kontex-Api-Key")
  if (kontexApiKey) {
    try {
      const apiKey = await db.apiKey.findUnique({ where: { key: kontexApiKey } })
      if (apiKey && apiKey.active) {
        userId = apiKey.userId
        db.apiKey.update({ where: { key: kontexApiKey }, data: { lastUsed: new Date() } }).catch(() => {})
      }
    } catch {
      // Invalid key — continue without userId, no snapshot
    }
  }

  // Parse headers
  const authHeader = c.req.header("Authorization") ?? ""
  const anthropicApiKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader
  const sessionId = c.req.header("X-Kontex-Session-Id")
  const triggerHeader = c.req.header("X-Kontex-Snapshot-Trigger") ?? "every_n_turns"
  const trigger = (["every_n_turns", "on_tool_end", "token_threshold"].includes(triggerHeader)
    ? triggerHeader
    : "every_n_turns") as "every_n_turns" | "on_tool_end" | "token_threshold"
  const triggerN = parseInt(c.req.header("X-Kontex-Snapshot-N") ?? "5", 10)

  // 1. Parse request body
  const requestBody: unknown = await c.req.json()

  // 2. Forward to Anthropic
  const { responseBody, status, headers } = await forwardToAnthropic(requestBody, anthropicApiKey)

  // 3. Return Anthropic response immediately
  const response = c.json(responseBody, status as Parameters<typeof c.json>[1])

  // 4. Fire-and-forget snapshot logic
  if (sessionId && userId) {
    const capturedUserId = userId
    const capturedSessionId = sessionId
    Promise.resolve().then(async () => {
      try {
        const snap = shouldSnapshot(requestBody, responseBody, {
          sessionId: capturedSessionId,
          userId: capturedUserId,
          trigger,
          triggerN,
        })
        if (!snap) return

        // Find or create proxy-auto task for this session
        let task = await db.task.findFirst({
          where: { sessionId: capturedSessionId, name: "proxy-auto", status: "ACTIVE" },
        })
        if (!task) {
          task = await db.task.create({
            data: {
              sessionId: capturedSessionId,
              name: "proxy-auto",
              status: "ACTIVE",
            },
          })
        }

        const partialBundle = extractBundleFromProxy(requestBody, responseBody)
        const bundle: ContextBundle = {
          ...partialBundle,
          snapshotId: "",
          taskId: task.id,
          sessionId: capturedSessionId,
          capturedAt: new Date().toISOString(),
        }

        await createSnapshot({
          taskId: task.id,
          label: `proxy-auto-${new Date().toISOString()}`,
          bundle,
          userId: capturedUserId,
        })
      } catch (err) {
        console.error("[proxy] async snapshot error:", err)
      }
    })
  }

  return response
})

export default proxy
