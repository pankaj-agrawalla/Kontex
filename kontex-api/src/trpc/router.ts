import { router }          from "./trpc"
import { sessionsRouter }  from "./routers/sessions"
import { snapshotsRouter } from "./routers/snapshots"
import { dashboardRouter } from "./routers/dashboard"

export const appRouter = router({
  sessions:  sessionsRouter,
  snapshots: snapshotsRouter,
  dashboard: dashboardRouter,
})

// The ONLY export the frontend needs from this repo.
// Frontend imports this type, not implementation code.
export type AppRouter = typeof appRouter
