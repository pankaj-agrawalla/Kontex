export interface OtlpAttributeValue {
  stringValue?: string
  intValue?: string        // int64 encoded as string in OTLP spec
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: { values: OtlpAttributeValue[] }
}

export interface OtlpAttribute {
  key: string
  value: OtlpAttributeValue
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind?: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OtlpAttribute[]
  events?: Array<{
    timeUnixNano: string
    name: string
    attributes?: OtlpAttribute[]
  }>
  status?: { code: number; message?: string }
}

export interface OtlpTracesPayload {
  resourceSpans: Array<{
    resource?: { attributes?: OtlpAttribute[] }
    scopeSpans: Array<{
      scope?: { name?: string; version?: string }
      spans: OtlpSpan[]
    }>
  }>
}

// Flattened span after parsing — what span.mapper and span.processor receive.
export interface FlatSpan {
  traceId: string
  spanId: string
  parentSpanId: string | undefined
  operationName: string
  serviceName: string
  spanKind: string
  startTime: Date
  endTime: Date
  durationMs: number
  attributes: Record<string, string | number | boolean>
}

// Flatten OtlpAttribute[] to a plain key-value Record.
// Handles string, int (parsed), double, bool. Skips arrayValue.
export function extractAttributes(
  attrs: OtlpAttribute[] | undefined
): Record<string, string | number | boolean> {
  if (!attrs) return {}
  const result: Record<string, string | number | boolean> = {}
  for (const attr of attrs) {
    const v = attr.value
    if (v.stringValue !== undefined)      result[attr.key] = v.stringValue
    else if (v.intValue !== undefined)    result[attr.key] = parseInt(v.intValue, 10)
    else if (v.doubleValue !== undefined) result[attr.key] = v.doubleValue
    else if (v.boolValue !== undefined)   result[attr.key] = v.boolValue
  }
  return result
}

// Convert nanosecond timestamp string to Date.
// Uses BigInt — nanosecond values overflow Number precision.
export function nanoToDate(nanoStr: string): Date {
  return new Date(Number(BigInt(nanoStr) / 1_000_000n))
}
