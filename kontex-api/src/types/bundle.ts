export interface ContextFile {
  path: string
  content?: string
  contentHash: string
  tokenCount: number
}

export interface ToolCall {
  tool: string
  input: unknown
  output: unknown
  status: "success" | "error"
  timestamp: string
}

export interface Message {
  role: "user" | "assistant"
  content: string | unknown[]
  timestamp?: string
}

export interface LogEvent {
  type: string
  timestamp: string
  data: unknown
}

export interface ContextBundle {
  snapshotId: string
  taskId: string
  sessionId: string
  capturedAt: string
  model: string
  tokenTotal: number
  source: "proxy" | "log_watcher" | "mcp"
  enriched: boolean
  files: ContextFile[]
  toolCalls: ToolCall[]
  messages: Message[]
  reasoning?: string
  logEvents: LogEvent[]
}
