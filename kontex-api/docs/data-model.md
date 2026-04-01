# Kontex Data Model

## Core concepts

### Sessions

A **Session** is a named workspace that groups related agent work together. Think of it as a project or conversation thread. Sessions have a status: `ACTIVE` (work in progress), `PAUSED` (temporarily stopped), or `COMPLETED` (finished or soft-deleted).

Every API key belongs to a user, and every session belongs to that user. Sessions are the top-level container for everything else — tasks and their snapshots always live inside a session.

### Tasks

A **Task** represents a discrete unit of work within a session. Tasks form a tree: a task can have a parent task via `parentTaskId`, and a parent task can have many child tasks. This mirrors how agents often decompose large goals into subtasks.

Task statuses follow the lifecycle of the work: `PENDING` → `ACTIVE` → `COMPLETED` (or `FAILED`). The proxy and MCP tools drive status transitions.

### Snapshots

A **Snapshot** is an immutable checkpoint of everything an agent knew at a specific moment: the files it had read, the tools it had called, the messages in its context, and its reasoning. Each snapshot belongs to a task.

Snapshots are the core unit of Kontex. They are what get indexed for search, compared for diffs, and restored for rollbacks.

---

## ContextBundle structure

The full content of a snapshot is stored in Cloudflare R2 as a JSON blob called a **ContextBundle**. The database only stores metadata (token count, source, timestamps). The bundle holds everything else.

| Field | Type | Meaning |
|---|---|---|
| `snapshotId` | string | Matches the database snapshot ID |
| `taskId` | string | The task this snapshot belongs to |
| `sessionId` | string | The session this snapshot belongs to |
| `capturedAt` | ISO string | When the snapshot was taken |
| `model` | string | The Claude model in use (e.g. `claude-opus-4-6`) |
| `tokenTotal` | number | Total tokens in this context window |
| `source` | string | How this snapshot was created — see Source values below |
| `enriched` | boolean | Whether the log watcher has added file/tool data |
| `files` | array | Files the agent had read at capture time |
| `toolCalls` | array | Tools the agent called, with inputs, outputs, and status |
| `messages` | array | The full message history (user + assistant turns) |
| `reasoning` | string? | Extended thinking content, if the model produced it |
| `logEvents` | array | Raw log watcher events appended during enrichment |

### files[]

Each file entry records a file the agent had read:

```json
{
  "path": "src/services/snapshot.service.ts",
  "content": "...",
  "contentHash": "sha256...",
  "tokenCount": 412
}
```

`content` may be omitted for large files where only the hash is stored.

### toolCalls[]

Each tool call records what the agent did and what happened:

```json
{
  "tool": "Read",
  "input": { "file_path": "/src/index.ts" },
  "output": "...",
  "status": "success",
  "timestamp": "2026-04-01T10:23:45.000Z"
}
```

### messages[]

The full conversation history at the time of capture:

```json
{
  "role": "user",
  "content": "Fix the auth bug",
  "timestamp": "2026-04-01T10:20:00.000Z"
}
```

---

## The enrichment window

When the HTTP proxy captures a snapshot, it knows about messages but not about which files the agent read or tools it used — that information lives in the Claude Code logs on disk.

The **log watcher** (`npx kontex-watch`) reads those JSONL logs and pushes enrichment data to the snapshot within **60 seconds** of snapshot creation. This window is configurable via `ENRICH_WINDOW_SECONDS`.

After the window closes, the snapshot is **sealed** — no further enrichment is accepted (the API returns 409 `enrich_window_expired`). This prevents retroactive modification of the historical record.

The `enriched` field on a snapshot is `false` until enrichment arrives. It flips to `true` when the bundle is updated with file and tool data. Snapshots created via the MCP tools skip this process and are considered complete at creation time.

---

## The immutability invariant

**Snapshots are never modified or deleted after the enrichment window closes.**

This is the central design constraint of Kontex. The timeline always grows forward. Rollback does not rewind history — it creates a new snapshot whose bundle is a copy of the target snapshot's bundle, with a fresh `snapshotId` and `capturedAt`. The label is prefixed with `"Rollback to: "` to indicate its origin.

Why: if snapshots could be deleted or mutated, the audit trail would be unreliable. The whole point of Kontex is that you can always inspect what the agent knew at any point in the past. Mutation would break that guarantee.

---

## Source field values

The `source` field on a snapshot and bundle records which write path created it:

| Value | Write path | When it appears |
|---|---|---|
| `proxy` | HTTP Proxy | Developer routes their Anthropic calls through Kontex. The proxy intercepts the response and auto-snapshots in the background. Zero friction — requires only a `baseURL` change and two headers. |
| `log_watcher` | Log Watcher | The `npx kontex-watch` process reads Claude Code's JSONL logs and creates or enriches snapshots. Used as a secondary path that adds file read and tool call data to proxy snapshots. |
| `mcp` | MCP Tools | The developer explicitly calls the `kontex_checkpoint` MCP tool to create a named snapshot. Used for deliberate, semantically meaningful checkpoints. Never required — always optional. |

Rollback snapshots inherit the `source` of the snapshot they were restored from.
