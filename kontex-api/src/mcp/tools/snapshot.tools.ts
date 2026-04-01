import { z } from "zod";
import { db } from "../../db";
import { createSnapshot } from "../../services/snapshot.service";
import type { ContextBundle } from "../../types/bundle";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

const fileSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  contentHash: z.string(),
  tokenCount: z.number(),
});

const toolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  status: z.enum(["success", "error"]),
  timestamp: z.string(),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(z.unknown())]),
  timestamp: z.string().optional(),
});

export function registerSnapshotTools(server: McpServer, userId: string): void {
  server.tool(
    "kontex_snapshot",
    "Save an explicit named checkpoint of the current agent context",
    {
      task_id: z.string(),
      label: z.string().min(1).max(200),
      files: z.array(fileSchema).optional(),
      tool_calls: z.array(toolCallSchema).optional(),
      messages: z.array(messageSchema).optional(),
      reasoning: z.string().optional(),
      model: z.string().optional(),
    },
    async (args) => {
      try {
        const task = await db.task.findUnique({
          where: { id: args.task_id },
          include: { session: true },
        });
        if (!task || task.session.userId !== userId) {
          return {
            content: [{ type: "text" as const, text: "Task not found." }],
            isError: true,
          };
        }

        const bundle: ContextBundle = {
          snapshotId: "",
          taskId: args.task_id,
          sessionId: task.sessionId,
          capturedAt: new Date().toISOString(),
          model: args.model ?? "",
          tokenTotal: 0,
          source: "mcp",
          enriched: false,
          files: args.files ?? [],
          toolCalls: (args.tool_calls ?? []) as ContextBundle["toolCalls"],
          messages: (args.messages ?? []) as ContextBundle["messages"],
          reasoning: args.reasoning,
          logEvents: [],
        };

        const snapshot = await createSnapshot({
          taskId: args.task_id,
          label: args.label,
          bundle,
          userId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                snapshot_id: snapshot.id,
                token_total: snapshot.tokenTotal,
                message: `Snapshot saved: ${args.label}`,
              }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to save snapshot. Please try again." }],
          isError: true,
        };
      }
    }
  );
}
