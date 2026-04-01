import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { mockSession } from "../../data/mock";
import StatusBadge from "../sessions/StatusBadge";
import SnapshotTimeline from "./SnapshotTimeline";
import ContextInspector from "./ContextInspector";
import RollbackDrawer from "../rollback/RollbackDrawer";

export default function SessionDetail() {
  const navigate = useNavigate();
  const session  = mockSession;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="text-subtle hover:text-text transition-colors duration-150"
          aria-label="Go back"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="font-sans font-medium text-base text-text">
          {session.name}
        </h1>
        <StatusBadge status={session.status} />
        {session.taskCount !== undefined && (
          <span className="font-mono text-2xs text-subtle ml-auto">
            {session.taskCount} task{session.taskCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Timeline */}
        <div className="w-[280px] shrink-0 border-r border-border overflow-hidden">
          <SnapshotTimeline />
        </div>

        {/* Right — Inspector */}
        <div className="flex-1 overflow-hidden">
          <ContextInspector />
        </div>
      </div>

      {/* Rollback drawer */}
      <RollbackDrawer />
    </div>
  );
}
