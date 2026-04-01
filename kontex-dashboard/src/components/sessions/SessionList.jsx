import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Layers } from "lucide-react";
import { mockSessionsResponse } from "../../data/mock";
import StatusBadge from "./StatusBadge";
import EmptyState from "../shared/EmptyState";

const FILTERS = [
  { label: "All",       value: null        },
  { label: "Active",    value: "ACTIVE"    },
  { label: "Paused",    value: "PAUSED"    },
  { label: "Completed", value: "COMPLETED" },
];

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border animate-pulse">
      <td className="px-5 py-3"><div className="h-3 w-32 rounded bg-[#1E1E22]" /></td>
      <td className="px-5 py-3"><div className="h-3 w-14 rounded bg-[#1E1E22]" /></td>
      <td className="px-5 py-3"><div className="h-3 w-10 rounded bg-[#1E1E22]" /></td>
      <td className="px-5 py-3"><div className="h-3 w-12 rounded bg-[#1E1E22]" /></td>
      <td className="px-5 py-3"><div className="h-3 w-16 rounded bg-[#1E1E22]" /></td>
      <td className="px-5 py-3"><div className="h-3 w-10 rounded bg-[#1E1E22]" /></td>
    </tr>
  );
}

export default function SessionList() {
  const [activeFilter, setActiveFilter] = useState(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const sessions = mockSessionsResponse.data.filter(
    (s) => activeFilter === null || s.status === activeFilter
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-border shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setActiveFilter(f.value)}
            className={[
              "px-3 py-1 font-sans text-xs rounded transition-colors duration-150",
              activeFilter === f.value
                ? "bg-border text-text"
                : "text-subtle hover:text-text",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {!loading && sessions.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No sessions match this filter"
            subtitle="Try a different status filter or create a new session via the API."
          />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-surface">
                {["Session", "Status", "Snapshots", "Tokens", "Signals", ""].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-2 text-left font-mono text-2xs uppercase tracking-widest text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? [0, 1, 2].map((i) => <SkeletonRow key={i} />)
                : sessions.map((s) => <SessionRow key={s.id} session={s} />)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SignalsBadges({ signals }) {
  if (!signals || (signals.critical === 0 && signals.warning === 0)) {
    return <span className="font-mono text-2xs text-muted">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {signals.critical > 0 && (
        <span className="font-mono text-2xs bg-[#FF4D4D15] text-red border border-[#FF4D4D30] rounded px-1.5 py-px">
          {signals.critical} crit
        </span>
      )}
      {signals.warning > 0 && (
        <span className="font-mono text-2xs bg-[#F5A62315] text-amber border border-[#F5A62330] rounded px-1.5 py-px">
          {signals.warning} warn
        </span>
      )}
    </span>
  );
}

function SessionRow({ session }) {
  const isActive = session.status === "ACTIVE";

  return (
    <tr
      className="border-b border-border transition-colors duration-150 hover:bg-surface"
      style={{ borderLeft: "2px solid transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderLeftColor = "#00E5CC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderLeftColor = "transparent")}
    >
      {/* Session name + ID */}
      <td className="px-5 py-3">
        <p className="font-sans font-medium text-sm text-text flex items-center gap-2">
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal shrink-0 animate-pulse" />
          )}
          {session.name}
        </p>
        <p className="font-mono text-2xs text-muted mt-0.5">{session.id}</p>
      </td>

      {/* Status */}
      <td className="px-5 py-3">
        <StatusBadge status={session.status} />
      </td>

      {/* Snapshots */}
      <td className="px-5 py-3 font-mono text-xs text-subtle">
        {session.snapshotCount?.toLocaleString() ?? "—"}
      </td>

      {/* Tokens */}
      <td className="px-5 py-3 font-mono text-xs text-subtle">
        {session.tokenTotal != null ? formatTokens(session.tokenTotal) : "—"}
      </td>

      {/* Signals */}
      <td className="px-5 py-3">
        <SignalsBadges signals={session.signals} />
      </td>

      {/* Action */}
      <td className="px-5 py-3">
        <Link
          to={`/session/${session.id}`}
          className={[
            "font-mono text-xs border rounded px-2.5 py-1 transition-colors duration-150 whitespace-nowrap",
            isActive
              ? "border-[#00E5CC40] text-teal hover:bg-[#00E5CC10]"
              : "border-border text-muted hover:border-muted hover:text-subtle",
          ].join(" ")}
        >
          View →
        </Link>
      </td>
    </tr>
  );
}
