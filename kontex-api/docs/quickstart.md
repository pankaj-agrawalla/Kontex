# Kontex Quickstart

## What you get

Kontex automatically captures your agent's full context — messages, tool calls, reasoning, and file reads — as it runs. Every snapshot is a complete, restorable checkpoint of your agent's state.

- **Time-travel:** inspect what your agent knew and did at any point in the conversation
- **Rollback:** restore any past snapshot and resume from there
- **Zero code change:** point one line at the proxy and add two headers — that's it

---

## Step 1: Create an account and get your API key

```bash
curl -X POST https://api.usekontex.com/v1/keys \
  -H "Content-Type: application/json" \
  -d '{ "label": "my-agent" }'
```

Response:

```json
{
  "id": "key_abc123",
  "key": "sk-kontex-xxxxxxxxxxxxxxxx",
  "label": "my-agent",
  "createdAt": "2025-01-15T10:00:00.000Z"
}
```

Save the `key` value — you'll use it as `X-Kontex-Api-Key` in every request.

---

## Step 2: Create a session

A session groups all the tasks and snapshots for one agent run (or project).

```bash
curl -X POST https://api.usekontex.com/v1/sessions \
  -H "Authorization: Bearer sk-kontex-xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{ "name": "my-coding-agent" }'
```

Response:

```json
{
  "id": "sess_xyz789",
  "name": "my-coding-agent",
  "status": "ACTIVE",
  "createdAt": "2025-01-15T10:01:00.000Z"
}
```

Save the `id` — you'll pass this as `X-Kontex-Session-Id` so Kontex knows which session to attach snapshots to.

---

## Step 3: Point your agent at the Kontex proxy

Change one line. Add two headers. Your Anthropic API key stays in the `Authorization` header exactly as before — Kontex forwards it transparently.

### Node.js (Anthropic SDK)

**Before:**
```js
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()
```

**After:**
```js
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  baseURL: "https://proxy.usekontex.com",
  defaultHeaders: {
    "X-Kontex-Api-Key": "sk-kontex-xxxxxxxxxxxxxxxx",
    "X-Kontex-Session-Id": "sess_xyz789",
  },
})
```

### Python (Anthropic SDK)

**Before:**
```python
import anthropic

client = anthropic.Anthropic()
```

**After:**
```python
import anthropic

client = anthropic.Anthropic(
    base_url="https://proxy.usekontex.com",
    default_headers={
        "X-Kontex-Api-Key": "sk-kontex-xxxxxxxxxxxxxxxx",
        "X-Kontex-Session-Id": "sess_xyz789",
    },
)
```

### curl

**Before:**
```bash
curl https://api.anthropic.com/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{ "model": "claude-opus-4-5", "max_tokens": 1024, "messages": [...] }'
```

**After:**
```bash
curl https://proxy.usekontex.com/proxy/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -H "X-Kontex-Api-Key: sk-kontex-xxxxxxxxxxxxxxxx" \
  -H "X-Kontex-Session-Id: sess_xyz789" \
  -d '{ "model": "claude-opus-4-5", "max_tokens": 1024, "messages": [...] }'
```

---

## Step 4: Run your agent

That's it. Run your agent normally. Kontex intercepts responses as they pass through the proxy and creates snapshots asynchronously — it never adds latency to your Anthropic calls.

By default, a snapshot is created every **5 assistant turns**. You can change this with the `X-Kontex-Snapshot-Trigger` header (see [Configuring snapshot triggers](#configuring-snapshot-triggers) below).

---

## Step 5: View snapshots in the dashboard

Open [https://app.usekontex.com](https://app.usekontex.com) and navigate to your session. You'll see:

- A **timeline** of all snapshots with timestamps and token counts
- The full **message history** at each checkpoint
- **Tool calls** made by the agent at each point
- **Diff view** between any two snapshots
- A **Restore** button to create a new session branching from any snapshot

---

## Configuring snapshot triggers

Pass `X-Kontex-Snapshot-Trigger` and `X-Kontex-Snapshot-N` headers to control when snapshots fire.

| Trigger | Header value | `X-Kontex-Snapshot-N` | When a snapshot fires |
|---|---|---|---|
| Every N turns (default) | `every_n_turns` | Number of turns (default: `5`) | After every Nth assistant message |
| On tool end | `on_tool_end` | _(ignored)_ | Whenever the agent uses a tool |
| Token threshold | `token_threshold` | Token count (e.g. `4096`) | When total tokens in the request/response reaches N |

**Example — snapshot on every tool call:**
```bash
-H "X-Kontex-Snapshot-Trigger: on_tool_end"
```

**Example — snapshot every 10 turns:**
```bash
-H "X-Kontex-Snapshot-Trigger: every_n_turns" \
-H "X-Kontex-Snapshot-N: 10"
```

**Example — snapshot when context exceeds 8k tokens:**
```bash
-H "X-Kontex-Snapshot-Trigger: token_threshold" \
-H "X-Kontex-Snapshot-N: 8192"
```

---

## Next: Enriching snapshots with the log watcher

Proxy snapshots capture messages and tool calls from the Anthropic API. The **log watcher** goes further — it reads Claude Code's local JSONL logs and enriches your snapshots with file reads, detailed reasoning traces, and raw log events.

To enable enrichment, run the watcher alongside your agent:

```bash
npx kontex-watch --session sess_xyz789 --api-key sk-kontex-xxxxxxxxxxxxxxxx
```

See [docs/log-watcher.md](./log-watcher.md) for the full setup guide.
