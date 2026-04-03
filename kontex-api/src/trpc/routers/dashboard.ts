import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"
import { diffBundles } from "../../services/diff.service"
import { readBundle }  from "../../services/bundle.service"

export const dashboardRouter = router({

  graph: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const tasks = await ctx.db.task.findMany({
        where:   { sessionId: input.sessionId },
        include: { snapshots: true },
      })
      const nodes = tasks.map((task, i) => ({
        id: task.id,
        data: {
          label:         task.name,
          status:        task.status,
          snapshotCount: task.snapshots.length,
          tokenTotal:    task.snapshots.reduce((s, snap) => s + snap.tokenTotal, 0),
        },
        position: { x: 300, y: i * 120 },
      }))
      const edges = tasks
        .filter(t => t.parentTaskId)
        .map(t => ({
          id:       `e_${t.parentTaskId}_${t.id}`,
          source:   t.parentTaskId!,
          target:   t.id,
          animated: t.status === "ACTIVE" || t.status === "PENDING",
        }))
      return { nodes, edges }
    }),

  diff: authedProcedure
    .input(z.object({
      sessionId:      z.string(),
      fromSnapshotId: z.string(),
      toSnapshotId:   z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const [snapA, snapB] = await Promise.all([
        ctx.db.snapshot.findUnique({ where: { id: input.fromSnapshotId }, include: { task: true } }),
        ctx.db.snapshot.findUnique({ where: { id: input.toSnapshotId   }, include: { task: true } }),
      ])
      if (!snapA || snapA.task.sessionId !== input.sessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "fromSnapshotId not in this session" })
      }
      if (!snapB || snapB.task.sessionId !== input.sessionId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "toSnapshotId not in this session" })
      }
      const [bundleA, bundleB] = await Promise.all([readBundle(snapA.r2Key), readBundle(snapB.r2Key)])
      return diffBundles(bundleA, bundleB)
    }),

  timeline: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const tasks     = await ctx.db.task.findMany({ where: { sessionId: input.sessionId } })
      const taskNames = Object.fromEntries(tasks.map(t => [t.id, t.name]))
      const snapshots = await ctx.db.snapshot.findMany({
        where:   { taskId: { in: tasks.map(t => t.id) } },
        orderBy: { createdAt: "asc" },
      })
      let prev = 0
      return snapshots.map(s => {
        const delta = s.tokenTotal - prev
        prev = s.tokenTotal
        return {
          id: s.id, label: s.label, taskId: s.taskId,
          taskName: taskNames[s.taskId] ?? "",
          source: s.source, enriched: s.enriched,
          tokenTotal: s.tokenTotal, tokenDelta: delta,
          createdAt: s.createdAt,
        }
      })
    }),

  usage: authedProcedure
    .query(async ({ ctx }) => {
      const sessions   = await ctx.db.session.findMany({ where: { userId: ctx.userId } })
      const sessionIds = sessions.map(s => s.id)
      const tasks      = await ctx.db.task.findMany({ where: { sessionId: { in: sessionIds } } })
      const snapshots  = await ctx.db.snapshot.findMany({ where: { taskId: { in: tasks.map(t => t.id) } } })
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      const thisMonth  = snapshots.filter(s => s.createdAt >= monthStart)
      return {
        totalSessions:      sessions.length,
        activeSessions:     sessions.filter(s => s.status === "ACTIVE").length,
        totalSnapshots:     snapshots.length,
        totalTokensStored:  snapshots.reduce((s, snap) => s + snap.tokenTotal, 0),
        snapshotsThisMonth: thisMonth.length,
        tokensThisMonth:    thisMonth.reduce((s, snap) => s + snap.tokenTotal, 0),
      }
    }),
})
