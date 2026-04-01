import { useState } from "react";
import { mockDiffDetailed, mockTimeline } from "../data/mock";

const SNAPSHOTS = mockTimeline.map((s) => ({ id: s.id, label: s.label }));

function DiffLine({ line }) {
  const styles = {
    add:  { prefix: "+", prefixClass: "text-teal",   contentClass: "text-teal"   },
    rem:  { prefix: "−", prefixClass: "text-red",    contentClass: "text-red"    },
    same: { prefix: " ", prefixClass: "text-muted",  contentClass: "text-subtle" },
  };
  const s = styles[line.type] ?? styles.same;

  return (
    <div className="flex gap-3 py-1 border-b border-border last:border-0 font-mono text-xs">
      <span className={`w-3 shrink-0 ${s.prefixClass}`}>{s.prefix}</span>
      <span className={`flex-1 break-all leading-relaxed ${s.contentClass}`}>
        {line.content || <span className="opacity-0">_</span>}
      </span>
    </div>
  );
}

function DiffPanel({ file }) {
  const changeColors = {
    added:    "text-teal",
    removed:  "text-red",
    modified: "text-amber",
  };

  return (
    <div className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bg border-b border-border">
        <span className={`font-mono text-2xs ${changeColors[file.change] ?? "text-subtle"}`}>
          {file.change}
        </span>
        <span className="font-mono text-xs text-text flex-1 truncate">{file.path}</span>
        <span className="font-mono text-2xs text-muted">
          {file.lines.filter((l) => l.type === "add").length}+ {file.lines.filter((l) => l.type === "rem").length}−
        </span>
      </div>
      <div className="px-4 py-2 max-h-64 overflow-auto">
        {file.lines.map((line, i) => (
          <DiffLine key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

export default function DiffPage() {
  const [fromId, setFromId] = useState(SNAPSHOTS[0]?.id ?? "");
  const [toId,   setToId]   = useState(SNAPSHOTS[2]?.id ?? "");
  const [result, setResult] = useState(null);

  function handleCompare() {
    // Mock: always return mockDiffDetailed regardless of selection
    setResult(mockDiffDetailed);
  }

  const diff = result ?? mockDiffDetailed;

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
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 font-mono text-xs text-text focus:outline-none focus:border-teal transition-colors duration-150 cursor-pointer"
          >
            {SNAPSHOTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <span className="text-muted font-mono text-sm shrink-0">→</span>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="flex-1 bg-bg border border-border rounded px-3 py-2 font-mono text-xs text-text focus:outline-none focus:border-teal transition-colors duration-150 cursor-pointer"
          >
            {SNAPSHOTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleCompare}
            className="px-4 py-2 font-mono text-xs text-teal border border-[#00E5CC40] bg-[#00E5CC10] rounded hover:bg-[#00E5CC20] transition-colors duration-150 whitespace-nowrap"
          >
            Compare →
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            { label: "Files added",    value: diff.summary.filesAdded,    color: "text-teal"   },
            { label: "Files removed",  value: diff.summary.filesRemoved,  color: "text-red"    },
            { label: "Files modified", value: diff.summary.filesModified, color: "text-amber"  },
            { label: "Token delta",    value: `+${diff.summary.tokenDelta.toLocaleString()}`, color: "text-amber" },
          ].map((s) => (
            <div key={s.label} className="bg-surface border border-border rounded-md px-4 py-3 text-center">
              <p className={`font-mono text-xl font-semibold ${s.color}`}>{s.value}</p>
              <p className="font-sans text-xs text-muted mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Diff panels */}
        <div className="flex flex-col gap-4">
          {diff.files.map((file) => (
            <DiffPanel key={file.path} file={file} />
          ))}
        </div>
      </div>
    </div>
  );
}
