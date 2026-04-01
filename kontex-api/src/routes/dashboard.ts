import { Hono } from "hono"
import { db } from "../db"
import { readBundle } from "../services/bundle.service"
import { diffBundles } from "../services/diff.service"
import type { Variables } from "../types/api"

const app = new Hono<{ Variables: Variables }>()

// GET /v1/sessions/:id/graph
app.get("/sessions/:id/graph", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.param("id")

  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404)
  }

  const tasks = await db.task.findMany({
    where: { sessionId },
    include: {
      snapshots: { select: { tokenTotal: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  const nodes = tasks.map((task, index) => ({
    id: task.id,
    data: {
      label: task.name,
      status: task.status,
      tokenTotal: task.snapshots.reduce((sum, s) => sum + s.tokenTotal, 0),
      snapshotCount: task.snapshots.length,
    },
    position: { x: 300, y: index * 120 },
  }))

  const edges = tasks
    .filter((task) => task.parentTaskId !== null)
    .map((task) => ({
      id: `e_${task.parentTaskId}_${task.id}`,
      source: task.parentTaskId as string,
      target: task.id,
      animated: task.status === "ACTIVE" || task.status === "PENDING",
    }))

  return c.json({ nodes, edges })
})

// GET /v1/sessions/:id/diff?from=&to=
app.get("/sessions/:id/diff", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.param("id")
  const fromId = c.req.query("from")
  const toId = c.req.query("to")

  if (!fromId || !toId) {
    return c.json(
      { error: "validation_error", message: "Query params 'from' and 'to' are required" },
      400
    )
  }

  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404)
  }

  // Validate both snapshots belong to this session
  const [snapshotFrom, snapshotTo] = await Promise.all([
    db.snapshot.findUnique({ where: { id: fromId }, include: { task: { select: { sessionId: true } } } }),
    db.snapshot.findUnique({ where: { id: toId }, include: { task: { select: { sessionId: true } } } }),
  ])

  if (!snapshotFrom || snapshotFrom.task.sessionId !== sessionId) {
    return c.json(
      { error: "validation_error", message: `Snapshot '${fromId}' does not belong to this session` },
      400
    )
  }
  if (!snapshotTo || snapshotTo.task.sessionId !== sessionId) {
    return c.json(
      { error: "validation_error", message: `Snapshot '${toId}' does not belong to this session` },
      400
    )
  }

  let bundleA, bundleB
  try {
    bundleA = await readBundle(snapshotFrom.r2Key)
  } catch {
    return c.json({ error: "upstream_error", message: "Failed to read 'from' bundle from storage" }, 502)
  }
  try {
    bundleB = await readBundle(snapshotTo.r2Key)
  } catch {
    return c.json({ error: "upstream_error", message: "Failed to read 'to' bundle from storage" }, 502)
  }

  const diff = diffBundles(bundleA, bundleB)

  return c.json({
    added: diff.added,
    removed: diff.removed,
    token_delta: diff.tokenDelta,
  })
})

// GET /v1/sessions/:id/snapshots/timeline
app.get("/sessions/:id/snapshots/timeline", async (c) => {
  const userId = c.get("userId")
  const sessionId = c.req.param("id")

  const session = await db.session.findUnique({ where: { id: sessionId } })
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404)
  }

  const snapshots = await db.snapshot.findMany({
    where: { task: { sessionId } },
    include: { task: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  })

  const timeline = snapshots.map((snapshot, index) => {
    const prevTokenTotal = index > 0 ? snapshots[index - 1].tokenTotal : 0
    return {
      id: snapshot.id,
      label: snapshot.label,
      taskId: snapshot.taskId,
      taskName: snapshot.task.name,
      source: snapshot.source,
      enriched: snapshot.enriched,
      tokenTotal: snapshot.tokenTotal,
      tokenDelta: snapshot.tokenTotal - prevTokenTotal,
      createdAt: snapshot.createdAt,
    }
  })

  return c.json(timeline)
})

// GET /v1/usage
app.get("/usage", async (c) => {
  const userId = c.get("userId")

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const [
    totalSessions,
    activeSessions,
    snapshotAgg,
    monthlySnapshotAgg,
  ] = await Promise.all([
    db.session.count({ where: { userId } }),
    db.session.count({ where: { userId, status: "ACTIVE" } }),
    db.snapshot.aggregate({
      where: { task: { session: { userId } } },
      _count: { id: true },
      _sum: { tokenTotal: true },
    }),
    db.snapshot.aggregate({
      where: {
        task: { session: { userId } },
        createdAt: { gte: startOfMonth },
      },
      _count: { id: true },
      _sum: { tokenTotal: true },
    }),
  ])

  return c.json({
    total_sessions: totalSessions,
    active_sessions: activeSessions,
    total_snapshots: snapshotAgg._count.id,
    total_tokens_stored: snapshotAgg._sum.tokenTotal ?? 0,
    snapshots_this_month: monthlySnapshotAgg._count.id,
    tokens_this_month: monthlySnapshotAgg._sum.tokenTotal ?? 0,
  })
})

export default app
