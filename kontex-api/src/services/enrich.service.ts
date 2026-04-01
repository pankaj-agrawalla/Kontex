import { db } from "../db"
import { enrichSnapshot } from "./snapshot.service"
import { ContextFile, ToolCall, LogEvent } from "../types/bundle"

export async function applyEnrichment(params: {
  snapshotId: string
  userId: string
  files: ContextFile[]
  toolCalls: ToolCall[]
  logEvents: LogEvent[]
  reasoning?: string
}): Promise<{ snapshotId: string; enriched: true; enrichedAt: Date }> {
  await enrichSnapshot({
    snapshotId: params.snapshotId,
    enrichment: {
      files: params.files,
      toolCalls: params.toolCalls,
      logEvents: params.logEvents,
      reasoning: params.reasoning,
    },
    userId: params.userId,
  })
  const updated = await db.snapshot.findUnique({ where: { id: params.snapshotId } })
  return { snapshotId: params.snapshotId, enriched: true, enrichedAt: updated!.enrichedAt! }
}
