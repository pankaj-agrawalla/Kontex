import { Hono } from "hono";
import { nanoid } from "nanoid";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp";
import { db } from "../db";
import { createMcpServer } from "../mcp/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { Variables } from "../types/api";

type McpSession = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

const mcpSessions = new Map<string, McpSession>();

const mcp = new Hono<{ Variables: Variables }>();

async function resolveUserId(rawKey: string): Promise<string | null> {
  const apiKey = await db.apiKey.findUnique({ where: { key: rawKey } });
  if (!apiKey || !apiKey.active) return null;
  db.apiKey.update({ where: { key: rawKey }, data: { lastUsed: new Date() } }).catch(() => {});
  return apiKey.userId;
}

mcp.all("/", async (c) => {
  const rawKey =
    c.req.header("X-Kontex-Api-Key") ??
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

  if (!rawKey) {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
  }

  const userId = await resolveUserId(rawKey);
  if (!userId) {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401);
  }

  // Route to existing session if session ID header is present
  const sessionId = c.req.header("Mcp-Session-Id");
  if (sessionId) {
    const session = mcpSessions.get(sessionId);
    if (!session) {
      return c.json({ error: "not_found", message: "MCP session not found" }, 404);
    }
    return session.transport.handleRequest(c.req.raw);
  }

  // No session ID — create a new server + transport for this session
  const server = createMcpServer(userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => nanoid(),
    onsessioninitialized: (newSessionId) => {
      mcpSessions.set(newSessionId, { server, transport });
    },
    onsessionclosed: (closedSessionId) => {
      mcpSessions.delete(closedSessionId);
    },
  });

  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default mcp;
