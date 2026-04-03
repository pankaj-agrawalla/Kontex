import { useState } from "react";
import { useLocation } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useTimeline } from "../hooks/useTrpc";
import { useUiStore } from "../store/ui";

const TABS = ["All", "Signals only", "MCP checkpoints"];

const DOT_CLASS = {
  proxy:    "border-teal     bg-[#00E5CC15]",
  mcp:      "border-[#B794F4] bg-[#B794F415]",
  signal:   "border-amber    bg-[#F5A62315]",
  CRITICAL: "border-red      bg-[#FF4D4D15]",
};

const SOURCE_BADGE = {
  proxy:       "text-teal   bg-[#00E5CC10] border-[#00E5CC30]",
  log_watcher: "text-amber  bg-[#F5A62310] border-[#F5A62330]",
  mcp:         "text-[#B794F4] bg-[#B794F410] border-[#B794F430]",
};

function dotClass(item) {
  if (item.type === "signal") {
    return item.severity === "CRITICAL" ? DOT_CLASS.CRITICAL : DOT_CLASS.signal;
  }
  return DOT_CLASS[item.type] ?? DOT_CLASS.proxy;
}

function TimelineItem({ item, isLast }) {
  const isSignal = item.type === "signal";

  return (
    <div className="relative flex gap-4">
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
      )}
      <div className="shrink-0 mt-2">
        <span className={`flex w-[22px] h-[22px] rounded-full border-2 ${dotClass(item)}`} />
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="bg-surface border border-border rounded px-4 py-3 hover:border-muted transition-colors duration-150 cursor-pointer">
          <div className="flex items-start justify-between gap-3 mb-1">
            <p className="font-sans font-medium text-sm text-text leading-snug">{item.label}</p>
            <span className="font-mono text-2xs text-muted shrink-0 mt-0.5">
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            </span>
          </div>

          {isSignal ? (
            <>
              <p className="font-mono text-xs text-subtle">{item.detail}</p>
              <div className="mt-2">
                <span className="font-mono text-2xs bg-[#F5A62310] text-amber border border-[#F5A62330] rounded px-2 py-px">
                  {item.signalType}
                </span>
              </div>
            </>
          ) : (
            <p className="font-mono text-xs text-subtle">
              {item.id}
              {item.tokenTotal != null && (
                <> · <span className="text-text">{item.tokenTotal.toLocaleString()} tok</span></>
              )}
              {item.tokenDelta > 0 && (
                <span className="text-amber"> · Δ+{item.tokenDelta.toLocaleString()}</span>
              )}
              {item.source && (
                <> · <span className={`font-mono text-2xs border rounded px-1 py-px ml-1 ${SOURCE_BADGE[item.source] ?? SOURCE_BADGE.proxy}`}>
                  {item.source}
                </span></>
              )}
              {item.enriched && (
                <span className="ml-1 font-mono text-2xs text-amber">· enriched</span>
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TimelinePage() {
  const [activeTab, setActiveTab] = useState("All");
  const location = useLocation();
  const sessionId = useUiStore((s) => s.activeSessionId) ?? new URLSearchParams(location.search).get("sessionId");
  const { data: timeline = [], isLoading } = useTimeline(sessionId);

  const filtered = timeline.filter((item) => {
    if (activeTab === "Signals only")      return item.type === "signal";
    if (activeTab === "MCP checkpoints")   return item.type === "mcp";
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Timeline</h1>
        <span className="font-mono text-2xs text-subtle">prod-code-refactor-v2</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0 bg-surface px-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-3 font-mono text-xs transition-colors duration-150 border-b-2 -mb-px",
              activeTab === tab
                ? "text-teal border-teal"
                : "text-muted border-transparent hover:text-subtle",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-2xl">
          {isLoading ? (
            <p className="font-sans text-sm text-subtle text-center py-12">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="font-sans text-sm text-subtle text-center py-12">
              No entries match this filter.
            </p>
          ) : (
            filtered.map((item, i) => (
              <TimelineItem key={item.id} item={item} isLast={i === filtered.length - 1} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
