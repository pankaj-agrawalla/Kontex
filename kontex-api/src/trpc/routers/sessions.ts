import { z } from "zod"
import { router, authedProcedure } from "../trpc"
import { TRPCError } from "@trpc/server"

export const sessionsRouter = router({

  list: authedProcedure
    .input(z.object({
      status: z.enum(["ACTIVE","PAUSED","COMPLETED"]).optional(),
      limit:  z.number().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sessions = await ctx.db.session.findMany({
        where: {
          userId: ctx.userId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        take:    input.limit,
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { tasks: true } } },
      })
      return {
        data:       sessions,
        nextCursor: sessions.length === input.limit ? sessions.at(-1)!.id : null,
      }
    }),

  byId: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({
        where:   { id: input.id },
        include: { _count: { select: { tasks: true } } },
      })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      return session
    }),

  create: authedProcedure
    .input(z.object({
      name:        z.string().min(1).max(200),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.session.create({
        data: { ...input, userId: ctx.userId, status: "ACTIVE" },
      })
    }),

  update: authedProcedure
    .input(z.object({
      id:              z.string(),
      name:            z.string().min(1).max(200).optional(),
      description:     z.string().max(500).optional(),
      status:          z.enum(["ACTIVE","PAUSED","COMPLETED"]).optional(),
      externalTraceId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input
      const existing = await ctx.db.session.findUnique({ where: { id } })
      if (!existing || existing.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      const updated = await ctx.db.session.update({ where: { id }, data })
      if (data.status) {
        // Publish status change for SSE consumers
        const { publishEvent } = await import("../../lib/events")
        publishEvent({ type: "session.updated", sessionId: id, data: { status: data.status } })
      }
      return updated
    }),

  tasks: authedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.session.findUnique({ where: { id: input.sessionId } })
      if (!session || session.userId !== ctx.userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" })
      }
      return ctx.db.task.findMany({
        where:   { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { snapshots: true } } },
      })
    }),
})
