import { Hono } from "hono"
import { z } from "zod"
import { nanoid } from "nanoid"
import { db } from "../db"
import type { Variables } from "../types/api"

const app = new Hono<{ Variables: Variables }>()

// POST /v1/keys
app.post("/", async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json().catch(() => null)

  const schema = z.object({ label: z.string().max(200).optional() })
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: parsed.error.flatten() },
      400
    )
  }

  const key = "kontex_" + nanoid(32)
  const apiKey = await db.apiKey.create({
    data: { key, label: parsed.data.label, userId },
  })

  return c.json(
    { id: apiKey.id, key: apiKey.key, label: apiKey.label, createdAt: apiKey.createdAt },
    201
  )
})

// GET /v1/keys
app.get("/", async (c) => {
  const userId = c.get("userId")

  const keys = await db.apiKey.findMany({
    where: { userId, active: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, lastUsed: true, active: true, createdAt: true },
  })

  return c.json(keys)
})

// DELETE /v1/keys/:id
app.delete("/:id", async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")

  const apiKey = await db.apiKey.findUnique({ where: { id } })
  if (!apiKey || apiKey.userId !== userId) {
    return c.json({ error: "not_found", message: "API key not found" }, 404)
  }

  await db.apiKey.update({ where: { id }, data: { active: false } })

  return new Response(null, { status: 204 })
})

export default app
