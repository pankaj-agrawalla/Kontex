import { FlatSpan } from "../types/otel"
import { Message, ToolCall } from "../types/bundle"

const TRACELOOP = {
  SPAN_KIND: "traceloop.span.kind",
  WORKFLOW:  "traceloop.workflow.name",
  TASK:      "traceloop.task.name",
  AGENT:     "traceloop.agent.name",
  TOOL:      "traceloop.tool.name",
  ENTITY:    "traceloop.entity.name",
  INPUT:     "traceloop.entity.input",
  OUTPUT:    "traceloop.entity.output",
} as const

const LLM = {
  REQUEST_MODEL:     "llm.request.model",
  RESPONSE_MODEL:    "llm.response.model",
  PROMPT_TOKENS:     "llm.usage.prompt_tokens",
  COMPLETION_TOKENS: "llm.usage.completion_tokens",
  TOTAL_TOKENS:      "llm.usage.total_tokens",
  PROMPTS:           "llm.prompts",
  COMPLETIONS:       "llm.completions",
  TOOL_INPUT:        "llm.tool.input",
  TOOL_OUTPUT:       "llm.tool.output",
} as const

export type TraceloopSpanKind = "workflow" | "task" | "agent" | "tool" | "llm" | "unknown"

export interface MappedSpan {
  spanKind:     TraceloopSpanKind
  isLlmCall:    boolean
  model:        string
  tokenTotal:   number
  inputTokens:  number
  outputTokens: number
  messages:     Message[]
  toolCalls:    ToolCall[]
  workflowName: string | undefined
  taskName:     string | undefined
  agentName:    string | undefined
  toolName:     string | undefined
}

export function mapSpan(span: FlatSpan): MappedSpan {
  const a = span.attributes

  const rawKind  = String(a[TRACELOOP.SPAN_KIND] ?? "unknown").toLowerCase()
  const validKinds: TraceloopSpanKind[] = ["workflow", "task", "agent", "tool", "llm"]
  const spanKind = (validKinds.includes(rawKind as TraceloopSpanKind)
    ? rawKind : "unknown") as TraceloopSpanKind

  const isLlmCall    = spanKind === "llm"
  const model        = String(a[LLM.RESPONSE_MODEL] ?? a[LLM.REQUEST_MODEL] ?? "unknown")
  const inputTokens  = Number(a[LLM.PROMPT_TOKENS]    ?? 0)
  const outputTokens = Number(a[LLM.COMPLETION_TOKENS] ?? 0)
  const tokenTotal   = Number(a[LLM.TOTAL_TOKENS]      ?? inputTokens + outputTokens)

  // ── Parse input messages ──────────────────────────────────────────────────
  // OpenLLMetry emits one of two formats depending on SDK version:
  //   Format A — JSON string: llm.prompts = '[{"role":"user","content":"..."}]'
  //   Format B — indexed:     llm.prompts.0.role, llm.prompts.0.content, ...
  const messages: Message[] = []

  if (a[LLM.PROMPTS]) {
    try {
      const raw = JSON.parse(String(a[LLM.PROMPTS]))
      if (Array.isArray(raw)) {
        for (const m of raw) {
          messages.push({
            role:      m.role ?? "user",
            content:   m.content ?? m.text ?? "",
            timestamp: span.startTime.toISOString(),
          })
        }
      }
    } catch { /* fall through to indexed format */ }
  }

  if (messages.length === 0) {
    let i = 0
    while (a[`llm.prompts.${i}.role`] !== undefined) {
      const rawRole = String(a[`llm.prompts.${i}.role`])
      messages.push({
        role:      (rawRole === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content:   String(a[`llm.prompts.${i}.content`] ?? ""),
        timestamp: span.startTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse completions → append as assistant message(s) ───────────────────
  if (a[LLM.COMPLETIONS]) {
    try {
      const raw = JSON.parse(String(a[LLM.COMPLETIONS]))
      if (Array.isArray(raw)) {
        for (const c of raw) {
          let content = ""
          if (typeof c.text === "string") {
            content = c.text
          } else if (typeof c.message?.content === "string") {
            content = c.message.content
          } else if (Array.isArray(c.message?.content)) {
            content = c.message.content
              .map((b: { text?: string }) => b.text ?? "")
              .join("")
          } else if (typeof c.content === "string") {
            content = c.content
          }
          messages.push({ role: "assistant", content, timestamp: span.endTime.toISOString() })
        }
      }
    } catch { /* skip malformed completions */ }
  }

  if (!a[LLM.COMPLETIONS]) {
    let i = 0
    while (a[`llm.completions.${i}.content`] !== undefined) {
      messages.push({
        role:      "assistant",
        content:   String(a[`llm.completions.${i}.content`]),
        timestamp: span.endTime.toISOString(),
      })
      i++
    }
  }

  // ── Parse tool calls (spanKind === "tool") ────────────────────────────────
  const toolCalls: ToolCall[] = []
  if (spanKind === "tool") {
    const toolName  = String(a[TRACELOOP.TOOL] ?? a[TRACELOOP.ENTITY] ?? span.operationName)
    const inputStr  = String(a[LLM.TOOL_INPUT]  ?? a[TRACELOOP.INPUT]  ?? "{}")
    const outputStr = String(a[LLM.TOOL_OUTPUT] ?? a[TRACELOOP.OUTPUT] ?? "{}")
    let input: unknown  = {}
    let output: unknown = {}
    try { input  = JSON.parse(inputStr)  } catch { input  = inputStr  }
    try { output = JSON.parse(outputStr) } catch { output = outputStr }
    toolCalls.push({
      tool:      toolName,
      input,
      output,
      status:    a["error"] ? "error" : "success",
      timestamp: span.startTime.toISOString(),
    })
  }

  return {
    spanKind,
    isLlmCall,
    model,
    tokenTotal,
    inputTokens,
    outputTokens,
    messages,
    toolCalls,
    workflowName: a[TRACELOOP.WORKFLOW] !== undefined ? String(a[TRACELOOP.WORKFLOW]) : undefined,
    taskName:     a[TRACELOOP.TASK]     !== undefined ? String(a[TRACELOOP.TASK])     : undefined,
    agentName:    a[TRACELOOP.AGENT]    !== undefined ? String(a[TRACELOOP.AGENT])    : undefined,
    toolName:     a[TRACELOOP.TOOL]     !== undefined ? String(a[TRACELOOP.TOOL])     : undefined,
  }
}

// Human-readable Snapshot.label derived from the span.
export function buildLabel(span: FlatSpan, mapped: MappedSpan): string {
  if (mapped.workflowName) return `workflow: ${mapped.workflowName}`
  if (mapped.agentName)    return `agent: ${mapped.agentName}`
  if (mapped.taskName)     return `task: ${mapped.taskName}`
  if (mapped.toolName)     return `tool: ${mapped.toolName}`
  if (mapped.isLlmCall)    return `${mapped.model} · ${span.durationMs}ms`
  return span.operationName
}
