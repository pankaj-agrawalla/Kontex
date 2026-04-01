// Sessions — matches GET /v1/sessions response shape ({ data, nextCursor })
export const mockSessionsResponse = {
  data: [
    {
      id: "sess_01",
      name: "prod-code-refactor-v2",
      description: null,
      status: "ACTIVE",
      snapshotCount: 247,
      tokenTotal: 1400000,
      signals: { critical: 1, warning: 2 },
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "sess_02",
      name: "customer-support-agent",
      description: "Handles tier-1 support queries",
      status: "ACTIVE",
      snapshotCount: 892,
      tokenTotal: 4100000,
      signals: { critical: 0, warning: 1 },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
    {
      id: "sess_03",
      name: "doc-pipeline-batch-14",
      description: null,
      status: "PAUSED",
      snapshotCount: 134,
      tokenTotal: 780000,
      signals: { critical: 0, warning: 0 },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
    {
      id: "sess_04",
      name: "api-integration-test",
      description: null,
      status: "COMPLETED",
      snapshotCount: 58,
      tokenTotal: 290000,
      signals: { critical: 0, warning: 0 },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    },
  ],
  nextCursor: null,
};

// Single session — matches GET /v1/sessions/:id (includes taskCount)
export const mockSession = {
  id: "sess_01",
  name: "prod-code-refactor-v2",
  description: null,
  status: "ACTIVE",
  taskCount: 4,
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
};

// Timeline — matches GET /v1/sessions/:id/snapshots/timeline
export const mockTimeline = [
  {
    id: "snap_001",
    label: "Initial context loaded",
    taskId: "task_01",
    taskName: "Parse codebase",
    source: "proxy",
    enriched: false,
    tokenTotal: 4200,
    tokenDelta: 4200,
    createdAt: new Date(Date.now() - 1000 * 60 * 40).toISOString(),
  },
  {
    id: "snap_002",
    label: "Auth.js read + analyzed",
    taskId: "task_01",
    taskName: "Parse codebase",
    source: "log_watcher",
    enriched: true,
    tokenTotal: 7800,
    tokenDelta: 3600,
    createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
  },
  {
    id: "snap_003",
    label: "Refactor plan generated",
    taskId: "task_02",
    taskName: "Identify refactor targets",
    source: "proxy",
    enriched: true,
    tokenTotal: 12300,
    tokenDelta: 4500,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: "snap_004",
    label: "Tests scaffolded",
    taskId: "task_03",
    taskName: "Generate refactor plan",
    source: "mcp",
    enriched: false,
    tokenTotal: 18420,
    tokenDelta: 6120,
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
];

// Full timeline for standalone Timeline page — snapshots + signals + MCP checkpoints interleaved
export const mockTimelineFull = [
  {
    id: "tl_sig_01",
    type: "signal",
    severity: "CRITICAL",
    label: "Context limit proximity — 91%",
    detail: "91,400 / 100,000 tokens",
    signalType: "context_limit_proximity",
    createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  },
  {
    id: "snap_k7l1m",
    type: "proxy",
    label: "Snapshot #247 · After refactor attempt",
    tokenTotal: 88200,
    tokenDelta: 3100,
    source: "proxy",
    enriched: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
  },
  {
    id: "snap_k6k0n",
    type: "proxy",
    label: "Snapshot #246 · File read batch",
    tokenTotal: 85100,
    tokenDelta: 12400,
    source: "proxy",
    enriched: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
  },
  {
    id: "tl_sig_02",
    type: "signal",
    severity: "WARNING",
    label: "Retry storm — read_file ×6",
    detail: "read_file :: /src/config.ts · called ×6",
    signalType: "retry_storm",
    createdAt: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
  },
  {
    id: "snap_j6k0l",
    type: "proxy",
    label: "Snapshot #241 · Tool calls complete",
    tokenTotal: 71400,
    tokenDelta: 800,
    source: "proxy",
    enriched: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: "snap_j2m7r",
    type: "mcp",
    label: "MCP checkpoint · Before config changes",
    tokenTotal: 70600,
    tokenDelta: 0,
    source: "mcp",
    enriched: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 41).toISOString(),
  },
  {
    id: "tl_sig_03",
    type: "signal",
    severity: "WARNING",
    label: "Context bloat +67%",
    detail: "28,100 → 47,000 tokens in one step",
    signalType: "context_bloat",
    createdAt: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
  },
  {
    id: "snap_h3q8u",
    type: "proxy",
    label: "Snapshot #228 · Session start",
    tokenTotal: 28100,
    tokenDelta: 28100,
    source: "proxy",
    enriched: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 62).toISOString(),
  },
];

// Snapshot — matches GET /v1/snapshots/:id (metadata + full ContextBundle)
export const mockSnapshot = {
  id: "snap_003",
  taskId: "task_02",
  label: "Refactor plan generated",
  tokenTotal: 12300,
  model: "claude-opus-4-6",
  source: "proxy",
  enriched: true,
  enrichedAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  embedded: true,
  r2Key: "bundles/snap_003.json",
  createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  bundle: {
    snapshotId: "snap_003",
    taskId: "task_02",
    sessionId: "sess_01",
    capturedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    model: "claude-opus-4-6",
    tokenTotal: 12300,
    source: "proxy",
    enriched: true,
    files: [
      { path: "src/auth/Auth.js",       contentHash: "abc123", tokenCount: 2100 },
      { path: "src/auth/middleware.js",  contentHash: "def456", tokenCount: 890  },
      { path: "tests/auth.test.js",      contentHash: "ghi789", tokenCount: 580  },
    ],
    toolCalls: [
      { tool: "read_file",  input: "src/auth/Auth.js",       output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 20).toISOString() },
      { tool: "read_file",  input: "src/auth/middleware.js", output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString() },
      { tool: "write_file", input: "tests/auth.test.js",     output: "...", status: "success", timestamp: new Date(Date.now() - 1000 * 60 * 16).toISOString() },
    ],
    messages: [
      { role: "user",      content: "Analyze the auth module and plan refactoring." },
      { role: "assistant", content: "I'll analyze Auth.js first to understand the current structure..." },
    ],
    reasoning: "Identified three anti-patterns: shared mutable state in middleware, missing token expiry checks, inconsistent error propagation. Refactor plan: (1) extract stateless helpers, (2) add expiry guard, (3) standardize error shape.",
    logEvents: [
      { type: "file_read", timestamp: new Date(Date.now() - 1000 * 60 * 19).toISOString(), data: { path: "src/auth/Auth.js" } },
      { type: "tool_call", timestamp: new Date(Date.now() - 1000 * 60 * 17).toISOString(), data: { tool: "write_file" } },
    ],
  },
};

// Diff — matches GET /v1/sessions/:id/diff?from=&to=
export const mockDiff = {
  added:       ["tests/auth.test.js"],
  removed:     [],
  token_delta: 4500,
};

// Detailed diff for the Diff page
export const mockDiffDetailed = {
  from: { id: "snap_001", label: "Initial context loaded",   tokenTotal: 4200  },
  to:   { id: "snap_003", label: "Refactor plan generated",  tokenTotal: 12300 },
  summary: { filesAdded: 1, filesRemoved: 0, filesModified: 1, tokenDelta: 8100 },
  files: [
    {
      path: "src/auth/Auth.js",
      change: "modified",
      lines: [
        { type: "same", content: "class Auth {" },
        { type: "same", content: "  constructor(config) {" },
        { type: "rem",  content: "    this.config = config" },
        { type: "add",  content: "    this.config = Object.freeze(config)" },
        { type: "same", content: "  }" },
        { type: "rem",  content: "  validate(token) { return true }" },
        { type: "add",  content: "  validate(token) {" },
        { type: "add",  content: "    if (!token || !token.expiry) return false" },
        { type: "add",  content: "    return token.expiry > Date.now()" },
        { type: "add",  content: "  }" },
      ],
    },
    {
      path: "tests/auth.test.js",
      change: "added",
      lines: [
        { type: "add", content: "import { Auth } from '../src/auth/Auth'" },
        { type: "add", content: "" },
        { type: "add", content: "describe('Auth', () => {" },
        { type: "add", content: "  it('rejects missing expiry', () => {" },
        { type: "add", content: "    expect(new Auth({}).validate({})).toBe(false)" },
        { type: "add", content: "  })" },
        { type: "add", content: "})" },
      ],
    },
  ],
};

// Graph — matches GET /v1/sessions/:id/graph (ReactFlow format)
export const mockGraph = {
  nodes: [
    { id: "task_01", data: { label: "Parse codebase",            status: "COMPLETED", tokenTotal: 7800,  snapshotCount: 2 }, position: { x: 300, y: 0   } },
    { id: "task_02", data: { label: "Identify refactor targets", status: "COMPLETED", tokenTotal: 4500,  snapshotCount: 1 }, position: { x: 300, y: 120 } },
    { id: "task_03", data: { label: "Generate refactor plan",    status: "ACTIVE",    tokenTotal: 6120,  snapshotCount: 1 }, position: { x: 300, y: 240 } },
    { id: "task_04", data: { label: "Write tests",               status: "ACTIVE",    tokenTotal: 0,     snapshotCount: 0 }, position: { x: 150, y: 360 } },
    { id: "task_05", data: { label: "Apply refactor",            status: "PENDING",   tokenTotal: 0,     snapshotCount: 0 }, position: { x: 450, y: 360 } },
    { id: "task_06", data: { label: "Validate output",           status: "PENDING",   tokenTotal: 0,     snapshotCount: 0 }, position: { x: 450, y: 480 } },
  ],
  edges: [
    { id: "e_task_01_task_02", source: "task_01", target: "task_02", animated: false },
    { id: "e_task_02_task_03", source: "task_02", target: "task_03", animated: true  },
    { id: "e_task_03_task_04", source: "task_03", target: "task_04", animated: true  },
    { id: "e_task_03_task_05", source: "task_03", target: "task_05", animated: true  },
    { id: "e_task_05_task_06", source: "task_05", target: "task_06", animated: true  },
  ],
};

// Signals — detected anomalies in a session
export const mockSignals = [
  {
    id: "sig_01",
    type: "context_limit_proximity",
    severity: "CRITICAL",
    sessionId: "sess_01",
    snapshotId: "snap_k8m2p",
    title: "Context limit proximity",
    description: "Context window at 91% capacity. Agent will begin losing early context on the next 2–3 turns. Likely cause: large file reads accumulated without summarisation.",
    data: "91,400 / 100,000 tokens · model: claude-opus-4-6",
    createdAt: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
  },
  {
    id: "sig_02",
    type: "retry_storm",
    severity: "WARNING",
    sessionId: "sess_01",
    snapshotId: "snap_j7n1q",
    title: "Retry storm detected",
    description: "Tool read_file called 6 times with identical input path. Agent is not processing the file content correctly between calls.",
    data: "read_file :: /src/config.ts · called ×6",
    createdAt: new Date(Date.now() - 1000 * 60 * 31).toISOString(),
  },
  {
    id: "sig_03",
    type: "context_bloat",
    severity: "WARNING",
    sessionId: "sess_01",
    snapshotId: "snap_h4r9v",
    title: "Context bloat",
    description: "Token count grew 67% in a single step — from 28K to 47K. A large tool response was injected without summarisation. Consider truncating verbose tool outputs.",
    data: "Δ +19,200 tokens in one step · growth rate: 67%",
    createdAt: new Date(Date.now() - 1000 * 60 * 48).toISOString(),
  },
];

// Usage — matches GET /v1/usage
export const mockUsage = {
  total_sessions:       12,
  active_sessions:       3,
  total_snapshots:      84,
  total_tokens_stored: 1240800,
  snapshots_this_month: 31,
  tokens_this_month:   420300,
};

// Usage broken down by session (for bar charts)
export const mockUsageBySession = [
  { sessionId: "sess_02", name: "customer-support-agent",  tokens: 4100000, snapshots: 892 },
  { sessionId: "sess_01", name: "prod-code-refactor-v2",   tokens: 1400000, snapshots: 247 },
  { sessionId: "sess_03", name: "doc-pipeline-batch-14",   tokens: 780000,  snapshots: 134 },
  { sessionId: "sess_04", name: "api-integration-test",    tokens: 290000,  snapshots: 58  },
];

// API Keys — matches GET /v1/keys (key value never included in list)
export const mockKeys = [
  { id: "key_01", label: "Dev workstation", lastUsed: new Date(Date.now() - 1000 * 60 * 5).toISOString(),        active: true, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString() },
  { id: "key_02", label: "CI pipeline",     lastUsed: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),   active: true, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString() },
];

// Search results — matches GET /v1/search?q=
export const mockSearchResults = [
  { snapshotId: "snap_003", taskId: "task_02", sessionId: "sess_01", label: "Refactor plan generated", source: "proxy",       score: 0.94, createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
  { snapshotId: "snap_002", taskId: "task_01", sessionId: "sess_01", label: "Auth.js read + analyzed", source: "log_watcher", score: 0.87, createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString() },
];
