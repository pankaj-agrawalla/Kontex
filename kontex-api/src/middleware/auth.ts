import type { MiddlewareHandler } from "hono";
import { db } from "../db";
import type { Variables } from "../types/api";

export const auth: MiddlewareHandler<{ Variables: Variables }> = async (c, next) => {
  const header = c.req.header("Authorization");

  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
  }

  const key = header.slice(7);

  try {
    const apiKey = await db.apiKey.findUnique({ where: { key } });

    if (!apiKey || !apiKey.active) {
      return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
    }

    // Fire-and-forget lastUsed update
    db.apiKey.update({ where: { key }, data: { lastUsed: new Date() } }).catch(() => {});

    c.set("userId", apiKey.userId);
    c.set("apiKeyId", apiKey.id);

    await next();
  } catch {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
  }
};
