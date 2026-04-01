import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { SearchX, ServerOff } from "lucide-react";
import EmptyState from "../shared/EmptyState";

const SOURCE_CLASSES = {
  proxy:       "text-subtle border-muted",
  log_watcher: "text-amber border-amber",
  mcp:         "text-teal border-teal",
};

function SourceBadge({ source }) {
  const cls = SOURCE_CLASSES[source] ?? SOURCE_CLASSES.proxy;
  return (
    <span className={`inline-block font-mono text-2xs border rounded px-1.5 py-0.5 ${cls}`}>
      {source}
    </span>
  );
}

function ScoreBar({ score }) {
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
        <div
          className="h-1 bg-teal rounded-full"
          style={{ width: `${Math.round(score * 100)}%` }}
        />
      </div>
      <span className="font-mono text-2xs text-subtle w-8 text-right shrink-0">
        {score.toFixed(2)}
      </span>
    </div>
  );
}

export function SearchUnavailable() {
  return (
    <EmptyState
      icon={ServerOff}
      title="Semantic search not configured"
      subtitle="Qdrant or Voyage AI not set up"
    />
  );
}

export function SearchEmpty() {
  return (
    <EmptyState
      icon={SearchX}
      title="No results found"
      subtitle="Try different keywords"
    />
  );
}

export default function SearchResults({ results }) {
  const navigate = useNavigate();

  if (!results || results.length === 0) return <SearchEmpty />;

  return (
    <div className="divide-y divide-border">
      {results.map((r) => (
        <button
          key={r.snapshotId}
          onClick={() => navigate(`/session/${r.sessionId}`)}
          className="w-full text-left px-6 py-4 hover:bg-surface transition-colors duration-150 flex items-start gap-4"
        >
          {/* Score bar — left column */}
          <div className="shrink-0 w-24 pt-0.5">
            <ScoreBar score={r.score} />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-sans font-medium text-sm text-text truncate">
                {r.label}
              </span>
              <SourceBadge source={r.source} />
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xs text-subtle truncate">
                session/{r.sessionId}
              </span>
              <span className="text-muted text-2xs">·</span>
              <span className="font-mono text-2xs text-subtle truncate">
                task/{r.taskId}
              </span>
            </div>
          </div>

          {/* Timestamp — right column */}
          <span className="font-mono text-2xs text-subtle shrink-0 pt-0.5">
            {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
          </span>
        </button>
      ))}
    </div>
  );
}
