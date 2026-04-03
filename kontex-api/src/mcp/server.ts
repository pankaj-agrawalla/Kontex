import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { registerSessionTools } from "./tools/session.tools";
import { registerSnapshotTools } from "./tools/snapshot.tools";
import { registerRollbackTools } from "./tools/rollback.tools";
import { registerContextTools } from "./tools/context.tools";

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "kontex",
    version: "1.0.0",
  });

  registerSessionTools(server, userId);
  registerSnapshotTools(server, userId);
  registerRollbackTools(server, userId);
  registerContextTools(server, userId);

  return server;
}
