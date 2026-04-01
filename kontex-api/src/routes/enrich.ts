import { Hono } from "hono"
import { z } from "zod"
import { db } from "../db"
import { applyEnrichment } from "../services/enrich.service"

const ContextFileSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  contentHash: z.string(),
  tokenCount: z.number(),
})

const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  status: z.enum(["success", "error"]),
  timestamp: z.string(),
})

const LogEventSchema = z.object({
  type: z.string(),
  timestamp: z.string(),
  data: z.unknown(),
})

const BodySchema = z.object({
  files: z.array(ContextFileSchema).default([]),
  toolCalls: z.array(ToolCallSchema).default([]),
  logEvents: z.array(LogEventSchema).default([]),
  reasoning: z.string().optional(),
})

const enrich = new Hono()

enrich.post("/snapshots/:id/enrich", async (c) => {
  // Auth via X-Kontex-Api-Key (log watcher uses API key auth, not Bearer token)
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
      // fall through — userId stays undefined
    }
  }

  if (!userId) {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401)
  }

  const snapshotId = c.req.param("id")

  const raw = await c.req.json()
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: parsed.error.flatten() },
      400
    )
  }

  try {
    const result = await applyEnrichment({
      snapshotId,
      userId,
      files: parsed.data.files,
      toolCalls: parsed.data.toolCalls,
      logEvents: parsed.data.logEvents,
      reasoning: parsed.data.reasoning,
    })
    return c.json(result, 200)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith("NOT_FOUND")) {
      return c.json({ error: "not_found", message: "Snapshot not found" }, 404)
    }
    if (msg.startsWith("ENRICH_WINDOW_EXPIRED")) {
      return c.json(
        { error: "enrich_window_expired", message: "Enrichment window has closed for this snapshot" },
        409
      )
    }
    if (msg.startsWith("R2_READ_FAILED") || msg.startsWith("R2_WRITE_FAILED")) {
      return c.json({ error: "upstream_error", message: "Storage error" }, 502)
    }
    return c.json({ error: "internal_error", message: "Internal server error" }, 500)
  }
})

export default enrich
