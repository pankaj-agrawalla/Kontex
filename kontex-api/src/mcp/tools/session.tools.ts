import { z } from "zod";
import { db } from "../../db";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

export function registerSessionTools(server: McpServer, userId: string): void {
  // kontex_session_start
  server.tool(
    "kontex_session_start",
    "Start a new Kontex session for tracking agent work",
    {
      name: z.string().min(1).max(200),
      description: z.string().max(500).optional(),
    },
    async (args) => {
      try {
        const session = await db.session.create({
          data: {
            name: args.name,
            description: args.description,
            userId,
          },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ session_id: session.id, message: `Session started: ${session.name}` }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to start session. Please try again." }],
          isError: true,
        };
      }
    }
  );

  // kontex_session_pause
  server.tool(
    "kontex_session_pause",
    "Pause an active Kontex session",
    {
      session_id: z.string(),
    },
    async (args) => {
      try {
        const session = await db.session.findFirst({
          where: { id: args.session_id, userId },
        });
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Session not found." }],
            isError: true,
          };
        }
        await db.session.update({
          where: { id: session.id },
          data: { status: "PAUSED" },
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }) }],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to pause session. Please try again." }],
          isError: true,
        };
      }
    }
  );

  // kontex_task_start
  server.tool(
    "kontex_task_start",
    "Start a new task within a Kontex session",
    {
      session_id: z.string(),
      name: z.string().min(1).max(200),
      parent_task_id: z.string().optional(),
    },
    async (args) => {
      try {
        const session = await db.session.findFirst({
          where: { id: args.session_id, userId },
        });
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Session not found." }],
            isError: true,
          };
        }

        if (args.parent_task_id) {
          const parent = await db.task.findUnique({ where: { id: args.parent_task_id } });
          if (!parent || parent.sessionId !== args.session_id) {
            return {
              content: [{ type: "text" as const, text: "Parent task not found in this session." }],
              isError: true,
            };
          }
        }

        const task = await db.task.create({
          data: {
            name: args.name,
            sessionId: args.session_id,
            parentTaskId: args.parent_task_id ?? null,
            status: "ACTIVE",
          },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ task_id: task.id, message: `Task started: ${task.name}` }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to start task. Please try again." }],
          isError: true,
        };
      }
    }
  );

  // kontex_task_done
  server.tool(
    "kontex_task_done",
    "Mark a Kontex task as completed or failed",
    {
      task_id: z.string(),
      status: z.enum(["completed", "failed"]),
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
        await db.task.update({
          where: { id: task.id },
          data: { status: args.status === "completed" ? "COMPLETED" : "FAILED" },
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }) }],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to update task status. Please try again." }],
          isError: true,
        };
      }
    }
  );
}
