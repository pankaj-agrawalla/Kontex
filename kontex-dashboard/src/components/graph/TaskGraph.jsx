import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GitGraph } from "lucide-react";
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import { mockGraph } from "../../data/mock";
import EmptyState from "../shared/EmptyState";

// Status → Tailwind class mappings
const STATUS_CLASSES = {
  COMPLETED: {
    wrapper: "border-teal",
    bg:      "bg-[#00E5CC10]",
    badge:   "text-teal",
    pulse:   false,
  },
  ACTIVE: {
    wrapper: "border-amber",
    bg:      "bg-[#F5A62310]",
    badge:   "text-amber",
    pulse:   true,
  },
  PENDING: {
    wrapper: "border-muted",
    bg:      "bg-transparent",
    badge:   "text-subtle",
    pulse:   false,
  },
  FAILED: {
    wrapper: "border-red",
    bg:      "bg-[#FF4D4D10]",
    badge:   "text-red",
    pulse:   false,
  },
};

function TaskNode({ data, selected }) {
  const s = STATUS_CLASSES[data.status] ?? STATUS_CLASSES.PENDING;

  return (
    <div
      className={[
        "relative rounded-md border p-3",
        selected ? "border-teal" : s.wrapper,
        s.bg,
      ].join(" ")}
      style={{ width: 200 }}
    >
      {/* Pulse ring for ACTIVE */}
      {s.pulse && (
        <div
          className={[
            "kontex-pulse-ring pointer-events-none absolute -inset-1 rounded-md border",
            s.wrapper,
          ].join(" ")}
        />
      )}

      {/* Task name */}
      <p className="font-sans font-medium text-sm text-text leading-tight mb-2">
        {data.label}
      </p>

      {/* Status badge */}
      <span className={`font-mono text-2xs uppercase tracking-wide ${s.badge}`}>
        {data.status}
      </span>

      {/* Token total */}
      {data.tokenTotal > 0 && (
        <p className="font-mono text-2xs text-subtle mt-1">
          {data.tokenTotal.toLocaleString()} tokens
        </p>
      )}

      {/* Snapshot count */}
      {data.snapshotCount > 0 && (
        <p className="font-mono text-2xs text-subtle">
          {data.snapshotCount} snapshot{data.snapshotCount !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

const nodeTypes = { taskNode: TaskNode };

const defaultEdgeOptions = {
  style: { stroke: "#3A3A42", strokeWidth: 1.5 },
};

export default function TaskGraph({ sessionId }) {
  const navigate = useNavigate();

  if (mockGraph.nodes.length === 0) {
    return (
      <EmptyState
        icon={GitGraph}
        title="No tasks yet"
        subtitle="Tasks will appear here as the agent works through the session."
      />
    );
  }

  const initialNodes = mockGraph.nodes.map((n) => ({
    ...n,
    type: "taskNode",
  }));

  const initialEdges = mockGraph.edges.map((e) => ({
    ...e,
    style: { stroke: "#3A3A42", strokeWidth: 1.5 },
  }));

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onNodeClick = useCallback(() => {
    if (sessionId) {
      navigate(`/session/${sessionId}`);
    }
  }, [navigate, sessionId]);

  return (
    <div className="w-full h-full bg-bg">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={onNodeClick}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#1E1E22"
          style={{ background: "#0A0A0B" }}
        />
        <Controls showFitView={false} showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
