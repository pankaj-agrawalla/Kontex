import { useState } from "react";
import { X, FileCode } from "lucide-react";
import { mockDiff, mockTimeline } from "../../data/mock";
import { useUiStore } from "../../store/ui";
import { useSessionsStore } from "../../store/sessions";

function formatDelta(delta) {
  if (delta >= 0) return `+${delta.toLocaleString()}`;
  return `−${Math.abs(delta).toLocaleString()}`;
}

export default function RollbackDrawer() {
  const open         = useUiStore((s) => s.rollbackDrawerOpen);
  const closeRollback = useUiStore((s) => s.closeRollback);

  const activeSnapshotId  = useSessionsStore((s) => s.activeSnapshotId);
  const timelineSnapshots = useSessionsStore((s) => s.timelineSnapshots);
  const activeSessionId   = useSessionsStore((s) => s.activeSessionId);
  const addSnapshot       = useSessionsStore((s) => s.addSnapshot);

  const [confirming, setConfirming] = useState(false);
  const [done, setDone]             = useState(false);

  const snapshots     = timelineSnapshots[activeSessionId ?? "sess_01"] ?? [];
  const targetSnapshot = snapshots.find((s) => s.id === activeSnapshotId)
    ?? mockTimeline.find((s) => s.id === activeSnapshotId);

  // In production: useDiff(sessionId, latestId, activeSnapshotId)
  const diff = mockDiff;

  function handleConfirm() {
    setConfirming(true);
    setTimeout(() => {
      // Append rollback snapshot — never removes existing ones
      addSnapshot({
        id:           `snap_rollback_${Date.now()}`,
        label:        `Rollback to: ${targetSnapshot?.label ?? activeSnapshotId}`,
        taskId:       targetSnapshot?.taskId ?? null,
        taskName:     targetSnapshot?.taskName ?? null,
        source:       "mcp",
        enriched:     false,
        tokenTotal:   targetSnapshot?.tokenTotal ?? 0,
        tokenDelta:   0,
        createdAt:    new Date().toISOString(),
      });
      setConfirming(false);
      setDone(true);
      setTimeout(() => {
        setDone(false);
        closeRollback();
      }, 1200);
    }, 800);
  }

  function handleClose() {
    setConfirming(false);
    setDone(false);
    closeRollback();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-200"
        style={{
          backgroundColor: "rgba(10,10,11,0.80)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 z-50 h-full w-[380px] bg-surface border-l border-border flex flex-col transition-transform duration-250 ease-in-out"
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
        role="dialog"
        aria-modal="true"
        aria-label="Restore Checkpoint"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-sans font-medium text-sm text-text">
            Restore Checkpoint
          </h2>
          <button
            onClick={handleClose}
            className="text-subtle hover:text-text transition-colors duration-150"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-5">
          {/* Restoring to */}
          <div>
            <p className="font-sans text-2xs text-subtle uppercase tracking-widest mb-1">
              Restoring to
            </p>
            <p className="font-sans text-sm text-text">
              {targetSnapshot?.label ?? activeSnapshotId ?? "—"}
            </p>
            {targetSnapshot?.taskName && (
              <p className="font-sans text-2xs text-subtle mt-0.5">
                {targetSnapshot.taskName}
              </p>
            )}
          </div>

          {/* Files added */}
          {diff.added.length > 0 && (
            <div>
              <p
                className="font-sans text-2xs text-subtle uppercase tracking-widest mb-2"
>
                Files added in this restore
              </p>
              <div className="flex flex-col gap-1">
                {diff.added.map((path) => (
                  <div
                    key={path}
                    className="flex items-center gap-2 pl-3 py-1.5 border-l-2 border-green bg-green/5"
                  >
                    <FileCode size={11} className="text-green shrink-0" />
                    <span className="font-mono text-xs text-text truncate">{path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files removed */}
          {diff.removed.length > 0 && (
            <div>
              <p
                className="font-sans text-2xs text-subtle uppercase tracking-widest mb-2"
>
                Files removed from current context
              </p>
              <div className="flex flex-col gap-1">
                {diff.removed.map((path) => (
                  <div
                    key={path}
                    className="flex items-center gap-2 pl-3 py-1.5 border-l-2 border-red bg-red/5"
                  >
                    <FileCode size={11} className="text-red shrink-0" />
                    <span className="font-mono text-xs text-text truncate">{path}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No changes */}
          {diff.added.length === 0 && diff.removed.length === 0 && (
            <p className="font-sans text-xs text-subtle">No file changes between checkpoints.</p>
          )}

          {/* Token delta */}
          <div>
            <p className="font-sans text-2xs text-subtle uppercase tracking-widest mb-1">
              Token delta
            </p>
            <p className="font-mono text-2xl text-amber font-medium">
              {formatDelta(diff.token_delta)}
              <span className="text-sm ml-1.5">tokens</span>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              disabled={confirming}
              className="flex-1 py-2 font-sans text-xs border border-border text-subtle rounded hover:text-text hover:border-muted transition-colors duration-150 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirming || done}
              className="flex-1 py-2 font-sans text-xs font-bold bg-amber text-bg rounded hover:opacity-90 transition-opacity duration-150 disabled:opacity-60"
            >
              {done ? "Restored ✓" : confirming ? "Restoring…" : "Confirm Rollback"}
            </button>
          </div>
          <p className="font-sans text-2xs text-subtle leading-relaxed">
            This creates a new snapshot restoring the selected checkpoint state.
            Original history is preserved.
          </p>
        </div>
      </div>
    </>
  );
}
