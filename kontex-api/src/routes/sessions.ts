import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { buildTree } from "./tasks";
import type { Variables } from "../types/api";

const sessions = new Hono<{ Variables: Variables }>();

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]).optional(),
});

function sessionResponse(s: {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { tasks: number };
}): object {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status,
    ...(s._count !== undefined ? { taskCount: s._count.tasks } : {}),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// POST /v1/sessions
sessions.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = createSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: result.error.flatten() },
      400
    );
  }

  const session = await db.session.create({
    data: {
      name: result.data.name,
      description: result.data.description,
      userId: c.get("userId"),
    },
  });

  return c.json(sessionResponse(session), 201);
});

// GET /v1/sessions
sessions.get("/", async (c) => {
  const status = c.req.query("status") as "ACTIVE" | "PAUSED" | "COMPLETED" | undefined;
  const limitRaw = Number(c.req.query("limit") ?? "20");
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 20 : limitRaw), 100);
  const cursor = c.req.query("cursor");

  const where = {
    userId: c.get("userId"),
    ...(status ? { status } : {}),
    ...(cursor ? { id: { lt: cursor } } : {}),
  };

  const data = await db.session.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  const nextCursor = data.length === limit ? (data[data.length - 1]?.id ?? null) : null;

  return c.json({ data: data.map(sessionResponse), nextCursor });
});

// GET /v1/sessions/:id
sessions.get("/:id", async (c) => {
  const session = await db.session.findFirst({
    where: { id: c.req.param("id"), userId: c.get("userId") },
    include: { _count: { select: { tasks: true } } },
  });

  if (!session) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  return c.json(sessionResponse(session));
});

// PATCH /v1/sessions/:id
sessions.patch("/:id", async (c) => {
  const existing = await db.session.findFirst({
    where: { id: c.req.param("id"), userId: c.get("userId") },
  });

  if (!existing) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = updateSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: result.error.flatten() },
      400
    );
  }

  const session = await db.session.update({
    where: { id: existing.id },
    data: result.data,
    include: { _count: { select: { tasks: true } } },
  });

  return c.json(sessionResponse(session));
});

// DELETE /v1/sessions/:id
sessions.delete("/:id", async (c) => {
  const existing = await db.session.findFirst({
    where: { id: c.req.param("id"), userId: c.get("userId") },
  });

  if (!existing) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  await db.session.update({
    where: { id: existing.id },
    data: { status: "COMPLETED" },
  });

  return new Response(null, { status: 204 });
});

const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  parentTaskId: z.string().optional(),
});

// POST /v1/sessions/:sessionId/tasks
sessions.post("/:sessionId/tasks", async (c) => {
  const sessionId = c.req.param("sessionId");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: c.get("userId") },
  });
  if (!session) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const result = createTaskSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: "validation_error", message: "Invalid request body", details: result.error.flatten() },
      400
    );
  }

  if (result.data.parentTaskId) {
    const parent = await db.task.findUnique({ where: { id: result.data.parentTaskId } });
    if (!parent || parent.sessionId !== sessionId) {
      return c.json({ error: "validation_error", message: "Invalid parentTaskId" }, 400);
    }
  }

  const task = await db.task.create({
    data: {
      name: result.data.name,
      sessionId,
      parentTaskId: result.data.parentTaskId ?? null,
    },
  });

  return c.json(
    {
      id: task.id,
      sessionId: task.sessionId,
      parentTaskId: task.parentTaskId,
      name: task.name,
      status: task.status,
      createdAt: task.createdAt,
    },
    201
  );
});

// GET /v1/sessions/:sessionId/tasks
sessions.get("/:sessionId/tasks", async (c) => {
  const sessionId = c.req.param("sessionId");

  const session = await db.session.findFirst({
    where: { id: sessionId, userId: c.get("userId") },
  });
  if (!session) {
    return c.json({ error: "not_found", message: "Session not found" }, 404);
  }

  const allTasks = await db.task.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });

  return c.json({ data: buildTree(allTasks) });
});

export default sessions;
