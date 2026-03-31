# Kontex Backend — Exact Execution Guide
### How to build this precisely as specified, zero variations

---

## Purpose of This Document

The build guide (`kontex-backend-buildguide.md`) defines **what** to build.
The CLAUDE.md defines **how Claude Code should behave**.
This document defines **exactly how you execute** — the physical steps, the order of operations, what to do when things go wrong, and how to keep Claude Code on track.

Follow this document literally. Do not improvise. Every deviation from the build guide creates compounding drift across sprints.

---

## Prerequisites: Verify Before Starting

Run every check. Do not proceed if any fails.

```bash
# Node 20+
node -v
# Expected: v20.x.x or higher

# npm 10+
npm -v
# Expected: 10.x.x or higher

# Claude Code CLI
claude --version
# Expected: any version, must launch without error

# Railway CLI
railway --version
# Expected: any version

# Wrangler (Cloudflare R2)
wrangler --version
# Expected: any version

# Docker running
docker ps
# Expected: empty table or running containers, no error

# Docker images available
docker pull postgres:16
docker pull redis:7
# Expected: both pull successfully
```

**VSCode extensions — install all four before starting:**
1. Open VSCode
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux)
3. Search and install each:
   - `humao.rest-client` — REST Client
   - `Prisma.prisma` — Prisma
   - `dbaeumer.vscode-eslint` — ESLint
   - `mikestead.dotenv` — DotENV

---

## One-Time Setup: External Services

Do this before Sprint 1. You need credentials for R2, Qdrant, and Voyage AI in your `.env` before certain sprints.

### Cloudflare R2

1. Go to https://dash.cloudflare.com
2. Left sidebar → R2 Object Storage → Create bucket
3. Bucket name: `kontex-bundles`
4. Go to R2 → Manage R2 API Tokens → Create API Token
5. Permissions: Object Read & Write
6. Copy: Account ID, Access Key ID, Secret Access Key
7. Note your R2 endpoint: `https://{account_id}.r2.cloudflarestorage.com`

### Qdrant Cloud

1. Go to https://cloud.qdrant.io
2. Create a free cluster (1GB, sufficient for development)
3. Note the cluster URL (format: `https://xxx.eu-central.aws.cloud.qdrant.io`)
4. Go to API Keys → Create API Key
5. Copy the key

### Voyage AI

1. Go to https://www.voyageai.com
2. Create account → API Keys → Create new key
3. Copy the key

### Railway (for production — do after local dev works)

1. Go to https://railway.app
2. Create account, create new project
3. Add PostgreSQL service → copy `DATABASE_URL`
4. Add Redis service → copy `REDIS_URL`
5. Note your project name — you'll need it for `railway up`

---

## Repository Setup

```bash
# Create project directory
mkdir kontex-api
cd kontex-api

# Initialize git
git init
echo "node_modules/" > .gitignore
echo ".env" >> .gitignore
echo "dist/" >> .gitignore

# Open in VSCode
code .
```

---

## Starting Claude Code

Open a terminal in VSCode (`Ctrl+`` ` or `Cmd+`` `).

```bash
# Start Claude Code
claude
```

You will see the Claude Code prompt. **Before executing any sprint prompt:**

1. Confirm `CLAUDE.md` is in the project root
2. Type: `Read CLAUDE.md and confirm you understand the project`
3. Claude Code should summarize: Kontex is a state machine with audit trail, proxy is primary write path, snapshots are immutable
4. If the summary is wrong or incomplete, paste the CLAUDE.md contents manually

---

## How to Execute Prompts

Each sprint in the build guide contains numbered prompts (e.g., Prompt 1.1, Prompt 1.2).

**The exact method for each prompt:**

1. Open `kontex-backend-buildguide.md`
2. Find the current sprint and prompt number
3. Copy the entire contents of the prompt code block — from the opening ` ``` ` to the closing ` ``` `
4. Paste into the Claude Code terminal
5. Press Enter
6. Wait for Claude Code to complete all file operations
7. Do not interrupt mid-execution
8. When Claude Code stops outputting: verify the prompt's stated outcome
9. Fix any errors before moving to the next prompt

**Do not batch prompts.** Execute one at a time. Each prompt builds on the previous one's output.

**Do not skip verification steps.** Each prompt ends with a `Verify:` section. Run those commands literally.

---

## Sprint-by-Sprint Execution

### Before Every Sprint

```bash
# Ensure dev server is stopped
# Ctrl+C in the terminal running npm run dev

# Check git status — commit completed work before starting new sprint
git add -A
git commit -m "sprint {N} complete"

# Confirm done criteria from previous sprint are all checked
# (They are listed at the top of each sprint in the build guide)
```

### Sprint 1: Foundation

**Start Docker before Prompt 1.3:**
```bash
# In a separate terminal (not the Claude Code terminal)
docker run -d --name kontex-pg \
  -e POSTGRES_DB=kontex \
  -e POSTGRES_USER=kontex \
  -e POSTGRES_PASSWORD=kontex \
  -p 5432:5432 postgres:16

docker run -d --name kontex-redis \
  -p 6379:6379 redis:7

# Verify both are running
docker ps
# Should show both kontex-pg and kontex-redis
```

**Create `.env` before Prompt 1.2:**
```bash
# Copy the example
cp .env.example .env
```

Edit `.env` with local values:
```bash
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://kontex:kontex@localhost:5432/kontex
REDIS_URL=redis://localhost:6379
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=kontex-bundles
R2_ENDPOINT=https://your_account_id.r2.cloudflarestorage.com
QDRANT_URL=https://your_cluster.qdrant.io
QDRANT_API_KEY=your_qdrant_key
QDRANT_COLLECTION=kontex_snapshots
VOYAGE_API_KEY=your_voyage_key
ANTHROPIC_API_URL=https://api.anthropic.com
API_KEY_SECRET=local_dev_secret_change_in_prod
ENRICH_WINDOW_SECONDS=60
```

**After Prompt 1.3 (Prisma schema + migration):**
```bash
# In a separate terminal — open Prisma Studio to visually verify tables
npm run studio
# Browser opens at http://localhost:5555
# Verify: User, ApiKey, Session, Task, Snapshot tables all present
# Close Studio (Ctrl+C) when done

# Seed test data manually in Studio or via psql:
# User: { email: "dev@kontex.local" }
# ApiKey: { key: "test_key_dev", userId: <user id>, active: true }
```

**After Prompt 1.7 (verification):**
```bash
npm test
# All 4 tests must pass
# Fix any failures before Sprint 2
```

Sprint 1 done criteria checklist:
```
- [ ] npm run dev starts without errors
- [ ] GET /health → { status: "ok", ts, version: "0.1.0" }
- [ ] Prisma migrations run, all tables in Studio
- [ ] Request without auth → 401
- [ ] Session + task CRUD return correct status codes
- [ ] Accessing another user's session → 404
- [ ] All errors { error, message } shape
- [ ] npm test passes
```

---

### Sprint 2: Snapshot Engine

**Before starting:** Sprint 1 done criteria all checked ✓

**After Prompt 2.2 (bundle service):**
Verify R2 is reachable:
```bash
# Quick R2 connectivity test — run in Node REPL
node -e "
const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: 'auto',
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }
});
client.send(new ListBucketsCommand({})).then(r => console.log('R2 OK:', r.Buckets)).catch(e => console.error('R2 FAIL:', e.message));
" 
# Expected: R2 OK: [ { Name: 'kontex-bundles', ... } ]
```

**After Prompt 2.5 (verification):**
```bash
npm test
# snapshots.test.ts must pass

# Manual R2 check — after creating a snapshot via POST /v1/tasks/:id/snapshots:
# Go to Cloudflare dashboard → R2 → kontex-bundles
# Verify a file exists at bundles/{snapshotId}.json
# Download and inspect it — must be valid JSON matching ContextBundle shape
```

Sprint 2 done criteria checklist:
```
- [ ] POST /v1/tasks/:id/snapshots creates Postgres record + R2 blob
- [ ] GET /v1/snapshots/:id returns metadata + full bundle
- [ ] R2 key format: bundles/{snapshotId}.json
- [ ] source field defaults to "proxy"
- [ ] enriched defaults false
- [ ] Cross-user access → 404
- [ ] R2 error → 502, process does not crash
```

---

### Sprint 3: HTTP Proxy

**Before starting:** Sprint 2 done criteria all checked ✓

**After Prompt 3.2 (proxy route):**

Important: the proxy route does NOT use the standard auth middleware. Verify this is correct:
```bash
# This should work (Anthropic key in Authorization, Kontex key in X-Kontex-Api-Key)
curl -X POST http://localhost:3000/proxy/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "X-Kontex-Api-Key: test_key_dev" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"Say hi"}]}'
# Expected: Anthropic response JSON
```

**Running Prompt 3.3 (proxy tests):**
```bash
# Set your real Anthropic API key for the integration test
export ANTHROPIC_API_KEY=sk-ant-...

npm test
# proxy.test.ts — integration test requires real key, skips if not set
```

**After Prompt 3.4 (docs):**
Review `docs/quickstart.md` manually. It must be accurate and usable by a developer who has never seen Kontex.

Sprint 3 done criteria checklist:
```
- [ ] POST /proxy/v1/messages returns identical Anthropic response
- [ ] Response overhead < 50ms
- [ ] Auto-snapshot fires at correct trigger — Snapshot in DB
- [ ] Snapshot failure does not affect Anthropic response
- [ ] Missing X-Kontex-Session-Id → proxy still works, no snapshot
- [ ] source on snapshot is "proxy"
- [ ] files and logEvents in bundle are []
- [ ] docs/quickstart.md complete and accurate
- [ ] Manual proxy test script works end-to-end
```

---

### Sprint 4: Log Watcher

**Before starting:** Sprint 3 done criteria all checked ✓

**After Prompt 4.3 (log file tailer):**

Verify Claude Code actually writes logs to the expected location:
```bash
ls ~/.claude/projects/
# Should show one or more hash-named directories

ls ~/.claude/projects/*/
# Should show .jsonl files

head -5 ~/.claude/projects/*/*.jsonl | head -20
# Should show JSON objects, one per line
# Note the event shapes — they must match what parser.ts handles
```

If the log format differs from what the parser expects, update `watcher/parser.ts` before continuing. The JSONL format is the ground truth — the parser must match it.

**Running Prompt 4.4 (watcher entry):**
```bash
# Test the watcher in a separate terminal
npm run watch -- --api-key=test_key_dev --session-id={a real session id from Sprint 1}
# Expected: "[kontex-watch] Watching ~/.claude/projects/ — enriching session {id}"
# Should not crash
```

**After Prompt 4.5 (verification):**
End-to-end enrichment test:
```bash
# Terminal 1: dev server
npm run dev

# Terminal 2: watcher
npm run watch -- --api-key=test_key_dev --session-id={session_id}

# Terminal 3: trigger a proxy snapshot
curl -X POST http://localhost:3000/proxy/v1/messages \
  -H "Authorization: Bearer $ANTHROPIC_API_KEY" \
  -H "X-Kontex-Api-Key: test_key_dev" \
  -H "X-Kontex-Session-Id: {session_id}" \
  -H "X-Kontex-Snapshot-Trigger: on_tool_end" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"Read the file src/index.ts"}],"tools":[...]}'

# Wait ~10 seconds for watcher to push enrichment
# Then check the snapshot
curl http://localhost:3000/v1/snapshots/{snapshot_id}/bundle \
  -H "Authorization: Bearer test_key_dev"
# Expected: bundle.files[] is not empty (contains file read data from log)
```

Sprint 4 done criteria checklist:
```
- [ ] npm run watch starts and tails ~/.claude/projects/
- [ ] Parser extracts file reads, tool calls, reasoning from JSONL
- [ ] POST /v1/snapshots/:id/enrich within 60s → 200, enriched: true
- [ ] POST /v1/snapshots/:id/enrich after 60s → 409
- [ ] bundle.files[] populated after enrichment
- [ ] Log watcher failure does not affect proxy operation
- [ ] docs/log-watcher.md complete
```

---

### Sprint 5: Rollback

**Before starting:** Sprint 4 done criteria all checked ✓

**After Prompt 5.1 (rollback service + route):**

Critical correctness check — run manually:
```bash
# 1. Create a snapshot
SNAP_ID=$(curl -s -X POST http://localhost:3000/v1/tasks/{task_id}/snapshots \
  -H "Authorization: Bearer test_key_dev" \
  -H "Content-Type: application/json" \
  -d '{"label":"Before refactor","bundle":{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hello"}],"source":"proxy","enriched":false,"files":[],"toolCalls":[],"logEvents":[]}}' | jq -r '.id')

echo "Created snapshot: $SNAP_ID"

# 2. Rollback
ROLLBACK=$(curl -s -X POST http://localhost:3000/v1/snapshots/$SNAP_ID/rollback \
  -H "Authorization: Bearer test_key_dev")

echo $ROLLBACK | jq .

# Verify:
# rollback_snapshot_id !== source_snapshot_id
# label starts with "Rollback to: "
# bundle is present with messages array
# Original snapshot UNCHANGED (GET /v1/snapshots/$SNAP_ID still returns original label)
```

Sprint 5 done criteria checklist:
```
- [ ] POST /v1/snapshots/:id/rollback returns full ContextBundle
- [ ] New Snapshot record created, original untouched
- [ ] Label: "Rollback to: {original label}"
- [ ] source inherits from original
- [ ] Cross-user rollback → 404
- [ ] rollback_snapshot_id and source_snapshot_id both in response
- [ ] npm test passes
```

---

### Sprint 6: MCP Server

**Before starting:** Sprint 5 done criteria all checked ✓

**Additional dependency — install before Prompt 6.1:**
```bash
npm install @modelcontextprotocol/sdk
```

**After Prompt 6.3 (all tools implemented):**

Connect Claude Code to the local MCP server:
```bash
# Add to ~/.claude/mcp_servers.json (create if it doesn't exist)
cat > ~/.claude/mcp_servers.json << 'EOF'
{
  "kontex-local": {
    "url": "http://localhost:3000/mcp",
    "headers": {
      "Authorization": "Bearer test_key_dev"
    }
  }
}
EOF
```

Restart Claude Code and verify tools are available:
```bash
claude
# In Claude Code, type: /mcp
# Should list: kontex_session_start, kontex_session_pause, kontex_task_start,
#              kontex_task_done, kontex_snapshot, kontex_rollback
```

**End-to-end MCP test in Claude Code:**
```
In Claude Code terminal, manually prompt:
"Use kontex_session_start to create a session called 'MCP Test',
then use kontex_task_start to create a task called 'Verify MCP',
then use kontex_snapshot with label 'Initial state' and an empty messages array,
then use kontex_rollback with the snapshot_id returned"
```

Verify in DB:
```bash
# Check the snapshot was created with source = "mcp"
curl http://localhost:3000/v1/sessions/{session_id}/snapshots \
  -H "Authorization: Bearer test_key_dev" | jq '.[0].source'
# Expected: "mcp"
```

Sprint 6 done criteria checklist:
```
- [ ] MCP tool list returns all 6 tools
- [ ] Full flow: session_start → task_start → snapshot → rollback
- [ ] Snapshot source is "mcp"
- [ ] All tools return descriptive error strings, not stack traces
- [ ] End-to-end verified in live Claude Code session
- [ ] docs/mcp-advanced.md complete
```

---

### Sprint 7: Dashboard API

**Before starting:** Sprint 6 done criteria all checked ✓

**After Prompt 7.2 (dashboard routes):**

Test each endpoint with real data. By now you should have multiple sessions, tasks, and snapshots from testing previous sprints. Use those.

```bash
# Graph endpoint — must return ReactFlow JSON
curl "http://localhost:3000/v1/sessions/{session_id}/graph" \
  -H "Authorization: Bearer test_key_dev" | jq '{nodeCount: (.nodes | length), edgeCount: (.edges | length)}'

# Timeline endpoint — must include source and enriched fields
curl "http://localhost:3000/v1/sessions/{session_id}/snapshots/timeline" \
  -H "Authorization: Bearer test_key_dev" | jq '.[0] | {id, label, source, enriched, tokenDelta}'

# Diff endpoint — use two snapshot IDs from the same session
curl "http://localhost:3000/v1/sessions/{session_id}/diff?from={snap_id_1}&to={snap_id_2}" \
  -H "Authorization: Bearer test_key_dev" | jq '{tokenDelta: .token_delta}'

# Usage endpoint
curl "http://localhost:3000/v1/usage" \
  -H "Authorization: Bearer test_key_dev" | jq .
```

**Connect the frontend dashboard** (if it exists from the frontend build):
```bash
# In the frontend project, update .env:
VITE_KONTEX_API_URL=http://localhost:3000

# Start frontend dev server
npm run dev

# Verify: session list loads, task graph renders, timeline shows snapshots
```

Sprint 7 done criteria checklist:
```
- [ ] /graph returns valid ReactFlow JSON with nodes and edges
- [ ] /diff returns typed diff with correct token_delta
- [ ] /timeline includes source and enriched fields, correct tokenDelta
- [ ] /usage returns correct aggregated stats
- [ ] Dashboard frontend connects and renders (if available)
```

---

### Sprint 8: Semantic Search + Polish + Deploy

**Before starting:** Sprint 7 done criteria all checked ✓

**After Prompt 8.1 (embed service + worker):**

Start the embed worker in a separate terminal:
```bash
# Terminal 2 (separate from dev server)
npm run worker
# Expected: "[embed-worker] Started"
```

Create a snapshot and watch it get embedded:
```bash
# Create snapshot
SNAP_ID=$(curl -s -X POST ... | jq -r '.id')

# Wait 5-10 seconds for embed worker to process
sleep 10

# Check embedded flag
curl "http://localhost:3000/v1/snapshots/$SNAP_ID" \
  -H "Authorization: Bearer test_key_dev" | jq '.embedded'
# Expected: true
```

Also verify in Qdrant dashboard (https://cloud.qdrant.io):
- Collection `kontex_snapshots` exists
- Points count > 0

**After Prompt 8.2 (search endpoint):**
```bash
# Test semantic search
curl "http://localhost:3000/v1/search?q=auth+middleware" \
  -H "Authorization: Bearer test_key_dev" | jq '.[0]'
# Expected: snapshot result with score between 0 and 1
```

**After Prompt 8.3 (rate limiting):**
```bash
# Quick rate limit test — send 5 requests rapidly, verify 429 at limit
# (In dev, temporarily lower limit to 5 for testing, then restore to 1000)
for i in {1..6}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/v1/sessions \
    -H "Authorization: Bearer test_key_dev")
  echo "Request $i: $STATUS"
done
# Expected: first 5 return 200, 6th may return 429 (only if you lowered the limit for testing)
```

**After Prompt 8.4 (Railway deploy):**

Pre-deploy checklist:
```bash
# 1. Build must pass with zero TypeScript errors
npm run build
# Expected: no errors, dist/ directory created

# 2. All tests pass
npm test

# 3. Verify railway.toml is correct
cat railway.toml
```

Deploy:
```bash
railway login
railway init
# Select: create new project OR link to existing

railway up
# Watch logs — should show build + deploy success

# Run migrations in production
railway run npm run migrate

# Test production health
curl https://your-app.railway.app/health
# Expected: { status: "ok" }

# View logs
railway logs -f
# Expected: server started, no errors
```

**Prompt 8.5 (final verification):**

This is the complete project sign-off. Run every item in the verification list from the prompt. Do not skip any. Fix every failure found. The backend is not done until all 15 items pass.

Sprint 8 done criteria checklist:
```
- [ ] Embed worker processes jobs, embedded flag flips to true
- [ ] GET /v1/search returns semantically relevant results
- [ ] Search scoped to authenticated user only
- [ ] Rate limiting returns 429 with retry_after
- [ ] POST /v1/keys returns key once, never again
- [ ] GET /v1/keys never returns key value
- [ ] All errors follow { error, message } shape
- [ ] npm run build completes with zero TypeScript errors
- [ ] npm test passes all tests
- [ ] railway up deploys both services (api + embed worker)
- [ ] GET /health → 200 in production
- [ ] All four docs present and accurate
- [ ] No stack traces in any API response
- [ ] No API key values in any log output
- [ ] Rollback creates, original untouched — verified in production
```

---

## When Claude Code Goes Off-Track

Claude Code may occasionally drift from the build guide. These are the corrective actions.

**Symptom: Claude Code adds a feature not in the build guide**
```
Stop. Type: "Revert that change. Only implement exactly what Prompt {X.Y} specifies."
```

**Symptom: Claude Code uses a different library than specified**
```
Stop. Type: "Use the exact library specified in CLAUDE.md tech stack. 
Do not substitute {wrong library} for {correct library}."
```

**Symptom: Claude Code creates files not in the project structure**
```
Stop. Type: "Delete {file}. The project structure is fixed as defined in CLAUDE.md. 
Only create files that exist in that structure."
```

**Symptom: Claude Code skips the Verify step**
```
Type: "Run the verification steps from Prompt {X.Y} before continuing."
```

**Symptom: Claude Code adds a chat input or conversational UI to any component**
(Frontend sprints only)
```
Stop immediately. Type: "Remove that component entirely. There is no chat input anywhere 
in this application. Read the design rule in CLAUDE.md."
```

**Symptom: TypeScript errors on `npm run build`**
```
Type: "Fix all TypeScript errors. Strict mode is on. No 'any' types. 
No ts-ignore comments. All functions must have explicit return types."
```

**Symptom: A service is calling another service directly**
```
Type: "Services must not call other services. Move the orchestration logic 
to the route handler. See coding standards in CLAUDE.md."
```

**Symptom: A route is returning 403 instead of 404 for wrong-user access**
```
Type: "Return 404, not 403, when a resource belongs to another user. 
Do not reveal existence. See coding standards in CLAUDE.md."
```

**Symptom: Proxy snapshot is being awaited in the request cycle**
```
Type: "The snapshot must be fire-and-forget. Never await it in the proxy request handler. 
The Anthropic response must return immediately regardless of snapshot outcome."
```

**Symptom: Rollback is deleting or mutating existing snapshots**
```
Stop immediately. Type: "Rollback must create a new snapshot record and a new R2 blob. 
The original snapshot must never be modified or deleted. Snapshots are immutable. 
Rewrite rollbackToSnapshot to only create."
```

---

## Keeping State Between Sessions

Claude Code does not retain memory between terminal sessions. At the start of every new Claude Code session:

```bash
cd kontex-api
claude
```

Then type:
```
Read CLAUDE.md. We are on Sprint {N}, Prompt {N.X}. 
The previous prompts in this sprint are complete. Continue from Prompt {N.X}.
```

Claude Code will re-read the project files and pick up from where you left off.

If a prompt was only partially completed in the previous session:
```
Read CLAUDE.md. Prompt {N.X} was partially executed. 
Here is what was completed: {describe what exists}.
Here is what still needs to be done: {describe remaining work}.
Complete only the remaining work, do not redo what's already done.
```

---

## Commit Strategy

Commit after each sprint is fully verified, not after each prompt. This keeps git history clean and meaningful.

```bash
# After sprint N is complete and all done criteria checked:
git add -A
git commit -m "Sprint {N}: {sprint name}

- {key deliverable 1}
- {key deliverable 2}
- {key deliverable 3}

All done criteria verified."
```

Suggested commit messages:
```
Sprint 1: Foundation — Hono server, auth, sessions, tasks
Sprint 2: Snapshot engine — ContextBundle, R2 storage
Sprint 3: HTTP Proxy — primary write path, auto-snapshot, quickstart docs
Sprint 4: Log Watcher — JSONL parser, enrichment endpoint, log-watcher docs
Sprint 5: Rollback — forward-only history, restorable ContextBundle
Sprint 6: MCP Server — 6 tools, Claude Code integration, advanced docs
Sprint 7: Dashboard API — graph, diff, timeline, usage
Sprint 8: Search + Deploy — Qdrant, rate limiting, Railway production
```

---

## Running All Three Processes Together (Sprint 4+)

From Sprint 4 onward, you have three processes that run simultaneously during development:

```bash
# Terminal 1 — API server
npm run dev

# Terminal 2 — Embed worker
npm run worker

# Terminal 3 — Log watcher (when testing Claude Code integration)
npm run watch -- --api-key=test_key_dev --session-id={session_id}
```

Use VSCode's split terminal (`Cmd+Shift+5` or `Ctrl+Shift+5`) to keep all three visible.

---

## Final Sign-Off Checklist

Before declaring the backend complete, run Prompt 8.5 and verify every item. Then check:

```
□ npm run build — zero TypeScript errors
□ npm test — all tests pass
□ GET /health → 200 locally
□ GET /health → 200 in production on Railway
□ POST /proxy/v1/messages → returns Anthropic response
□ Auto-snapshot created after proxy call
□ POST /v1/snapshots/:id/enrich → 200 within 60s window
□ POST /v1/snapshots/:id/enrich → 409 after 60s
□ GET /v1/sessions/:id/graph → valid ReactFlow JSON
□ GET /v1/search?q=test → results with scores
□ POST /v1/snapshots/:id/rollback → new snapshot, original unchanged
□ POST /v1/keys → key returned once only
□ 1001st request in an hour → 429
□ No stack traces in any response
□ No API key values in any log
□ docs/quickstart.md — accurate and complete
□ docs/log-watcher.md — accurate and complete
□ docs/mcp-advanced.md — accurate and complete
□ docs/data-model.md — accurate and complete
□ railway logs -f — no errors in production
□ Both Railway services (api + embed-worker) healthy
```

All 21 items must pass. The backend is done.

---

*Kontex Backend — Exact Execution Guide · v1.0*
*Use with: kontex-backend-buildguide.md + CLAUDE.md*
