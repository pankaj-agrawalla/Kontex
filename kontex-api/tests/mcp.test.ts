import { beforeAll, afterAll, describe, test, expect } from "vitest";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const AUTH_A = { "Authorization": "Bearer test_key_dev", "Content-Type": "application/json" };
const AUTH_B = { "Authorization": "Bearer test_key_dev_2", "Content-Type": "application/json" };
const MCP_URL = `${BASE}/mcp`;

const db = new PrismaClient();

const minimalBundle = {
  model: "claude-opus-4-5",
  source: "proxy" as const,
  messages: [{ role: "user", content: "hello from mcp test" }],
};

// ─── MCP helpers ──────────────────────────────────────────────────────────────

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

/** Parse a response that may be plain JSON or SSE (event: message\ndata: ...) */
async function parseJsonOrSse(res: Response): Promise<JsonRpcResponse> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) throw new Error(`No data line in SSE response: ${text.slice(0, 200)}`);
    return JSON.parse(dataLine.slice(6)) as JsonRpcResponse;
  }
  return res.json() as Promise<JsonRpcResponse>;
}

async function mcpInit(authHeader: string): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vitest", version: "1.0" },
      },
    }),
  });
  const sessionId = res.headers.get("Mcp-Session-Id");
  if (!sessionId) throw new Error(`No Mcp-Session-Id returned (status ${res.status})`);
  return sessionId;
}

async function mcpCall(
  mcpSessionId: string,
  authHeader: string,
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": mcpSessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    }),
  });

  const body = await parseJsonOrSse(res);
  if (body.error) throw new Error(`MCP error: ${body.error.message}`);

  const result = body.result as { content: Array<{ type: string; text: string }> };
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") throw new Error(`No text content in MCP response: ${JSON.stringify(body)}`);
  return text;
}

// ─── Test data ────────────────────────────────────────────────────────────────

let sessionId: string;
let snapshotId: string | undefined;

beforeAll(async () => {
  // Ensure second user/key exist
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

  // Create session + task as user A
  const sessRes = await fetch(`${BASE}/v1/sessions`, {
    method: "POST",
    headers: AUTH_A,
    body: JSON.stringify({ name: "MCP read tool test session" }),
  });
  const sess = await sessRes.json() as Record<string, unknown>;
  sessionId = sess.id as string;

  const taskRes = await fetch(`${BASE}/v1/sessions/${sessionId}/tasks`, {
    method: "POST",
    headers: AUTH_A,
    body: JSON.stringify({ name: "MCP read tool test task" }),
  });
  const task = await taskRes.json() as Record<string, unknown>;
  const taskId = task.id as string;

  // Try to create a snapshot — may fail if R2 is unavailable
  const snapRes = await fetch(`${BASE}/v1/tasks/${taskId}/snapshots`, {
    method: "POST",
    headers: AUTH_A,
    body: JSON.stringify({ label: "mcp-read-test checkpoint", bundle: minimalBundle }),
  });
  if (snapRes.status === 201) {
    const snap = await snapRes.json() as Record<string, unknown>;
    snapshotId = snap.id as string;
  }
  // If R2 is unavailable, snapshotId stays undefined — tests that need it skip
}, 15000);

afterAll(async () => {
  await db.$disconnect();
});

// ─── kontex_list_snapshots ────────────────────────────────────────────────────

describe("kontex_list_snapshots", () => {
  test("returns formatted table with column headers", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_list_snapshots", {
      session_id: sessionId,
    });

    expect(typeof text).toBe("string");
    expect(text).toContain("ID");
    expect(text).toContain("Label");
    expect(text).toContain("Captured");
    expect(text).toContain("Tokens");
    expect(text).toContain("Source");

    // Only check snapshotId if R2 was available and snapshot was created
    if (snapshotId) {
      expect(text).toContain(snapshotId);
    }
  });

  test("wrong user → access denied message", async () => {
    const mcpSessionId = await mcpInit("test_key_dev_2");
    const text = await mcpCall(mcpSessionId, "test_key_dev_2", "kontex_list_snapshots", {
      session_id: sessionId,
    });

    expect(text).toMatch(/not found or access denied/i);
  });

  test("unknown session_id → access denied message", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_list_snapshots", {
      session_id: "nonexistent_session",
    });

    expect(text).toMatch(/not found or access denied/i);
  });
});

// ─── kontex_get_context ───────────────────────────────────────────────────────

describe("kontex_get_context", () => {
  test.skipIf(!snapshotId)("returns MESSAGES and TO ROLLBACK sections", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_get_context", {
      snapshot_id: snapshotId!,
    });

    expect(typeof text).toBe("string");
    expect(text).toContain("=== MESSAGES");
    expect(text).toContain("=== TO ROLLBACK ===");
    expect(text).toContain(snapshotId!);
  });

  test.skipIf(!snapshotId)("includes snapshot label and token count", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_get_context", {
      snapshot_id: snapshotId!,
    });

    expect(text).toContain("mcp-read-test checkpoint");
    expect(text).toContain("Tokens:");
  });

  test("wrong user → access denied message", async () => {
    // Use a known-nonexistent ID when snapshot wasn't created, or use snapshotId with wrong user
    const id = snapshotId ?? "nonexistent_for_cross_user_test";
    const mcpSessionId = await mcpInit("test_key_dev_2");
    const text = await mcpCall(mcpSessionId, "test_key_dev_2", "kontex_get_context", {
      snapshot_id: id,
    });

    expect(text).toMatch(/not found or access denied/i);
  });

  test("nonexistent snapshot_id → access denied message", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_get_context", {
      snapshot_id: "nonexistent_snap",
    });

    expect(text).toMatch(/not found or access denied/i);
  });
});

// ─── kontex_search ────────────────────────────────────────────────────────────

describe("kontex_search", () => {
  test("without Qdrant configured → graceful message (no crash)", async () => {
    const mcpSessionId = await mcpInit("test_key_dev");
    let text: string;
    try {
      text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_search", {
        query: "test query for mcp read tools",
      });
    } catch {
      throw new Error("kontex_search threw instead of returning a graceful message");
    }

    expect(typeof text!).toBe("string");
    // Either found results or returned the not-configured message — never an internal error
    expect(text!).not.toContain("internal_error");
    expect(text!).not.toContain("stack");
  });

  test("response is 'not configured' or a result list — never an exception", async () => {
    const isQdrantConfigured =
      !!process.env["QDRANT_URL"] && !!process.env["VOYAGE_API_KEY"];

    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_search", {
      query: "auth bug",
    });

    if (!isQdrantConfigured) {
      expect(text).toMatch(/not configured/i);
    } else {
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  test("session_id filter accepted without error", async () => {
    const isQdrantConfigured =
      !!process.env["QDRANT_URL"] && !!process.env["VOYAGE_API_KEY"];
    if (!isQdrantConfigured) return;

    const mcpSessionId = await mcpInit("test_key_dev");
    const text = await mcpCall(mcpSessionId, "test_key_dev", "kontex_search", {
      query: "mcp read test checkpoint",
      session_id: sessionId,
      limit: 5,
    });

    expect(typeof text).toBe("string");
  });
});
