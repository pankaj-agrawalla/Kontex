import { useState } from "react";
import { ChevronDown, ChevronRight, FileCode } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Scan } from "lucide-react";
import { useSessionsStore } from "../../store/sessions";
import EmptyState from "../shared/EmptyState";
import { useSnapshot, useSnapshotBundle } from "../../hooks/useTrpc";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SOURCE_STYLES = {
  proxy:       { bg: "bg-teal/10",  text: "text-teal",   label: "proxy"       },
  log_watcher: { bg: "bg-amber/10", text: "text-amber",  label: "log_watcher" },
  mcp:         { bg: "bg-muted/20", text: "text-subtle", label: "mcp"         },
};

function SourcePill({ source }) {
  const s = SOURCE_STYLES[source] ?? SOURCE_STYLES.proxy;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-2xs ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, count, badge, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-5 py-2.5 hover:bg-surface/50 transition-colors duration-150"
      >
        {open ? (
          <ChevronDown size={12} className="text-subtle shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-subtle shrink-0" />
        )}
        <span className="font-sans text-2xs font-normal text-subtle uppercase tracking-widest flex-1 text-left">
          {title}
        </span>
        {badge}
        {count !== undefined && (
          <span className="font-mono text-2xs text-muted">{count}</span>
        )}
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// ── Section 1: Files ──────────────────────────────────────────────────────────

function FilesSection({ files }) {
  return (
    <Section title="Files" count={files.length}>
      {files.length === 0 ? (
        <p className="px-5 py-3 font-sans text-xs text-subtle">No files captured</p>
      ) : (
        files.map((f) => (
          <div
            key={f.path}
            className="flex items-center gap-2 px-5 py-1.5 hover:bg-surface transition-colors duration-150"
          >
            <FileCode size={12} className="text-subtle shrink-0" />
            <span className="font-mono text-xs text-text flex-1 truncate">{f.path}</span>
            <span className="font-mono text-2xs text-subtle whitespace-nowrap">
              {f.tokenCount.toLocaleString()}
            </span>
          </div>
        ))
      )}
    </Section>
  );
}

// ── Section 2: Messages (+ Reasoning sub-section) ────────────────────────────

function ReasoningBlock({ reasoning }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-5 mb-2 border-l-2 border-amber pl-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-amber hover:opacity-80 transition-opacity"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="font-sans text-2xs uppercase tracking-widest">
          Reasoning
        </span>
      </button>
      {open && (
        <p className="font-sans text-xs text-subtle mt-1.5 leading-relaxed whitespace-pre-wrap">
          {reasoning}
        </p>
      )}
    </div>
  );
}

function MessagesSection({ messages, reasoning }) {
  return (
    <Section title="Messages" count={messages.length}>
      {messages.map((msg, i) => (
        <div key={i} className="px-5 py-2 border-b border-border last:border-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`font-mono text-2xs px-1.5 py-0.5 rounded ${
                msg.role === "user"
                  ? "bg-teal/10 text-teal"
                  : "bg-border text-subtle"
              }`}
            >
              {msg.role}
            </span>
            {msg.timestamp && (
              <span className="font-mono text-2xs text-subtle">
                {formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true })}
              </span>
            )}
          </div>
          <p className="font-sans text-xs text-subtle leading-relaxed line-clamp-2">
            {typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)}
          </p>
        </div>
      ))}
      {reasoning && <ReasoningBlock reasoning={reasoning} />}
    </Section>
  );
}

// ── Section 3: Tool Calls ─────────────────────────────────────────────────────

function ToolCallsSection({ toolCalls }) {
  return (
    <Section title="Tool Calls" count={toolCalls.length}>
      {toolCalls.length === 0 ? (
        <p className="px-5 py-3 font-sans text-xs text-subtle">No tool calls recorded</p>
      ) : (
        toolCalls.map((tc, i) => (
          <div
            key={i}
            className="flex items-start gap-3 px-5 py-2 hover:bg-surface transition-colors duration-150 border-b border-border last:border-0"
          >
            {/* Status dot */}
            <span
              className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                tc.status === "success" ? "bg-green" : "bg-red"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-teal">{tc.tool}</span>
                <span className="font-mono text-2xs text-subtle truncate max-w-[200px]">
                  {String(tc.input).slice(0, 60)}
                  {String(tc.input).length > 60 ? "…" : ""}
                </span>
              </div>
              {tc.timestamp && (
                <span className="font-mono text-2xs text-muted">
                  {formatDistanceToNow(new Date(tc.timestamp), { addSuffix: true })}
                </span>
              )}
            </div>
          </div>
        ))
      )}
    </Section>
  );
}

// ── Section 4: Log Events ─────────────────────────────────────────────────────

function LogEventsSection({ logEvents, enriched }) {
  const [expandedIndex, setExpandedIndex] = useState(null);

  const enrichedBadge = enriched ? (
    <span className="inline-flex items-center gap-1 font-mono text-2xs text-amber">
      <span className="w-1.5 h-1.5 rounded-full bg-amber" />
      enriched
    </span>
  ) : null;

  return (
    <Section title="Log Events" count={logEvents.length} badge={enrichedBadge} defaultOpen={false}>
      {logEvents.length === 0 ? (
        <p className="px-5 py-3 font-sans text-xs text-subtle">No log events recorded</p>
      ) : (
        logEvents.map((ev, i) => (
          <div
            key={i}
            className="px-5 py-2 border-b border-border last:border-0"
          >
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
            >
              {expandedIndex === i ? (
                <ChevronDown size={11} className="text-subtle" />
              ) : (
                <ChevronRight size={11} className="text-subtle" />
              )}
              <span className="font-mono text-2xs text-subtle px-1.5 py-0.5 bg-border rounded">
                {ev.type}
              </span>
              <span className="font-mono text-2xs text-muted">
                {formatDistanceToNow(new Date(ev.timestamp), { addSuffix: true })}
              </span>
            </div>
            {expandedIndex === i && (
              <pre className="mt-2 ml-5 font-mono text-2xs text-subtle bg-surface rounded p-2 overflow-auto max-h-32">
                {JSON.stringify(ev.data, null, 2)}
              </pre>
            )}
          </div>
        ))
      )}
    </Section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContextInspector() {
  const activeSnapshotId = useSessionsStore((s) => s.activeSnapshotId);

  const { data: snapshot } = useSnapshot(activeSnapshotId);
  const { data: bundle } = useSnapshotBundle(activeSnapshotId);

  if (!activeSnapshotId) {
    return (
      <EmptyState
        icon={FileCode}
        title="Select a checkpoint"
        subtitle="Choose a snapshot from the timeline to inspect its context."
      />
    );
  }

  if (!snapshot || !bundle) {
    return (
      <div className="p-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Metadata bar */}
      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border shrink-0 flex-wrap">
        <span className="font-sans text-sm text-text font-medium">{snapshot.label}</span>
        <SourcePill source={snapshot.source} />
        {snapshot.model && (
          <span className="font-mono text-2xs text-subtle">{snapshot.model}</span>
        )}
        <span className="font-mono text-xs text-subtle">
          {snapshot.tokenTotal.toLocaleString()} tokens
        </span>
        <span className="font-mono text-2xs text-subtle">
          {formatDistanceToNow(new Date(snapshot.createdAt), { addSuffix: true })}
        </span>
        {snapshot.enriched && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber/10 font-mono text-2xs text-amber">
            <span className="w-1 h-1 rounded-full bg-amber" />
            enriched
          </span>
        )}
        <span className="ml-auto font-mono text-2xs text-muted">{snapshot.id}</span>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-auto">
        <FilesSection files={bundle.files} />
        <MessagesSection messages={bundle.messages} reasoning={bundle.reasoning} />
        <ToolCallsSection toolCalls={bundle.toolCalls} />
        {(bundle.logEvents.length > 0 || snapshot.enriched) && (
          <LogEventsSection logEvents={bundle.logEvents} enriched={snapshot.enriched} />
        )}
      </div>
    </div>
  );
}
