import { useSearchParams } from "react-router-dom";
import TaskGraph from "../components/graph/TaskGraph";
import { useGraph } from "../hooks/useTrpc";

export default function TaskGraphPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId");
  const { data: graph, isLoading, isError } = useGraph(sessionId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Task Graph</h1>
        <span className="font-mono text-2xs text-subtle ml-auto">{sessionId}</span>
      </div>
      <div className="flex-1">
        <TaskGraph
          nodes={graph?.nodes ?? []}
          edges={graph?.edges ?? []}
          isLoading={isLoading}
          sessionId={sessionId}
        />
      </div>
    </div>
  );
}
