import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import type { Variables } from "../types/api";

const tasks = new Hono<{ Variables: Variables }>();

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "FAILED"]).optional(),
});

type TaskRow = {
  id: string;
  sessionId: string;
  parentTaskId: string | null;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type TaskNode = TaskRow & { children: TaskNode[] };

function buildTree(tasks: TaskRow[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  for (const t of tasks) {
    map.set(t.id, { ...t, children: [] });
  }
  const roots: TaskNode[] = [];
  for (const node of map.values()) {
    if (node.parentTaskId === null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentTaskId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}

function taskResponse(t: TaskRow & { _count?: { snapshots: number } }): object {
  return {
    id: t.id,
    sessionId: t.sessionId,
    parentTaskId: t.parentTaskId,
    name: t.name,
    status: t.status,
    ...(t._count !== undefined ? { snapshotCount: t._count.snapshots } : {}),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// GET /v1/tasks/:id
tasks.get("/:id", async (c) => {
  const task = await db.task.findUnique({
    where: { id: c.req.param("id") },
    include: { session: true, _count: { select: { snapshots: true } } },
  });

  if (!task || task.session.userId !== c.get("userId")) {
    return c.json({ error: "not_found", message: "Task not found" }, 404);
  }

  return c.json(taskResponse(task));
});

// PATCH /v1/tasks/:id
tasks.patch("/:id", async (c) => {
  const existing = await db.task.findUnique({
    where: { id: c.req.param("id") },
    include: { session: true },
  });

  if (!existing || existing.session.userId !== c.get("userId")) {
    return c.json({ error: "not_found", message: "Task not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = updateSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: result.error.flatten() },
      400
    );
  }

  const task = await db.task.update({
    where: { id: existing.id },
    data: result.data,
    include: { _count: { select: { snapshots: true } } },
  });

  return c.json(taskResponse(task));
});

export { buildTree, tasks as default };
