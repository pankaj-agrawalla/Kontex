import { beforeAll, afterAll, describe, test, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const AUTH_A = { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" };
const AUTH_B = { "Authorization": "Bearer test_key_dev_2", "Content-Type": "application/json" };

const db = new PrismaClient();

let sessionId: string;
let taskId: string;

const minimalBundle = {
  model: "claude-opus-4-5",
  source: "proxy" as const,
  messages: [{ role: "user", content: "hello" }],
};

beforeAll(async () => {
  // Ensure second user/key exist (may already be seeded by sessions.test.ts)
  await db.user.upsert({
    where: { email: "test2@kontex.local" },
    update: {},
    create: { id: "user_test2", email: "test2@kontex.local" },
  });
  await db.apiKey.upsert({
    where: { key: "test_key_dev_2" },
    update: {},
    create: { id: "key_test2", key: "test_key_dev_2", userId: "user_test2", active: true },
  });

  // Create a session + task for user A to use across all snapshot tests
  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: AUTH_A,
    body: JSON.stringify({ name: "Snapshot test session" }),
  });
  const sess = await sessRes.json() as Record<string, unknown>;
  sessionId = sess.id as string;

  const taskRes = await fetch(`${BASE}/v1/sessions/${sessionId}/tasks`, {
    method: "POST",
    headers: AUTH_A,
    body: JSON.stringify({ name: "Snapshot test task" }),
  });
  const task = await taskRes.json() as Record<string, unknown>;
  taskId = task.id as string;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("POST /v1/tasks/:id/snapshots", () => {
  test("creates snapshot → 201, source proxy, enriched false", async () => {
    const res = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "initial checkpoint", bundle: minimalBundle }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.taskId).toBe(taskId);
    expect(body.source).toBe("proxy");
    expect(body.enriched).toBe(false);
    expect(body.label).toBe("initial checkpoint");
  });

  test("missing label → 400 validation_error", async () => {
    const res = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ bundle: minimalBundle }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("validation_error");
  });

  test("nonexistent task → 404", async () => {
    const res = await fetch(`${BASE}/v1/tasks/nonexistent_task/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "x", bundle: minimalBundle }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });
});

describe("GET /v1/snapshots/:id", () => {
  test("returns metadata + bundle with messages and empty files", async () => {
    // Create snapshot
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "bundle test", bundle: minimalBundle }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    // GET snapshot
    const res = await fetch(`${BASE}/v1/snapshots/${id}`, { headers: AUTH_A });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(id);
    expect(body.bundle).toBeDefined();
    const bundle = body.bundle as Record<string, unknown>;
    expect(Array.isArray(bundle.messages)).toBe(true);
    expect(Array.isArray(bundle.files)).toBe(true);
    expect((bundle.files as unknown[]).length).toBe(0);
    expect(bundle.source).toBe("proxy");
    expect(bundle.enriched).toBe(false);
  });

  test("wrong user → 404", async () => {
    // Create snapshot as user A
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "private snapshot", bundle: minimalBundle }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    // GET as user B
    const res = await fetch(`${BASE}/v1/snapshots/${id}`, { headers: AUTH_B });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  test("nonexistent id → 404", async () => {
    const res = await fetch(`${BASE}/v1/snapshots/nonexistent`, { headers: AUTH_A });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/snapshots/:id/bundle", () => {
  test("returns raw bundle JSON only", async () => {
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "raw bundle test", bundle: minimalBundle }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await fetch(`${BASE}/v1/snapshots/${id}/bundle`, { headers: AUTH_A });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // Should be the bundle directly, not wrapped in metadata
    expect(body.snapshotId).toBe(id);
    expect(body.id).toBeUndefined(); // no snapshot metadata fields
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe("POST /v1/snapshots/:id/rollback", () => {
  test("creates new snapshot with rollback label and bundle", async () => {
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "pre-rollback", bundle: minimalBundle }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const sourceId = created.id as string;

    const res = await fetch(`${BASE}/v1/snapshots/${sourceId}/rollback`, {
      method: "POST",
      headers: AUTH_A,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.rollback_snapshot_id).toBeDefined();
    expect(body.rollback_snapshot_id).not.toBe(body.source_snapshot_id);
    expect(body.source_snapshot_id).toBe(sourceId);
    expect((body.label as string).startsWith("Rollback to: ")).toBe(true);
    const bundle = body.bundle as Record<string, unknown>;
    expect(Array.isArray(bundle.messages)).toBe(true);
  });

  test("original snapshot is unchanged after rollback", async () => {
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "original-label", bundle: minimalBundle }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const sourceId = created.id as string;
    const originalLabel = created.label as string;
    const originalR2Key = created.r2Key as string | undefined;

    await fetch(`${BASE}/v1/snapshots/${sourceId}/rollback`, {
      method: "POST",
      headers: AUTH_A,
    });

    const getRes = await fetch(`${BASE}/v1/snapshots/${sourceId}`, { headers: AUTH_A });
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as Record<string, unknown>;
    expect(body.label).toBe(originalLabel);
    if (originalR2Key) expect(body.r2Key).toBe(originalR2Key);
  });

  test("wrong user → 404", async () => {
    const createRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ label: "user-a-snapshot", bundle: minimalBundle }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const sourceId = created.id as string;

    const res = await fetch(`${BASE}/v1/snapshots/${sourceId}/rollback`, {
      method: "POST",
      headers: AUTH_B,
    });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });
});

describe("GET /v1/sessions/:sessionId/snapshots", () => {
  test("returns snapshot list for session", async () => {
    const res = await fetch(`${BASE}/v1/sessions/${sessionId}/snapshots`, { headers: AUTH_A });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });

  test("wrong user → 404", async () => {
    const res = await fetch(`${BASE}/v1/sessions/${sessionId}/snapshots`, { headers: AUTH_B });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });
});
