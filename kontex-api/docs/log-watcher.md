# Kontex Log Watcher

## Why use the log watcher

The proxy captures the Anthropic API message stream — messages in, messages out. That's useful, but it misses what happened *inside* the agent: which files were read, what tool outputs looked like, and what the model was reasoning about before it responded.

The log watcher reads Claude Code's local session files and adds:

- **Full file contents** — not just paths, but the actual content the agent read, with token counts
- **Complete tool call inputs and outputs** — every tool invocation, paired with its result
- **Agent reasoning traces** — the extended thinking blocks Claude emits when reasoning is enabled

This makes snapshot rollback significantly more useful: you can restore an agent to a state that includes exactly what it knew, not just what it said.

---

## What it reads

Claude Code writes a JSONL file for every session:

```
~/.claude/projects/{hash}/*.jsonl
```

Where `{hash}` is a deterministic hash of the project directory path. Each line is one JSON event — assistant turns, user turns, tool uses, tool results — written automatically as the session progresses.

The log watcher tails these files in real time using `chokidar`, reading only new bytes since the last position. It parses each line and buffers the events until a new proxy snapshot is detected, then sends the enrichment in a single `POST /v1/snapshots/:id/enrich` call.

---

## Setup

Run the watcher alongside your agent:

```bash
npx kontex-watch --api-key=YOUR_KEY --session-id=YOUR_SESSION_ID
```

Options:

| Flag | Required | Default | Description |
|---|---|---|---|
| `--api-key` | Yes | — | Your Kontex API key (`sk-kontex-...`) |
| `--session-id` | Yes | — | The session ID to enrich (`sess_...`) |
| `--api-url` | No | `https://api.usekontex.com` | Override API base URL |

For local development:

```bash
npx kontex-watch \
  --api-key=test_key_dev \
  --session-id=sess_xyz789 \
  --api-url=http://localhost:3000
```

Or via the npm script:

```bash
npm run watch -- --api-key=test_key_dev --session-id=sess_xyz789
```

---

## Running proxy + watcher together

Open two terminals side by side:

**Terminal 1 — your agent code** (with proxy `baseURL` set, see [quickstart.md](./quickstart.md)):

```bash
node my-agent.js
```

**Terminal 2 — the log watcher:**

```bash
npx kontex-watch \
  --api-key=sk-kontex-xxxxxxxxxxxxxxxx \
  --session-id=sess_xyz789
```

The watcher will print:

```
[kontex-watch] Watching ~/.claude/projects/ — enriching session sess_xyz789
[kontex-watch] Tracking new file: /Users/you/.claude/projects/abc123/session.jsonl
[kontex-watch] Enriched snapshot snap_abc (3 files, 7 tool calls)
```

---

## What gets enriched

| Data | Proxy (alone) | Proxy + Log Watcher |
|---|---|---|
| Message history | Full | Full |
| Tool call names | Yes (from response) | Yes |
| Tool call inputs | Yes (from response) | Yes |
| Tool call outputs | No | **Yes** |
| File paths read | No | **Yes** |
| File contents | No | **Yes** |
| File token counts | No | **Yes** |
| Agent reasoning | Partial (thinking blocks) | **Full traces** |
| Raw log events | No | **Yes** |

---

## Enrichment window

Enrichment must arrive within **60 seconds** of snapshot creation. This window exists to keep snapshots immutable — once sealed, a snapshot is never overwritten.

- If enrichment arrives within the window: `POST /v1/snapshots/:id/enrich` returns `200`, the bundle is updated, and `enriched: true` is set.
- If the window has passed: the endpoint returns `409 enrich_window_expired`. The watcher logs a warning and discards the buffered events — they will not be retried.

In practice, the watcher polls for new snapshots every 5 seconds and pushes enrichment immediately on detection, so the window is almost never a problem unless the watcher is stopped and restarted mid-session.

If you need a longer window, set `ENRICH_WINDOW_SECONDS` in your `.env`:

```bash
ENRICH_WINDOW_SECONDS=300  # 5 minutes
```
