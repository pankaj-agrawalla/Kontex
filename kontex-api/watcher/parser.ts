import { createHash } from "crypto"
import { get_encoding } from "tiktoken"
import { ContextFile, ToolCall } from "../src/types/bundle"

export interface ParsedToolUse {
  type: "tool_use"
  id: string
  tool: string
  input: unknown
  timestamp: string
}

export interface ParsedToolResult {
  type: "tool_result"
  toolUseId: string
  tool: string
  output: string
  timestamp: string
}

export interface ParsedAssistantTurn {
  type: "assistant"
  thinking?: string
  text?: string
  toolUses: ParsedToolUse[]
  timestamp: string
}

export interface ParsedUserTurn {
  type: "user"
  text: string
  timestamp: string
}

export type ParsedEvent =
  | ParsedToolUse
  | ParsedToolResult
  | ParsedAssistantTurn
  | ParsedUserTurn
  | { type: "unknown"; raw: unknown }

// Claude Code JSONL content block shapes
interface ContentBlockText {
  type: "text"
  text: string
}

interface ContentBlockThinking {
  type: "thinking"
  thinking: string
}

interface ContentBlockToolUse {
  type: "tool_use"
  id: string
  name: string
  input: unknown
}

interface ContentBlockToolResult {
  type: "tool_result"
  tool_use_id: string
  content: string | Array<{ type: string; text?: string }>
}

type ContentBlock =
  | ContentBlockText
  | ContentBlockThinking
  | ContentBlockToolUse
  | ContentBlockToolResult
  | { type: string; [key: string]: unknown }

interface ClaudeCodeEvent {
  type?: string
  timestamp?: string
  message?: {
    role?: string
    content?: ContentBlock[] | string
  }
  // tool_use / tool_result may appear at the top level in some formats
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | ContentBlock[]
}

export function parseLine(line: string): ParsedEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return null
  }

  const event = raw as ClaudeCodeEvent
  const timestamp = event.timestamp ?? new Date().toISOString()

  // Assistant message with content array
  if (event.type === "assistant" && event.message?.content) {
    const blocks = Array.isArray(event.message.content) ? event.message.content : []
    const thinkingParts: string[] = []
    const textParts: string[] = []
    const toolUses: ParsedToolUse[] = []

    for (const block of blocks) {
      if (block.type === "thinking") {
        thinkingParts.push((block as ContentBlockThinking).thinking)
      } else if (block.type === "text") {
        textParts.push((block as ContentBlockText).text)
      } else if (block.type === "tool_use") {
        const tu = block as ContentBlockToolUse
        toolUses.push({
          type: "tool_use",
          id: tu.id,
          tool: tu.name,
          input: tu.input,
          timestamp,
        })
      }
    }

    return {
      type: "assistant",
      thinking: thinkingParts.length > 0 ? thinkingParts.join("\n\n") : undefined,
      text: textParts.length > 0 ? textParts.join("\n") : undefined,
      toolUses,
      timestamp,
    }
  }

  // User message with content array
  if (event.type === "user" && event.message?.content) {
    const blocks = Array.isArray(event.message.content) ? event.message.content : []
    const textParts: string[] = []
    const toolResults: ParsedToolResult[] = []

    for (const block of blocks) {
      if (block.type === "text") {
        textParts.push((block as ContentBlockText).text)
      } else if (block.type === "tool_result") {
        const tr = block as ContentBlockToolResult
        const output =
          typeof tr.content === "string"
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content
                  .filter((b) => b.type === "text")
                  .map((b) => (b as ContentBlockText).text)
                  .join("\n")
              : ""
        toolResults.push({
          type: "tool_result",
          toolUseId: tr.tool_use_id,
          tool: "",  // filled by extractToolCallsFromEvents by joining with tool_use
          output,
          timestamp,
        })
      }
    }

    // If only tool results and no text, surface as individual tool_result events
    if (toolResults.length > 0 && textParts.length === 0) {
      // Return the first one; caller should iterate parseLine per line so this
      // is always a single event. Wrap in unknown so the caller processes each line independently.
      // Instead: return a synthetic user turn with text from tool results embedded
    }

    const text = textParts.join("\n")
    if (text || toolResults.length === 0) {
      return { type: "user", text, timestamp }
    }

    // Pure tool result user turn — emit as unknown so extractToolCallsFromEvents
    // can pick up tool results from the raw event bag
    return { type: "unknown", raw }
  }

  // Top-level tool_use event
  if (event.type === "tool_use" && event.id && event.name) {
    return {
      type: "tool_use",
      id: event.id,
      tool: event.name,
      input: event.input ?? {},
      timestamp,
    }
  }

  // Top-level tool_result event
  if (event.type === "tool_result" && event.tool_use_id) {
    const content = event.content
    const output =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((b) => (b as ContentBlock).type === "text")
              .map((b) => ((b as ContentBlockText).text ?? ""))
              .join("\n")
          : ""
    return {
      type: "tool_result",
      toolUseId: event.tool_use_id,
      tool: "",
      output,
      timestamp,
    }
  }

  return { type: "unknown", raw }
}

export function parseLines(lines: string[]): ParsedEvent[] {
  const events: ParsedEvent[] = []
  for (const line of lines) {
    // For user turns that contain tool_results, unpack them
    const raw = (() => {
      try { return JSON.parse(line.trim()) as ClaudeCodeEvent } catch { return null }
    })()

    if (
      raw &&
      raw.type === "user" &&
      raw.message?.content &&
      Array.isArray(raw.message.content)
    ) {
      const timestamp = raw.timestamp ?? new Date().toISOString()
      const blocks = raw.message.content as ContentBlock[]
      let hasText = false

      for (const block of blocks) {
        if (block.type === "tool_result") {
          const tr = block as ContentBlockToolResult
          const output =
            typeof tr.content === "string"
              ? tr.content
              : Array.isArray(tr.content)
                ? tr.content
                    .filter((b) => b.type === "text")
                    .map((b) => (b as ContentBlockText).text ?? "")
                    .join("\n")
                : ""
          events.push({
            type: "tool_result",
            toolUseId: tr.tool_use_id,
            tool: "",
            output,
            timestamp,
          })
        } else if (block.type === "text") {
          hasText = true
        }
      }

      if (hasText) {
        const parsed = parseLine(line)
        if (parsed) events.push(parsed)
      }
    } else {
      const parsed = parseLine(line)
      if (parsed) events.push(parsed)
    }
  }
  return events
}

export function extractFilesFromEvents(events: ParsedEvent[]): ContextFile[] {
  // Build a map of tool_use id → tool name + input for Read tool calls
  const toolUseMap = new Map<string, { tool: string; input: unknown }>()
  for (const event of events) {
    if (event.type === "tool_use") {
      toolUseMap.set(event.id, { tool: event.tool, input: event.input })
    }
    if (event.type === "assistant") {
      for (const tu of event.toolUses) {
        toolUseMap.set(tu.id, { tool: tu.tool, input: tu.input })
      }
    }
  }

  const enc = get_encoding("cl100k_base")
  const files: ContextFile[] = []
  const seenPaths = new Set<string>()

  for (const event of events) {
    if (event.type !== "tool_result") continue

    const use = toolUseMap.get(event.toolUseId)
    if (!use) continue

    const toolName = (use.tool ?? "").toLowerCase()
    if (toolName !== "read" && toolName !== "read_file") continue

    const input = use.input as Record<string, unknown>
    const path =
      (input?.path as string) ??
      (input?.file_path as string) ??
      (input?.filename as string) ??
      ""
    if (!path || seenPaths.has(path)) continue
    seenPaths.add(path)

    const content = event.output
    const contentHash = createHash("sha256").update(content).digest("hex")
    const tokenCount = enc.encode(content).length

    files.push({ path, content, contentHash, tokenCount })
  }

  enc.free()
  return files
}

export function extractToolCallsFromEvents(events: ParsedEvent[]): ToolCall[] {
  // Collect all tool_use events (from assistant turns and top-level)
  const toolUses: ParsedToolUse[] = []
  for (const event of events) {
    if (event.type === "tool_use") {
      toolUses.push(event)
    }
    if (event.type === "assistant") {
      toolUses.push(...event.toolUses)
    }
  }

  // Build map of toolUseId → output for tool_result events
  const resultMap = new Map<string, string>()
  for (const event of events) {
    if (event.type === "tool_result") {
      resultMap.set(event.toolUseId, event.output)
    }
  }

  return toolUses.map((tu) => {
    const output = resultMap.get(tu.id)
    return {
      tool: tu.tool,
      input: tu.input,
      output: output ?? null,
      status: output !== undefined ? "success" : ("error" as "success" | "error"),
      timestamp: tu.timestamp,
    }
  })
}

export function extractReasoningFromEvents(events: ParsedEvent[]): string | undefined {
  const parts: string[] = []
  for (const event of events) {
    if (event.type === "assistant" && event.thinking) {
      parts.push(event.thinking)
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined
}
