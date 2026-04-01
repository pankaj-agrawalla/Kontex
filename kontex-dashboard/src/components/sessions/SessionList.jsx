import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { mockSessionsResponse } from "../../data/mock";
import StatusBadge from "./StatusBadge";

const FILTERS = [
  { label: "All",       value: null        },
  { label: "Active",    value: "ACTIVE"    },
  { label: "Paused",    value: "PAUSED"    },
  { label: "Completed", value: "COMPLETED" },
];

export default function SessionList() {
  const [activeFilter, setActiveFilter] = useState(null);

  const sessions = mockSessionsResponse.data.filter(
    (s) => activeFilter === null || s.status === activeFilter
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-border">
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
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              {["Status", "Name", "Description", "Last Updated", "Actions"].map((h) => (
                <th
                  key={h}
                  className="px-6 py-2.5 text-left font-sans font-normal text-subtle uppercase tracking-widest"
                  style={{ fontSize: "0.65rem" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center font-sans text-sm text-subtle">
                  No sessions match this filter.
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <SessionRow key={session.id} session={session} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionRow({ session }) {
  const isActive = session.status === "ACTIVE" || session.status === "PAUSED";

  return (
    <tr
      className="border-b border-border group transition-colors duration-150 hover:bg-surface"
      style={{ borderLeft: "2px solid transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderLeftColor = "#00E5CC")}
      onMouseLeave={(e) => (e.currentTarget.style.borderLeftColor = "transparent")}
    >
      {/* Status */}
      <td className="px-6 py-3">
        <StatusBadge status={session.status} />
      </td>

      {/* Name */}
      <td className="px-6 py-3 font-sans text-sm text-text">
        {session.name}
      </td>

      {/* Description */}
      <td className="px-6 py-3 font-sans text-sm text-subtle max-w-xs truncate">
        {session.description ?? <span className="text-muted">—</span>}
      </td>

      {/* Last Updated */}
      <td className="px-6 py-3 font-mono text-xs text-subtle whitespace-nowrap">
        {formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true })}
      </td>

      {/* Actions */}
      <td className="px-6 py-3">
        {isActive ? (
          <Link
            to={`/session/${session.id}`}
            className="font-sans text-xs text-teal hover:underline whitespace-nowrap"
          >
            Open →
          </Link>
        ) : (
          <Link
            to={`/session/${session.id}`}
            className="font-sans text-xs text-subtle hover:text-text whitespace-nowrap"
          >
            View
          </Link>
        )}
      </td>
    </tr>
  );
}
