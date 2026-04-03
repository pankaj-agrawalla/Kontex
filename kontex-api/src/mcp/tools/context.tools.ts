import { z } from "zod";
import { VoyageAIClient } from "voyageai";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { config } from "../../config";
import { db } from "../../db";
import { getSnapshot } from "../../services/snapshot.service";

const voyage = new VoyageAIClient({ apiKey: config.VOYAGE_API_KEY });
const qdrant = new QdrantClient({ url: config.QDRANT_URL, apiKey: config.QDRANT_API_KEY });

export function registerContextTools(server: McpServer, userId: string): void {
  // ─── kontex_search ───────────────────────────────────────────────────────────
  server.tool(
    "kontex_search",
    "Search past snapshots semantically. Use this when you need to recall what was done in a previous run, find prior context for the current task, or check whether a similar problem was already solved. Returns snapshot IDs — call kontex_get_context with any ID to retrieve the full bundle.",
    {
      query: z.string().describe("Natural language description of what you're looking for"),
      limit: z.number().min(1).max(20).default(5).optional(),
      session_id: z.string().optional().describe("If provided, search within that session only"),
    },
    async (args) => {
      if (!config.QDRANT_URL || !config.VOYAGE_API_KEY) {
        return {
          content: [{
            type: "text" as const,
            text: "Semantic search is not configured on this Kontex instance. Use kontex_list_snapshots to browse by recency.",
          }],
        };
      }

      try {
        const limit = args.limit ?? 5;

        const embedResult = await voyage.embed({ input: [args.query], model: "voyage-code-3" });
        const queryVector = embedResult.data?.[0]?.embedding;
        if (!queryVector) {
          return {
            content: [{ type: "text" as const, text: "Failed to embed search query. Please try again." }],
            isError: true,
          };
        }

        type QdrantFilter = {
          must: Array<{ key: string; match: { value: string } }>;
        };
        const filter: QdrantFilter = {
          must: [{ key: "userId", match: { value: userId } }],
        };
        if (args.session_id) {
          filter.must.push({ key: "sessionId", match: { value: args.session_id } });
        }

        const results = await qdrant.search(config.QDRANT_COLLECTION, {
          vector: queryVector,
          limit,
          filter,
          with_payload: true,
        });

        if (results.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No relevant snapshots found. Try a different query or use kontex_list_snapshots to browse by recency.",
            }],
          };
        }

        const lines: string[] = [`Found ${results.length} relevant snapshot${results.length === 1 ? "" : "s"}:\n`];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const p = r.payload as Record<string, string> | null;
          if (!p) continue;
          const capturedAt = p["createdAt"] ? new Date(p["createdAt"]).toISOString().slice(0, 16).replace("T", " ") : "unknown";
          lines.push(
            `${i + 1}. [${p["label"] ?? ""}] — ${capturedAt} — source: ${p["source"] ?? ""}`,
            `   Snapshot ID: ${p["snapshotId"] ?? ""}`,
            "",
          );
        }
        lines.push('Call kontex_get_context with any Snapshot ID above to retrieve the full bundle.');

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Search failed. Please try again." }],
          isError: true,
        };
      }
    }
  );

  // ─── kontex_get_context ──────────────────────────────────────────────────────
  server.tool(
    "kontex_get_context",
    "Retrieve the full context bundle for a snapshot. Use this to inspect prior agent state — the bundle contains the complete message history, tool call log, and reasoning trace captured at that point in time. Also shows how to roll back to it.",
    {
      snapshot_id: z.string(),
    },
    async (args) => {
      try {
        const { snapshot, bundle } = await getSnapshot(args.snapshot_id, userId);

        const capturedAt = bundle.capturedAt
          ? new Date(bundle.capturedAt).toISOString().slice(0, 16).replace("T", " ")
          : snapshot.createdAt.toISOString().slice(0, 16).replace("T", " ");

        const lines: string[] = [
          `Snapshot: ${snapshot.label}`,
          `Captured: ${capturedAt} | Model: ${snapshot.model ?? "unknown"} | Tokens: ${snapshot.tokenTotal} | Source: ${snapshot.source}`,
          "",
          `=== MESSAGES (${bundle.messages.length}) ===`,
        ];

        for (const msg of bundle.messages) {
          const raw = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          const truncated = raw.length > 300 ? raw.slice(0, 300) + " [truncated]" : raw;
          lines.push(`${msg.role.toUpperCase()}: ${truncated}`);
        }

        lines.push("", `=== TOOL CALLS (${bundle.toolCalls.length}) ===`);
        for (const tc of bundle.toolCalls) {
          const ts = tc.timestamp ? ` (${new Date(tc.timestamp).toISOString().slice(0, 16).replace("T", " ")})` : "";
          lines.push(`${tc.tool} → ${tc.status}${ts}`);
        }

        lines.push(
          "",
          "=== TO ROLLBACK ===",
          `Call kontex_rollback with snapshot_id: "${snapshot.id}"`,
          `Or POST /v1/snapshots/${snapshot.id}/rollback via REST API.`,
        );

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("NOT_FOUND")) {
          return {
            content: [{
              type: "text" as const,
              text: "Snapshot not found or access denied. Use kontex_list_snapshots to find available IDs.",
            }],
          };
        }
        if (msg.includes("R2_READ_FAILED")) {
          return {
            content: [{ type: "text" as const, text: "Failed to read snapshot bundle from storage. Try again." }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: "Failed to retrieve snapshot. Please try again." }],
          isError: true,
        };
      }
    }
  );

  // ─── kontex_list_snapshots ───────────────────────────────────────────────────
  server.tool(
    "kontex_list_snapshots",
    "List recent snapshots for a session. Use this to see what has been captured and find snapshot IDs for kontex_get_context or kontex_rollback.",
    {
      session_id: z.string(),
      limit: z.number().min(1).max(50).default(10).optional(),
    },
    async (args) => {
      try {
        const limit = args.limit ?? 10;

        const session = await db.session.findUnique({
          where: { id: args.session_id },
          include: { tasks: { select: { id: true } } },
        });
        if (!session || session.userId !== userId) {
          return {
            content: [{ type: "text" as const, text: "Session not found or access denied." }],
          };
        }

        const taskIds = session.tasks.map((t) => t.id);
        const snapshots = await db.snapshot.findMany({
          where: { taskId: { in: taskIds } },
          orderBy: { createdAt: "desc" },
          take: limit,
        });

        if (snapshots.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No snapshots found for session ${args.session_id}.`,
            }],
          };
        }

        const COL_ID = 22;
        const COL_LABEL = 30;
        const COL_DATE = 17;
        const COL_TOKENS = 8;
        const COL_SOURCE = 14;

        const pad = (s: string, n: number): string => s.slice(0, n).padEnd(n);

        const header = [
          pad("ID", COL_ID),
          pad("Label", COL_LABEL),
          pad("Captured", COL_DATE),
          pad("Tokens", COL_TOKENS),
          pad("Source", COL_SOURCE),
        ].join(" | ");

        const divider = [
          "─".repeat(COL_ID),
          "─".repeat(COL_LABEL),
          "─".repeat(COL_DATE),
          "─".repeat(COL_TOKENS),
          "─".repeat(COL_SOURCE),
        ].join("─┼─");

        const rows = snapshots.map((s) => {
          const date = s.createdAt.toISOString().slice(0, 16).replace("T", " ");
          return [
            pad(s.id, COL_ID),
            pad(s.label, COL_LABEL),
            pad(date, COL_DATE),
            pad(String(s.tokenTotal), COL_TOKENS),
            pad(s.source, COL_SOURCE),
          ].join(" | ");
        });

        const lines = [
          `Recent snapshots for session ${args.session_id} (${snapshots.length} shown):\n`,
          header,
          divider,
          ...rows,
          "",
          "Call kontex_get_context with any full ID above to retrieve the bundle.",
        ];

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Failed to list snapshots. Please try again." }],
          isError: true,
        };
      }
    }
  );
}
