import { useEffect } from "react"

const BASE = import.meta.env.VITE_KONTEX_API_URL ?? "http://localhost:3000"

export function useSessionFeed(sessionId, { onSnapshotCreated, onSnapshotEnriched, onSnapshotEmbedded } = {}) {
  useEffect(() => {
    if (!sessionId) return

    const key = localStorage.getItem("kontex_api_key") ?? ""
    // EventSource does not support custom headers natively —
    // use fetch with streaming reader instead
    const controller = new AbortController()

    async function connect() {
      try {
        const res = await fetch(`${BASE}/sse/session/${sessionId}/feed`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        })

        if (!res.ok) {
          console.error("[SSE] Failed to connect:", res.status)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const parts = buffer.split("\n\n")
          buffer = parts.pop() ?? ""

          for (const part of parts) {
            const dataLine = part.split("\n").find(l => l.startsWith("data:"))
            if (!dataLine) continue
            try {
              const event = JSON.parse(dataLine.slice(5).trim())
              if (event.type === "snapshot_created") onSnapshotCreated?.(event)
              if (event.type === "snapshot_enriched") onSnapshotEnriched?.(event)
              if (event.type === "snapshot_embedded") onSnapshotEmbedded?.(event)
            } catch {
              // malformed event — skip
            }
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("[SSE] Connection error:", err)
        }
      }
    }

    connect()
    return () => controller.abort()
  }, [sessionId])
}
