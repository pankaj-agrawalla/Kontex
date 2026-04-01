import { ContextBundle, ContextFile, ToolCall, Message } from "../types/bundle"

export interface DiffResult {
  added: {
    files: ContextFile[]
    toolCalls: ToolCall[]
    messages: Message[]
  }
  removed: {
    files: ContextFile[]
    toolCalls: ToolCall[]
    messages: Message[]
  }
  tokenDelta: number
}

export function diffBundles(bundleA: ContextBundle, bundleB: ContextBundle): DiffResult {
  // Files: compare by path
  const filePathsA = new Set(bundleA.files.map(f => f.path))
  const filePathsB = new Set(bundleB.files.map(f => f.path))

  const addedFiles = bundleB.files.filter(f => !filePathsA.has(f.path))
  const removedFiles = bundleA.files.filter(f => !filePathsB.has(f.path))

  // Tool calls: compare by timestamp
  // All calls in B after the latest timestamp in A are considered added
  const latestATimestamp = bundleA.toolCalls.reduce<string | null>((max, tc) => {
    if (max === null) return tc.timestamp
    return tc.timestamp > max ? tc.timestamp : max
  }, null)

  const addedToolCalls = latestATimestamp === null
    ? bundleB.toolCalls
    : bundleB.toolCalls.filter(tc => tc.timestamp > latestATimestamp)

  // Tool calls in A after latest timestamp in B are considered removed
  const latestBTimestamp = bundleB.toolCalls.reduce<string | null>((max, tc) => {
    if (max === null) return tc.timestamp
    return tc.timestamp > max ? tc.timestamp : max
  }, null)

  const removedToolCalls = latestBTimestamp === null
    ? bundleA.toolCalls
    : bundleA.toolCalls.filter(tc => tc.timestamp > latestBTimestamp)

  // Messages: compare by array index
  const addedMessages = bundleB.messages.slice(bundleA.messages.length)
  const removedMessages = bundleA.messages.slice(bundleB.messages.length)

  // tokenDelta: B - A
  const tokenDelta = bundleB.tokenTotal - bundleA.tokenTotal

  return {
    added: {
      files: addedFiles,
      toolCalls: addedToolCalls,
      messages: addedMessages,
    },
    removed: {
      files: removedFiles,
      toolCalls: removedToolCalls,
      messages: removedMessages,
    },
    tokenDelta,
  }
}
