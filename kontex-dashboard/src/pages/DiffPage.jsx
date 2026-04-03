import { useState } from "react";
import { FileCode } from "lucide-react";
import { useDiff, useTimeline } from "../hooks/useTrpc";

export default function DiffPage() {
  const sessionId = new URLSearchParams(location.search).get("sessionId") ?? "";

  const { data: timeline = [] } = useTimeline(sessionId);
  const snapshots = timeline.map((s) => ({ id: s.id, label: s.label }));

  const [fromId, setFromId] = useState("");
  const [toId,   setToId]   = useState("");

  const effectiveFrom = fromId || snapshots[0]?.id || "";
  const effectiveTo   = toId   || snapshots[2]?.id || snapshots[snapshots.length - 1]?.id || "";

  const { data: diff, isLoading, isError } = useDiff(sessionId, effectiveFrom, effectiveTo);

  function formatDelta(delta) {
    if (!delta && delta !== 0) return "—";
    if (delta >= 0) return `+${delta.toLocaleString()}`;
    return `−${Math.abs(delta).toLocaleString()}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Diff view</h1>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Controls */}
        <div className="flex items-center gap-3 bg-surface border border-border rounded-md px-4 py-3 mb-5">
          <select
            value={fromId || effectiveFrom}
            onChange={(e) => setFromId(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 font-mono text-xs text-text focus:outline-none focus:border-teal transition-colors duration-150 cursor-pointer"
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <span className="text-muted font-mono text-sm shrink-0">→</span>
          <select
            value={toId || effectiveTo}
            onChange={(e) => setToId(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 font-mono text-xs text-text focus:outline-none focus:border-teal transition-colors duration-150 cursor-pointer"
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 bg-muted rounded animate-pulse" />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <p className="text-red text-sm font-sans">Failed to load diff. Try again.</p>
        )}

        {/* Results */}
        {!isLoading && !isError && diff && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              {[
                { label: "Files added",   value: diff.added?.length ?? 0,   color: "text-teal"  },
                { label: "Files removed", value: diff.removed?.length ?? 0, color: "text-red"   },
                { label: "Token delta",   value: formatDelta(diff.token_delta), color: "text-amber" },
              ].map((s) => (
                <div key={s.label} className="bg-surface border border-border rounded-md px-4 py-3 text-center">
                  <p className={`font-mono text-xl font-semibold ${s.color}`}>{s.value}</p>
                  <p className="font-sans text-xs text-muted mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Added files */}
            {diff.added?.length > 0 && (
              <div className="mb-4">
                <p className="font-sans text-2xs text-subtle uppercase tracking-widest mb-2">Files added</p>
                <div className="bg-surface border border-border rounded-md overflow-hidden">
                  {diff.added.map((path) => (
                    <div key={path} className="flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-0 border-l-2 border-l-teal bg-teal/5">
                      <FileCode size={12} className="text-teal shrink-0" />
                      <span className="font-mono text-xs text-text truncate">{path}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Removed files */}
            {diff.removed?.length > 0 && (
              <div className="mb-4">
                <p className="font-sans text-2xs text-subtle uppercase tracking-widest mb-2">Files removed</p>
                <div className="bg-surface border border-border rounded-md overflow-hidden">
                  {diff.removed.map((path) => (
                    <div key={path} className="flex items-center gap-2 px-4 py-2.5 border-b border-border last:border-0 border-l-2 border-l-red bg-red/5">
                      <FileCode size={12} className="text-red shrink-0" />
                      <span className="font-mono text-xs text-text truncate">{path}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No changes */}
            {!diff.added?.length && !diff.removed?.length && (
              <p className="font-sans text-xs text-subtle">No file changes between these snapshots.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
