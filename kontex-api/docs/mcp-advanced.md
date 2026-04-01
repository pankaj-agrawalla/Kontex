# Kontex MCP Tools (Advanced)

## When to use MCP

The proxy + log watcher handle snapshots automatically. Use MCP when you want:

- **Named checkpoints** at specific semantic moments ("finished auth refactor", "before risky migration")
- **Explicit task structure** — parent/child tasks that map to your actual work breakdown
- **Agent-initiated rollback** — when an approach isn't working and the agent needs to restore a prior state

MCP is never required. It layers on top of what proxy + watcher already capture automatically.

---

## Setup

Add to `~/.claude/mcp_servers.json`:

```json
{
  "kontex": {
    "url": "https://api.usekontex.com/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_KONTEX_API_KEY"
    }
  }
}
```

For local development, use `http://localhost:3000/mcp` as the URL.

---

## CLAUDE.md snippet

Paste this into your project's `CLAUDE.md` to instruct the agent:

```
Kontex MCP tools are available for session state management:
- Call kontex_session_start at the beginning of a new working session
- Call kontex_task_start when beginning a discrete unit of work
- Call kontex_snapshot after completing meaningful steps
- Call kontex_rollback if the current approach is failing and you need to restore a prior state
- Call kontex_task_done when a task completes or fails
Always provide descriptive labels to kontex_snapshot — they appear in the dashboard.
```

---

## Tool reference

| Tool | Inputs | Returns | When to call |
|---|---|---|---|
| `kontex_session_start` | `name`, `description?` | `{ session_id, message }` | Start of a new working session |
| `kontex_session_pause` | `session_id` | `{ success: true }` | Pausing work mid-session |
| `kontex_task_start` | `session_id`, `name`, `parent_task_id?` | `{ task_id, message }` | Beginning a discrete unit of work |
| `kontex_task_done` | `task_id`, `status` (`"completed"` \| `"failed"`) | `{ success: true }` | Task finishes or fails |
| `kontex_snapshot` | `task_id`, `label`, `files?`, `tool_calls?`, `messages?`, `reasoning?`, `model?` | `{ snapshot_id, token_total, message }` | After completing a meaningful step |
| `kontex_rollback` | `snapshot_id` | `{ snapshot_id, label, captured_at, bundle, message }` | When reverting to a prior known-good state |

### kontex_snapshot — field details

| Field | Type | Description |
|---|---|---|
| `task_id` | `string` | Task this snapshot belongs to |
| `label` | `string` | Human-readable name — appears in the dashboard |
| `files` | `ContextFile[]` | Files open or relevant at this moment |
| `tool_calls` | `ToolCall[]` | Tool calls made up to this point |
| `messages` | `Message[]` | Conversation history |
| `reasoning` | `string` | Agent's reasoning at this checkpoint |
| `model` | `string` | Model ID in use |

### kontex_rollback — re-injection instructions

The rollback response includes a `bundle` with everything needed to resume:

1. Use `bundle.messages` as your conversation history
2. Re-open files listed in `bundle.files`
3. `bundle.toolCalls` shows what was done up to that point

---

## Using MCP with proxy (recommended)

Run both together for full coverage:

```
PROXY     → auto-snapshots every Anthropic API call (zero friction)
MCP       → named checkpoints at semantic moments (explicit control)
```

The proxy captures the raw context stream. MCP lets the agent mark specific moments as meaningful. Both write to the same snapshot store — you see everything in the dashboard timeline.

Example workflow:

```
agent calls kontex_session_start          → creates session
agent calls kontex_task_start             → creates task
... agent works, proxy auto-snapshots ...
agent calls kontex_snapshot("auth done")  → explicit checkpoint
... agent continues, more auto-snapshots ...
agent calls kontex_snapshot("before DB migration")
... something goes wrong ...
agent calls kontex_rollback(snapshot_id)  → restores to "before DB migration"
agent calls kontex_task_done(task_id, "failed")
```

---

## Verification checklist

- [ ] Connect Claude Code to MCP server at `http://localhost:3000/mcp`
- [ ] Call `kontex_session_start` → returns `session_id`
- [ ] Call `kontex_task_start` with that `session_id` → returns `task_id`
- [ ] Call `kontex_snapshot` with that `task_id` → returns `snapshot_id`, DB row has `source === "mcp"`
- [ ] Call `kontex_rollback` with that `snapshot_id` → returns full bundle with re-injection message
- [ ] All tool responses are clean strings — no stack traces, no internal error codes
