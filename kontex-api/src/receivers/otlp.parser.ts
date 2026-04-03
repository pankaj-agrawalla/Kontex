import { OtlpTracesPayload, FlatSpan, extractAttributes, nanoToDate } from "../types/otel"

export function parseOtlpPayload(body: unknown): FlatSpan[] {
  if (!body || typeof body !== "object") return []
  const payload = body as OtlpTracesPayload
  if (!Array.isArray(payload.resourceSpans)) return []

  const spans: FlatSpan[] = []

  for (const resourceSpan of payload.resourceSpans) {
    const resourceAttrs = extractAttributes(resourceSpan.resource?.attributes)
    const serviceName = String(resourceAttrs["service.name"] ?? "unknown-service")

    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const rawSpan of scopeSpan.spans ?? []) {
        try {
          const attrs     = extractAttributes(rawSpan.attributes)
          const startTime = nanoToDate(rawSpan.startTimeUnixNano)
          const endTime   = nanoToDate(rawSpan.endTimeUnixNano)
          spans.push({
            traceId:       rawSpan.traceId,
            spanId:        rawSpan.spanId,
            parentSpanId:  rawSpan.parentSpanId || undefined,
            operationName: rawSpan.name,
            serviceName,
            spanKind:      String(attrs["traceloop.span.kind"] ?? "unknown"),
            startTime,
            endTime,
            durationMs:    endTime.getTime() - startTime.getTime(),
            attributes:    attrs,
          })
        } catch (err) {
          console.warn("[otlp-parser] Skipping malformed span:", (err as Error).message)
        }
      }
    }
  }

  return spans
}
