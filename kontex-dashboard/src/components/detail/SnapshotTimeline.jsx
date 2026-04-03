import { formatDistanceToNow } from "date-fns";
import { useSessionsStore } from "../../store/sessions";
import { useUiStore } from "../../store/ui";
import { useTimeline } from "../../hooks/useTrpc";

const SOURCE_STYLES = {
  proxy:       { bg: "bg-teal/10",   text: "text-teal",   label: "proxy"       },
  log_watcher: { bg: "bg-amber/10",  text: "text-amber",  label: "log_watcher" },
  mcp:         { bg: "bg-muted/20",  text: "text-subtle", label: "mcp"         },
};

function SourceBadge({ source }) {
  const s = SOURCE_STYLES[source] ?? SOURCE_STYLES.proxy;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded font-mono text-2xs ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function formatDelta(index, item) {
  const val = index === 0 ? item.tokenTotal : item.tokenDelta;
  const sign = index === 0 ? "" : "+";
  return `${sign}${val.toLocaleString()} tokens`;
}

export default function SnapshotTimeline() {
  const activeSessionId  = useSessionsStore((s) => s.activeSessionId);
  const activeSnapshotId = useSessionsStore((s) => s.activeSnapshotId);
  const setActiveSnapshot = useSessionsStore((s) => s.setActiveSnapshot);
  const openRollback      = useUiStore((s) => s.openRollback);

  const { data: timeline = [], isLoading } = useTimeline(activeSessionId);

  const lastId      = timeline[timeline.length - 1]?.id;
  const canRollback = activeSnapshotId && activeSnapshotId !== lastId;

  if (isLoading) {
    return (
      <div className="p-4 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 bg-muted rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-4 py-4">
        {timeline.map((snap, index) => {
          const isSelected = snap.id === activeSnapshotId;
          const isLast = index === timeline.length - 1;

          return (
            <div key={snap.id} className="relative flex gap-3">
              {/* Connector line */}
              {!isLast && (
                <div className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />
              )}

              {/* Circle */}
              <button
                onClick={() => setActiveSnapshot(snap.id)}
                className="relative z-10 mt-1 shrink-0 focus:outline-none"
                aria-label={`Select snapshot: ${snap.label}`}
              >
                <span
                  className={[
                    "flex w-3.5 h-3.5 rounded-full border transition-colors duration-150",
                    isSelected
                      ? "bg-teal border-teal"
                      : "bg-bg border-teal hover:bg-teal/20",
                  ].join(" ")}
                />
              </button>

              {/* Content */}
              <div
                className="flex-1 pb-5 cursor-pointer"
                onClick={() => setActiveSnapshot(snap.id)}
              >
                {/* Label + enriched dot */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`font-sans text-sm leading-tight ${
                      isSelected ? "text-text" : "text-subtle hover:text-text"
                    } transition-colors duration-150`}
                  >
                    {snap.label}
                  </span>
                  {snap.enriched && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber shrink-0"
                      title="Enriched by log watcher"
                    />
                  )}
                </div>

                {/* Task name */}
                <p className="font-sans text-2xs text-subtle mt-0.5">{snap.taskName}</p>

                {/* Source badge + timestamp */}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <SourceBadge source={snap.source} />
                  <span className="font-mono text-2xs text-subtle">
                    {formatDistanceToNow(new Date(snap.createdAt), { addSuffix: true })}
                  </span>
                </div>

                {/* Token delta */}
                <p className="font-mono text-2xs text-amber mt-1">
                  {formatDelta(index, snap)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Rollback button */}
      <div className="px-4 py-3 border-t border-border">
        <button
          onClick={() => canRollback && openRollback()}
          disabled={!canRollback}
          className={[
            "w-full py-1.5 font-sans text-xs border rounded transition-colors duration-150",
            canRollback
              ? "border-amber text-amber hover:bg-amber/10 cursor-pointer"
              : "border-muted text-muted cursor-not-allowed",
          ].join(" ")}
        >
          Rollback to checkpoint
        </button>
      </div>
    </div>
  );
}
