import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import {
  createSnapshot,
  getSnapshot,
  rollbackToSnapshot,
} from "../services/snapshot.service";
import type { Variables } from "../types/api";
import type { ContextBundle } from "../types/bundle";

const app = new Hono<{ Variables: Variables }>();

const bundleSchema = z.object({
  model: z.string(),
  tokenTotal: z.number().optional(),
  source: z.enum(["proxy", "log_watcher", "mcp"]).default("proxy"),
  files: z.array(z.unknown()).default([]),
  toolCalls: z.array(z.unknown()).default([]),
  messages: z.array(z.unknown()),
  reasoning: z.string().optional(),
  logEvents: z.array(z.unknown()).default([]),
});

const createSnapshotBody = z.object({
  label: z.string().min(1).max(200),
  bundle: bundleSchema,
});

// POST /v1/tasks/:taskId/snapshots
app.post("/tasks/:taskId/snapshots", async (c) => {
    const userId = c.get("userId");
    const taskId = c.req.param("taskId");
    const body = await c.req.json().catch(() => null);
    const parsed = createSnapshotBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "validation_error",
          message: "Invalid request body",
          details: parsed.error.flatten(),
        },
        400
      );
    }
    const { label, bundle: rawBundle } = parsed.data;

    const bundle: ContextBundle = {
      snapshotId: "",
      taskId,
      sessionId: "",
      capturedAt: new Date().toISOString(),
      model: rawBundle.model,
      tokenTotal: rawBundle.tokenTotal ?? 0,
      source: rawBundle.source,
      enriched: false,
      files: rawBundle.files as ContextBundle["files"],
      toolCalls: rawBundle.toolCalls as ContextBundle["toolCalls"],
      messages: rawBundle.messages as ContextBundle["messages"],
      reasoning: rawBundle.reasoning,
      logEvents: rawBundle.logEvents as ContextBundle["logEvents"],
    };

    try {
      const snapshot = await createSnapshot({ taskId, label, bundle, userId });
      return c.json(
        {
          id: snapshot.id,
          taskId: snapshot.taskId,
          label: snapshot.label,
          tokenTotal: snapshot.tokenTotal,
          source: snapshot.source,
          enriched: snapshot.enriched,
          createdAt: snapshot.createdAt,
        },
        201
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("NOT_FOUND")) {
        return c.json({ error: "not_found", message: "Task not found" }, 404);
      }
      if (msg.startsWith("R2_WRITE_FAILED")) {
        return c.json(
          { error: "upstream_error", message: "Failed to write bundle to storage" },
          502
        );
      }
      return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
    }
  }
);

// GET /v1/sessions/:sessionId/snapshots
app.get("/sessions/:sessionId/snapshots", async (c) => {
  const userId = c.get("userId");
  const sessionId = c.req.param("sessionId");

  const session = await db.session.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.userId !== userId) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  const limitParam = Number(c.req.query("limit") ?? "20");
  const limit = Math.min(Math.max(1, limitParam), 100);
  const cursor = c.req.query("cursor");

  const snapshots = await db.snapshot.findMany({
    where: {
      task: { sessionId },
      ...(cursor ? { id: { lt: cursor } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const nextCursor =
    snapshots.length === limit ? snapshots[snapshots.length - 1].id : null;

  return c.json({ data: snapshots, nextCursor });
});

// GET /v1/snapshots/:id
app.get("/snapshots/:id", async (c) => {
  const userId = c.get("userId");
  const snapshotId = c.req.param("id");

  try {
    const { snapshot, bundle } = await getSnapshot(snapshotId, userId);
    return c.json({
      id: snapshot.id,
      taskId: snapshot.taskId,
      label: snapshot.label,
      tokenTotal: snapshot.tokenTotal,
      model: snapshot.model,
      source: snapshot.source,
      enriched: snapshot.enriched,
      enrichedAt: snapshot.enrichedAt,
      embedded: snapshot.embedded,
      r2Key: snapshot.r2Key,
      createdAt: snapshot.createdAt,
      bundle,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("NOT_FOUND")) {
      return c.json({ error: "not_found", message: "Snapshot not found" }, 404);
    }
    if (msg.startsWith("R2_READ_FAILED")) {
      return c.json(
        { error: "upstream_error", message: "Failed to read bundle from storage" },
        502
      );
    }
    return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});

// POST /v1/snapshots/:id/rollback
app.post("/snapshots/:id/rollback", async (c) => {
  const userId = c.get("userId");
  const snapshotId = c.req.param("id");

  try {
    const result = await rollbackToSnapshot({ snapshotId, userId });
    return c.json({
      rollback_snapshot_id: result.rollbackSnapshotId,
      source_snapshot_id: result.sourceSnapshotId,
      label: result.label,
      captured_at: result.capturedAt,
      token_total: result.tokenTotal,
      bundle: result.bundle,
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("NOT_FOUND")) {
      return c.json({ error: "not_found", message: "Snapshot not found" }, 404);
    }
    if (msg.startsWith("R2_READ_FAILED")) {
      return c.json(
        { error: "upstream_error", message: "Failed to read bundle from storage" },
        502
      );
    }
    if (msg.startsWith("R2_WRITE_FAILED")) {
      return c.json(
        { error: "upstream_error", message: "Failed to write rollback bundle to storage" },
        502
      );
    }
    return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});

// GET /v1/snapshots/:id/bundle
app.get("/snapshots/:id/bundle", async (c) => {
  const userId = c.get("userId");
  const snapshotId = c.req.param("id");

  try {
    const { bundle } = await getSnapshot(snapshotId, userId);
    return c.json(bundle);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("NOT_FOUND")) {
      return c.json({ error: "not_found", message: "Snapshot not found" }, 404);
    }
    if (msg.startsWith("R2_READ_FAILED")) {
      return c.json(
        { error: "upstream_error", message: "Failed to read bundle from storage" },
        502
      );
    }
    return c.json({ error: "internal_error", message: "An unexpected error occurred" }, 500);
  }
});

export default app;
