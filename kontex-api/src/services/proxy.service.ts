import { config } from "../config"
import { ContextBundle, ToolCall, Message } from "../types/bundle"

export interface ProxyOptions {
  sessionId: string
  userId: string
  trigger: "every_n_turns" | "on_tool_end" | "token_threshold"
  triggerN: number
}

interface AnthropicContentBlock {
  type: string
  tool_use_id?: string
  name?: string
  input?: unknown
  text?: string
  thinking?: string
}

interface AnthropicRequest {
  model: string
  messages: Array<{ role: string; content: string | unknown[] }>
  [key: string]: unknown
}

interface AnthropicResponse {
  content: AnthropicContentBlock[]
  usage: { input_tokens: number; output_tokens: number }
  model?: string
  [key: string]: unknown
}

export function extractBundleFromProxy(
  requestBody: unknown,
  responseBody: unknown
): Omit<ContextBundle, "snapshotId" | "taskId" | "sessionId" | "capturedAt"> {
  const req = requestBody as AnthropicRequest
  const res = responseBody as AnthropicResponse

  const messages: Message[] = (req.messages ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }))

  const toolCalls: ToolCall[] = (res.content ?? [])
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      tool: block.name ?? "",
      input: block.input ?? {},
      output: null,
      status: "success" as const,
      timestamp: new Date().toISOString(),
    }))

  const reasoningParts = (res.content ?? [])
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking ?? "")
  const reasoning = reasoningParts.length > 0 ? reasoningParts.join("\n") : undefined

  const usage = res.usage ?? { input_tokens: 0, output_tokens: 0 }
  const tokenTotal = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)

  return {
    model: req.model ?? "",
    tokenTotal,
    source: "proxy",
    enriched: false,
    files: [],
    toolCalls,
    messages,
    reasoning,
    logEvents: [],
  }
}

export function shouldSnapshot(
  requestBody: unknown,
  responseBody: unknown,
  options: ProxyOptions
): boolean {
  if (!options.sessionId) return false

  const req = requestBody as AnthropicRequest
  const res = responseBody as AnthropicResponse

  if (options.trigger === "every_n_turns") {
    const assistantCount = (req.messages ?? []).filter(
      (m) => m.role === "assistant"
    ).length
    if (assistantCount === 0) return false
    return assistantCount % options.triggerN === 0
  }

  if (options.trigger === "on_tool_end") {
    return (res.content ?? []).some((block) => block.type === "tool_use")
  }

  if (options.trigger === "token_threshold") {
    const usage = res.usage ?? { input_tokens: 0, output_tokens: 0 }
    const tokenTotal = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
    return tokenTotal >= options.triggerN
  }

  return false
}

export async function forwardToAnthropic(
  requestBody: unknown,
  anthropicApiKey: string
): Promise<{ responseBody: unknown; status: number; headers: Record<string, string> }> {
  const res = await fetch(`${config.ANTHROPIC_API_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anthropicApiKey}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(requestBody),
  })
  const responseBody = await res.json()
  const headers: Record<string, string> = {}
  res.headers.forEach((val: string, key: string) => {
    headers[key] = val
  })
  return { responseBody, status: res.status, headers }
}
