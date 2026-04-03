export type Variables = { userId: string; apiKeyId: string };

export interface ApiError {
  error: string
  message: string
  details?: unknown
}

export type SnapshotSource = "proxy" | "log_watcher" | "mcp" | "openllmetry"
