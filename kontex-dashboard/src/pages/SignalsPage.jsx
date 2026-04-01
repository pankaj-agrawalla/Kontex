import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, AlertOctagon } from "lucide-react";
import { mockSignals, mockTimelineFull } from "../data/mock";

const SEVERITY_CONFIG = {
  CRITICAL: {
    icon:       AlertOctagon,
    iconBg:     "bg-[#FF4D4D15]",
    iconColor:  "text-red",
    badge:      "bg-[#FF4D4D15] text-red border-[#FF4D4D30]",
    label:      "CRITICAL",
    dotColor:   "bg-red",
  },
  WARNING: {
    icon:       AlertTriangle,
    iconBg:     "bg-[#F5A62315]",
    iconColor:  "text-amber",
    badge:      "bg-[#F5A62315] text-amber border-[#F5A62330]",
    label:      "WARNING",
    dotColor:   "bg-amber",
  },
};

function SignalItem({ signal }) {
  const cfg = SEVERITY_CONFIG[signal.severity] ?? SEVERITY_CONFIG.WARNING;
  const Icon = cfg.icon;

  return (
    <div className="flex gap-4 px-5 py-4 border-b border-border hover:bg-surface transition-colors duration-150">
      <div className={`w-8 h-8 rounded flex items-center justify-center shrink-0 mt-0.5 ${cfg.iconBg}`}>
        <Icon size={15} className={cfg.iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-sans font-medium text-sm text-text">{signal.title}</span>
          <span className={`font-mono text-2xs border rounded px-1.5 py-px ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
        <p className="font-mono text-2xs text-muted mb-1">
          {signal.snapshotId} · {formatDistanceToNow(new Date(signal.createdAt), { addSuffix: true })}
        </p>
        <p className="font-sans text-xs text-subtle leading-relaxed mb-2">{signal.description}</p>
        <span className="font-mono text-2xs text-subtle bg-surface border border-border rounded px-2 py-1 inline-block">
          {signal.data}
        </span>
      </div>
    </div>
  );
}

const TL_DOT = {
  proxy:  "border-teal   bg-[#00E5CC15]",
  mcp:    "border-[#B794F4] bg-[#B794F415]",
  signal: "border-amber  bg-[#F5A62315]",
  CRITICAL: "border-red  bg-[#FF4D4D15]",
};

function MiniTimelineItem({ item, isLast }) {
  const isSignal = item.type === "signal";
  const dotClass = isSignal
    ? (item.severity === "CRITICAL" ? TL_DOT.CRITICAL : TL_DOT.signal)
    : (TL_DOT[item.type] ?? TL_DOT.proxy);

  return (
    <div className="relative flex gap-3">
      {!isLast && (
        <div className="absolute left-[9px] top-5 bottom-0 w-px bg-border" />
      )}
      <div className="shrink-0 mt-1.5">
        <span className={`flex w-[18px] h-[18px] rounded-full border-2 ${dotClass}`} />
      </div>
      <div className="flex-1 pb-3 min-w-0">
        <div className="bg-surface border border-border rounded px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-sans text-xs text-text leading-snug flex-1">{item.label}</p>
            <span className="font-mono text-2xs text-muted shrink-0">
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
            </span>
          </div>
          <p className="font-mono text-2xs text-muted mt-1">
            {isSignal
              ? item.detail
              : `${item.id} · ${item.tokenTotal?.toLocaleString()} tok`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignalsPage() {
  const criticalCount = mockSignals.filter((s) => s.severity === "CRITICAL").length;
  const warningCount  = mockSignals.filter((s) => s.severity === "WARNING").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Signals</h1>
        <span className="font-mono text-2xs text-subtle">prod-code-refactor-v2</span>
        <span className="ml-auto font-mono text-2xs text-muted">
          {mockSignals.length} total · sorted by severity
        </span>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Signal list */}
        <div className="flex-1 overflow-auto">
          <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-surface">
            <span className="font-mono text-2xs text-muted uppercase tracking-widest">
              Detected signals
            </span>
            {criticalCount > 0 && (
              <span className="font-mono text-2xs bg-[#FF4D4D15] text-red border border-[#FF4D4D30] rounded px-1.5 py-px">
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span className="font-mono text-2xs bg-[#F5A62315] text-amber border border-[#F5A62330] rounded px-1.5 py-px">
                {warningCount} warning
              </span>
            )}
          </div>
          {mockSignals.map((s) => (
            <SignalItem key={s.id} signal={s} />
          ))}
        </div>

        {/* Mini timeline */}
        <div className="w-[320px] shrink-0 border-l border-border overflow-auto">
          <div className="px-4 py-2 border-b border-border bg-surface">
            <p className="font-mono text-2xs text-muted uppercase tracking-widest">
              Session timeline
            </p>
          </div>
          <div className="px-4 py-4">
            {mockTimelineFull.map((item, i) => (
              <MiniTimelineItem
                key={item.id}
                item={item}
                isLast={i === mockTimelineFull.length - 1}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
