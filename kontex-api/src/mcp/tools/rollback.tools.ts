import { z } from "zod";
import { rollbackToSnapshot } from "../../services/snapshot.service";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

export function registerRollbackTools(server: McpServer, userId: string): void {
  server.tool(
    "kontex_rollback",
    "Restore a prior snapshot and get the full context bundle for re-injection",
    {
      snapshot_id: z.string(),
    },
    async (args) => {
      try {
        const result = await rollbackToSnapshot({
          snapshotId: args.snapshot_id,
          userId,
        });

        const message =
          `Restored to: ${result.label}. To resume from this state:\n` +
          `1. Use bundle.messages as your conversation history\n` +
          `2. Re-open files listed in bundle.files\n` +
          `3. bundle.toolCalls shows what was done up to this point`;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                snapshot_id: result.rollbackSnapshotId,
                label: result.label,
                captured_at: result.capturedAt,
                bundle: result.bundle,
                message,
              }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to restore snapshot. Please try again." }],
          isError: true,
        };
      }
    }
  );
}
