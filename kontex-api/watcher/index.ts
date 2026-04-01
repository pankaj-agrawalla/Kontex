#!/usr/bin/env node
import { startWatcher } from "./tail"
import { pushEnrichment } from "./push"
import {
  parseLines,
  extractFilesFromEvents,
  extractToolCallsFromEvents,
  extractReasoningFromEvents,
  ParsedEvent,
} from "./parser"
import { LogEvent } from "../src/types/bundle"

// --- CLI argument parsing ---

function parseArgs(): { apiKey: string; sessionId: string; apiUrl: string } {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : undefined
  }

  const apiKey = get("--api-key")
  const sessionId = get("--session-id")
  const apiUrl = get("--api-url") ?? "http://localhost:3000"

  if (!apiKey || !sessionId) {
    console.error("Usage: kontex-watch --api-key <key> --session-id <id> [--api-url <url>]")
    console.error("")
    console.error("  --api-key     Your Kontex API key")
    console.error("  --session-id  The session ID to enrich")
    console.error("  --api-url     Kontex API base URL (default: http://localhost:3000)")
    process.exit(1)
  }

  return { apiKey, sessionId, apiUrl }
}

// --- Main ---

async function main(): Promise<void> {
  const { apiKey, sessionId, apiUrl } = parseArgs()

  console.log(`[kontex-watch] Watching ~/.claude/projects/ — enriching session ${sessionId}`)

  // Buffer of raw lines per file path
  const fileBuffers = new Map<string, string[]>()
  // Aggregated events across all files
  const allEvents: ParsedEvent[] = []

  startWatcher({
    onNewFile: (filePath: string) => {
      console.log(`[kontex-watch] Tracking new file: ${filePath}`)
      fileBuffers.set(filePath, [])
    },
    onEvent: (event: ParsedEvent, _filePath: string) => {
      allEvents.push(event)
    },
  })

  // Track the last known snapshot id so we only enrich on new ones
  let lastSnapshotId: string | null = null
  // Pending retry: events captured but not yet successfully pushed
  let retryEvents: ParsedEvent[] = []

  async function pollAndEnrich(): Promise<void> {
    try {
      const res = await fetch(`${apiUrl}/v1/sessions/${sessionId}/snapshots?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!res.ok) return

      const body = await res.json() as { data: Array<{ id: string }> }
      const latest = body.data?.[0]
      if (!latest || latest.id === lastSnapshotId) return

      const snapshotId = latest.id
      lastSnapshotId = snapshotId

      // Merge retried events + newly accumulated events
      const eventsToSend = [...retryEvents, ...allEvents]
      allEvents.length = 0  // clear accumulated buffer

      const files = extractFilesFromEvents(eventsToSend)
      const toolCalls = extractToolCallsFromEvents(eventsToSend)
      const reasoning = extractReasoningFromEvents(eventsToSend)
      const logEvents: LogEvent[] = eventsToSend
        .filter((e) => e.type !== "unknown")
        .map((e) => ({
          type: e.type,
          timestamp:
            "timestamp" in e && typeof e.timestamp === "string"
              ? e.timestamp
              : new Date().toISOString(),
          data: e,
        }))

      const result = await pushEnrichment({
        snapshotId,
        apiKey,
        apiUrl,
        files,
        toolCalls,
        logEvents,
        reasoning,
      })

      if (result === "ok") {
        console.log(`[kontex-watch] Enriched snapshot ${snapshotId} (${files.length} files, ${toolCalls.length} tool calls)`)
        retryEvents = []
      } else if (result === "expired") {
        console.warn(`[kontex-watch] Enrichment window expired for snapshot ${snapshotId} — discarding`)
        retryEvents = []
      } else {
        console.error(`[kontex-watch] Push failed for snapshot ${snapshotId} — will retry`)
        retryEvents = eventsToSend  // retain for next poll
      }
    } catch (err) {
      console.error("[kontex-watch] Poll error:", err)
    }
  }

  // Poll every 5 seconds
  setInterval(() => { pollAndEnrich() }, 5000)

  // Initial poll after a short delay so the watcher can scan existing files
  setTimeout(() => { pollAndEnrich() }, 2000)
}

main().catch((err: unknown) => {
  console.error("[kontex-watch] Fatal error:", err)
  process.exit(1)
})
