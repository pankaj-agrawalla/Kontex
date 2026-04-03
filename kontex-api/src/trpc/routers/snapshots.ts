import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"
import { readBundle } from "../../services/bundle.service"
import { rollbackToSnapshot } from "../../services/snapshot.service"

export const snapshotsRouter = router({

  listBySession: authedProcedure
    .input(z.object({
      sessionId: z.string(),
      limit:     z.number().min(1).max(100).default(20),
      cursor:    z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const taskIds = (await ctx.db.task.findMany({
        where:  { sessionId: input.sessionId },
        select: { id: true },
      })).map(t => t.id)

      const snapshots = await ctx.db.snapshot.findMany({
        where: {
          taskId: { in: taskIds },
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        take:    input.limit,
        orderBy: { createdAt: "desc" },
      })
      return {
        data:       snapshots,
        nextCursor: snapshots.length === input.limit ? snapshots.at(-1)!.id : null,
      }
    }),

  byId: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.db.snapshot.findUnique({
        where:   { id: input.id },
        include: { task: { include: { session: true } } },
      })
      if (!snapshot || snapshot.task.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
      }
      return snapshot
    }),

  bundle: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const snapshot = await ctx.db.snapshot.findUnique({
        where:   { id: input.id },
        include: { task: { include: { session: true } } },
      })
      if (!snapshot || snapshot.task.session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
      }
      try {
        const bundle = await readBundle(snapshot.r2Key)
        return { snapshot, bundle }
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to read bundle from storage" })
      }
    }),

  rollback: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await rollbackToSnapshot({ snapshotId: input.id, userId: ctx.userId })
      } catch (err) {
        const msg = (err as Error).message
        if (msg.startsWith("NOT_FOUND")) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Snapshot not found" })
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Rollback failed" })
      }
    }),
})
