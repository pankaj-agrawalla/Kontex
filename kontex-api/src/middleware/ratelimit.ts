import type { Context, Next } from "hono"
import { redis, isRedisReady } from "../redis"
import type { Variables } from "../types/api"

function getHourBucket(): string {
  return new Date().toISOString().slice(0, 13)
}

function secondsUntilNextHour(): number {
  const now = new Date()
  const nextHour = new Date(now)
  nextHour.setMinutes(0, 0, 0)
  nextHour.setHours(nextHour.getHours() + 1)
  return Math.ceil((nextHour.getTime() - now.getTime()) / 1000)
}

export async function rateLimit(
  c: Context<{ Variables: Variables }>,
  next: Next
): Promise<Response | void> {
  const apiKeyId = c.get("apiKeyId")
  if (!apiKeyId) return next()
  if (!isRedisReady) return next()

  const isWritePath =
    c.req.method === "POST" &&
    (c.req.path.includes("/snapshots") || c.req.path.includes("/proxy"))

  const bucket = getHourBucket()
  const hourlyKey = `rl:${apiKeyId}:hourly:${bucket}`
  const writeKey = `rl:${apiKeyId}:writes:${bucket}`

  try {
    const [hourly, writes] = await redis.mget(hourlyKey, writeKey)

    if (parseInt(hourly ?? "0") >= 1000) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Hourly request limit reached",
          details: { retry_after: secondsUntilNextHour() },
        },
        429
      )
    }

    if (isWritePath && parseInt(writes ?? "0") >= 100) {
      return c.json(
        {
          error: "rate_limit_exceeded",
          message: "Hourly snapshot write limit reached",
          details: { retry_after: secondsUntilNextHour() },
        },
        429
      )
    }

    await redis.incr(hourlyKey)
    await redis.expire(hourlyKey, 3600)

    if (isWritePath) {
      await redis.incr(writeKey)
      await redis.expire(writeKey, 3600)
    }
  } catch (err) {
    // Redis unavailable — allow the request through rather than blocking all traffic
    console.error("[ratelimit] Redis error, skipping rate limit check:", (err as Error).message)
  }

  return next()
}
