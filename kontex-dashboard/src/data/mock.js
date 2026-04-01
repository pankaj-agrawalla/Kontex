// Sessions — matches GET /v1/sessions response shape ({ data, nextCursor })
export const mockSessionsResponse = {
  data: [
    {
      id: "sess_01",
      name: "Refactor auth module",
      description: null,
      status: "ACTIVE",
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
      id: "sess_02",
      name: "API schema migration",
      description: "Migrate v1 to v2 schema",
      status: "PAUSED",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
    {
      id: "sess_03",
      name: "Write onboarding docs",
      description: null,
      status: "COMPLETED",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
  ],
  nextCursor: null,
};

// Single session — matches GET /v1/sessions/:id (includes taskCount)
export const mockSession = {
  id: "sess_01",
  name: "Refactor auth module",
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

// Usage — matches GET /v1/usage
export const mockUsage = {
  total_sessions:       12,
  active_sessions:       3,
  total_snapshots:      84,
  total_tokens_stored: 1240800,
  snapshots_this_month: 31,
  tokens_this_month:   420300,
};

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
