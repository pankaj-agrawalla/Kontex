import { db }    from "../db"
import { redis } from "../redis"
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch"

export interface Context {
  userId: string | null
  db:     typeof db
  redis:  typeof redis
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const authHeader = opts.req.headers.get("Authorization") ?? ""
  const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

  if (!key) return { userId: null, db, redis }

  try {
    const apiKey = await db.apiKey.findUnique({ where: { key } })
    if (!apiKey || !apiKey.active) return { userId: null, db, redis }
    // Fire-and-forget lastUsed — same pattern as REST auth middleware
    db.apiKey.update({ where: { key }, data: { lastUsed: new Date() } }).catch(() => {})
    return { userId: apiKey.userId, db, redis }
  } catch {
    return { userId: null, db, redis }
  }
}
