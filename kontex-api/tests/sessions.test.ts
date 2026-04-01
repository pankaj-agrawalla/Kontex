import { beforeAll, afterAll, describe, test, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const AUTH_A = { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" };
const AUTH_B = { "Authorization": "Bearer test_key_dev_2", "Content-Type": "application/json" };

const db = new PrismaClient();

beforeAll(async () => {
  // Seed second user + API key for cross-user ownership tests
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
});

afterAll(async () => {
  await db.$disconnect();
});

describe("POST /v1/sessions", () => {
  test("happy path → 201", async () => {
    const res = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "Test session" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.status).toBe("ACTIVE");
    expect(body.name).toBe("Test session");
  });

  test("missing name → 400 validation_error", async () => {
    const res = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("validation_error");
  });

  test("name too long → 400 validation_error", async () => {
    const res = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("validation_error");
  });
});

describe("GET /v1/sessions", () => {
  test("without auth → 401 unauthorized", async () => {
    const res = await fetch(`${BASE}/v1/sessions`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  test("with auth → 200 with data array", async () => {
    const res = await fetch(`${BASE}/v1/sessions`, { headers: AUTH_A });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.data)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });
});

describe("GET /v1/sessions/:id", () => {
  test("wrong user → 404", async () => {
    // Create session as user A
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "User A session" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    // Attempt to GET as user B
    const getRes = await fetch(`${BASE}/v1/sessions/${id}`, { headers: AUTH_B });
    expect(getRes.status).toBe(404);
    const body = await getRes.json() as Record<string, unknown>;
    expect(body.error).toBe("not_found");
  });

  test("own session → 200 with taskCount", async () => {
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "My session" }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await fetch(`${BASE}/v1/sessions/${id}`, { headers: AUTH_A });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(id);
    expect(typeof body.taskCount).toBe("number");
  });

  test("nonexistent id → 404", async () => {
    const res = await fetch(`${BASE}/v1/sessions/nonexistent`, { headers: AUTH_A });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/sessions/:id", () => {
  test("update name → 200 with new name", async () => {
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "Original" }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await fetch(`${BASE}/v1/sessions/${id}`, {
      method: "PATCH",
      headers: AUTH_A,
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("Updated");
  });

  test("wrong user → 404", async () => {
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "User A session" }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await fetch(`${BASE}/v1/sessions/${id}`, {
      method: "PATCH",
      headers: AUTH_B,
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/sessions/:id", () => {
  test("soft delete → 204", async () => {
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "To delete" }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const delRes = await fetch(`${BASE}/v1/sessions/${id}`, {
      method: "DELETE",
      headers: AUTH_A,
    });
    expect(delRes.status).toBe(204);

    // Row still exists, status is COMPLETED
    const getRes = await fetch(`${BASE}/v1/sessions/${id}`, { headers: AUTH_A });
    expect(getRes.status).toBe(200);
    const body = await getRes.json() as Record<string, unknown>;
    expect(body.status).toBe("COMPLETED");
  });

  test("wrong user → 404", async () => {
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: "POST",
      headers: AUTH_A,
      body: JSON.stringify({ name: "Protected" }),
    });
    const created = await createRes.json() as Record<string, unknown>;
    const id = created.id as string;

    const res = await fetch(`${BASE}/v1/sessions/${id}`, {
      method: "DELETE",
      headers: AUTH_B,
    });
    expect(res.status).toBe(404);
  });
});
