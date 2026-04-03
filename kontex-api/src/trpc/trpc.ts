import { initTRPC, TRPCError } from "@trpc/server"
import type { Context } from "./context"

const t = initTRPC.context<Context>().create()

export const router          = t.router
export const publicProcedure = t.procedure

// authedProcedure — throws UNAUTHORIZED if userId is null.
// All dashboard procedures use this. Never use publicProcedure for data queries.
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or missing API key" })
  }
  return next({ ctx: { ...ctx, userId: ctx.userId } })
})
