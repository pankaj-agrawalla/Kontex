# Kontex

**Task-state persistence engine for agentic workflows.**

Kontex captures, stores, and restores the full context of AI agent runs — messages, tool calls, file reads, and reasoning — as immutable snapshots. It is a state machine with an audit trail, not a memory store or chat logger.

---

## Core Concepts

- **Snapshot** — an immutable checkpoint of an agent's complete context at a point in time
- **Session** — a named container grouping related tasks (e.g. one agent run or project)
- **Task** — a unit of work within a session; tasks form a tree via parent/child relationships
- **ContextBundle** — the full payload of a snapshot: messages, tool calls, files, reasoning, log events
- **Rollback** — restoring from a prior snapshot by creating a new forward snapshot; history is never deleted or mutated

---

## Architecture

```
Capture paths
─────────────────────────────────────────────────────────
OpenLLMetry SDK   →  POST /ingest/v1/traces   ← PRIMARY
HTTP Proxy        →  POST /proxy/v1/messages  ← FALLBACK
MCP write tools   →  POST /mcp               ← ADVANCED

                          ↓
                   span.processor.ts
                   (OTLP → ContextBundle)
                          ↓
              PostgreSQL · R2 · Qdrant · Redis

Serve paths
─────────────────────────────────────────────────────────
REST  /v1/*         External contracts, CLIs, third-party
tRPC  /trpc/*       Dashboard frontend (type-safe)
SSE   /sse/*        Dashboard live feed (real-time push)
MCP   /mcp          Agent write + read tools
```

**Async pipeline:** Ingest returns 200 immediately. Span processing, R2 bundle writes, and Qdrant embedding all happen asynchronously via Redis queues and background workers.

**Immutability invariant:** Snapshots are sealed after creation. Rollback creates a new snapshot — it never overwrites or deletes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API Framework | Hono + @hono/node-server |
| Language | TypeScript (strict) |
| ORM | Prisma |
| Database | PostgreSQL (Railway) |
| Object Storage | Cloudflare R2 (S3-compatible) |
| Cache / Queue | Redis (Railway) |
| Vector Store | Qdrant Cloud |
| Embeddings | Voyage AI `voyage-code-3` |
| RPC (dashboard) | tRPC v11 + @hono/trpc-server |
| Real-time | Server-Sent Events over Redis pub/sub |
| Validation | Zod (every request body) |
| Token counting | tiktoken |
| Tracing ingest | OpenTelemetry OTLP/HTTP (JSON) |
| MCP | @modelcontextprotocol/sdk |

---

## Monorepo Structure

```
kontex/
├── kontex-api/          Backend API (Hono, Prisma, workers)
│   ├── src/
│   │   ├── routes/      REST endpoints
│   │   ├── trpc/        tRPC router + procedures
│   │   ├── services/    Business logic (pure functions)
│   │   ├── workers/     embed.worker, span.worker
│   │   ├── receivers/   OTLP parser + span mapper/processor
│   │   ├── mcp/         MCP server + 9 tools
│   │   └── middleware/  auth, logger, ratelimit
│   ├── prisma/          Schema + migrations
│   ├── watcher/         (Retired log watcher — do not run)
│   ├── tests/
│   └── docs/            quickstart, mcp-advanced, data-model, openllmetry-quickstart
└── kontex-dashboard/    React dashboard (Vite + Tailwind)
```

---

## API Surface

```
# API Key management
POST   /v1/keys
GET    /v1/keys
DELETE /v1/keys/:id

# Sessions
POST/GET/PATCH/DELETE /v1/sessions
POST   /v1/sessions/:id/link-trace

# Tasks
POST/GET /v1/sessions/:id/tasks
GET/PATCH /v1/tasks/:id

# Snapshots
POST   /v1/tasks/:id/snapshots
GET    /v1/sessions/:id/snapshots
GET    /v1/snapshots/:id
GET    /v1/snapshots/:id/bundle
POST   /v1/snapshots/:id/rollback
POST   /v1/snapshots/:id/enrich

# Dashboard
GET    /v1/sessions/:id/graph
GET    /v1/sessions/:id/diff?from=&to=
GET    /v1/sessions/:id/snapshots/timeline
GET    /v1/usage
GET    /v1/search?q=

# Capture paths
POST   /ingest/v1/traces           OpenLLMetry OTLP (PRIMARY)
POST   /proxy/v1/messages          Anthropic-compatible proxy (FALLBACK)
POST   /mcp                        MCP tools (ADVANCED)

# Real-time
GET    /sse/session/:id/feed        Server-Sent Events stream

# tRPC (dashboard frontend only)
POST   /trpc/sessions.*
POST   /trpc/snapshots.*
POST   /trpc/dashboard.*

# System
GET    /health
```

---

## Protocols

| Protocol | Endpoint | Auth Header | Purpose |
|---|---|---|---|
| OTLP/HTTP JSON | `POST /ingest/v1/traces` | `X-Kontex-Api-Key` | OpenLLMetry span ingest |
| REST/JSON | `/v1/*` | `Authorization: Bearer` | External API |
| tRPC | `/trpc/*` | `Authorization: Bearer` | Dashboard frontend |
| SSE | `/sse/session/:id/feed` | `Authorization: Bearer` | Live event stream |
| MCP (JSON-RPC 2.0) | `POST /mcp` | Bearer or `X-Kontex-Api-Key` | Agent tools |
| S3 (R2) | internal | env credentials | Bundle storage |
| Redis pub/sub | internal | env credentials | SSE event fanout |

---

## Quickstart (Proxy Path — zero code change)

```bash
# 1. Get an API key
curl -X POST https://api.usekontex.com/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"label": "my-agent"}'

# 2. Point your SDK at the Kontex proxy and add two headers
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic({
  baseURL: "https://api.usekontex.com/proxy",
  defaultHeaders: {
    "X-Kontex-Api-Key": "kontex_...",
    "X-Kontex-Session-Id": "session_..."
  }
})

# All Anthropic calls now auto-snapshot — no other changes needed
```

See `kontex-api/docs/quickstart.md` for the full guide and `docs/openllmetry-quickstart.md` for OpenLLMetry SDK integration.

---

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis
- Cloudflare R2 bucket (or S3-compatible)
- Qdrant Cloud instance (optional — search degrades gracefully without it)

### Setup

```bash
cd kontex-api
cp .env.example .env
# Fill in DATABASE_URL, REDIS_URL, R2_*, QDRANT_*, VOYAGE_API_KEY, API_KEY_SECRET

npm install
npx prisma migrate deploy

# Run all three processes in separate terminals:
npm run dev           # API server (port 3000)
npm run worker        # Embed worker (Qdrant indexing)
npm run span-worker   # Span processing worker (OTLP → snapshots)
```

### Environment Variables

```bash
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/kontex
REDIS_URL=redis://localhost:6379
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=kontex-bundles
R2_ENDPOINT=https://{account_id}.r2.cloudflarestorage.com
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION=kontex_snapshots
VOYAGE_API_KEY=
ANTHROPIC_API_URL=https://api.anthropic.com
API_KEY_SECRET=change_me_in_production
ENRICH_WINDOW_SECONDS=60
```

---

## Deployment (Railway)

```bash
cd kontex-api
npm run build         # Compile TypeScript

railway login
railway init
railway up            # Deploy all three services from railway.toml

railway run npm run migrate    # Run DB migrations in production

# Verify
curl https://your-app.railway.app/health
# → { "status": "ok" }
```

Three Railway services are deployed from `railway.toml`:
- `kontex-api` — main API server
- `kontex-embed-worker` — Qdrant embedding background worker
- `kontex-span-worker` — OTLP span processing background worker

---

## Key Features

- **Zero-friction capture** — proxy one line, add two headers; no SDK changes required
- **OpenLLMetry native** — auto-instrument any LLM framework (LangChain, LlamaIndex, CrewAI, etc.) with a single SDK call
- **Immutable audit trail** — every snapshot sealed on write; rollback always creates forward
- **Semantic search** — `GET /v1/search?q=auth+bug` finds semantically relevant snapshots via Qdrant + Voyage AI
- **Time-travel dashboard** — ReactFlow session graph, snapshot diff, and timeline via tRPC
- **Real-time feed** — SSE stream for live agent monitoring
- **MCP tools** — agents can read their own context and create named checkpoints
- **Rate limiting** — per-API-key hourly limits (1000 req/hr, 100 snapshot writes/hr)

---

## Tests

```bash
cd kontex-api
npm test
```

Test files cover: sessions, snapshots, proxy, enrich, ingest, tRPC, SSE.

---

## Documentation

| Doc | Path |
|---|---|
| Proxy quickstart | `kontex-api/docs/quickstart.md` |
| OpenLLMetry integration | `kontex-api/docs/openllmetry-quickstart.md` |
| MCP advanced usage | `kontex-api/docs/mcp-advanced.md` |
| Data model reference | `kontex-api/docs/data-model.md` |
