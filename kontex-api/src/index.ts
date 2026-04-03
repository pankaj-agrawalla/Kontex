import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config } from "./config";
import "./db";
import "./redis";
import "./r2";
import { auth } from "./middleware/auth";
import { logger } from "./middleware/logger";
import sessions from "./routes/sessions";
import tasks from "./routes/tasks";
import snapshots from "./routes/snapshots";
import proxy from "./routes/proxy";
import enrich from "./routes/enrich";
import mcpRoute from "./routes/mcp";
import dashboard from "./routes/dashboard";
import keys from "./routes/keys";
import ingest from "./routes/ingest";
import { rateLimit } from "./middleware/ratelimit";
import type { Variables } from "./types/api";

const app = new Hono<{ Variables: Variables }>();

app.use("*", logger);

app.get("/health", (c) => {
  return c.json({ status: "ok", ts: new Date().toISOString(), version: "0.1.0" });
});

app.route("/proxy", proxy);
app.route("/v1", enrich);
app.route("/mcp", mcpRoute);

app.use("/v1/*", auth);
app.use("/v1/*", rateLimit);
app.route("/v1/sessions", sessions);
app.route("/v1/tasks", tasks);
app.route("/v1", snapshots);
app.route("/v1", dashboard);
app.route("/v1/keys", keys);
app.route("/ingest", ingest);

const port = Number(config.PORT);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Kontex API running on port ${port}`);
});

export default app;
