// Shared types for the frontend to import alongside AppRouter.
// The frontend never imports from src/ directly — only from here.

export type { Session, Task, Snapshot } from "@prisma/client"
export type { ContextBundle, Message, ToolCall } from "../types/bundle"
export type { KontexEvent } from "../lib/events"
export type { DiffResult }  from "../services/diff.service"
