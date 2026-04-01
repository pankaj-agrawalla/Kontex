import type { MiddlewareHandler } from "hono";

export const logger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${c.req.method} ${c.req.path} → ${c.res.status} (${duration}ms)`);
};
