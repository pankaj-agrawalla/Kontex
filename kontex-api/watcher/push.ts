import { ContextFile, ToolCall, LogEvent } from "../src/types/bundle"

export async function pushEnrichment(params: {
  snapshotId: string
  apiKey: string
  apiUrl: string
  files: ContextFile[]
  toolCalls: ToolCall[]
  logEvents: LogEvent[]
  reasoning?: string
}): Promise<"ok" | "expired" | "error"> {
  try {
    const res = await fetch(`${params.apiUrl}/v1/snapshots/${params.snapshotId}/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kontex-Api-Key": params.apiKey,
      },
      body: JSON.stringify({
        files: params.files,
        toolCalls: params.toolCalls,
        logEvents: params.logEvents,
        reasoning: params.reasoning,
      }),
    })
    if (res.status === 200) return "ok"
    if (res.status === 409) return "expired"
    return "error"
  } catch {
    return "error"
  }
}
