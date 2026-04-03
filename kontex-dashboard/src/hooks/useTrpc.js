import { trpc } from "../api/trpc"
import { useQueryClient } from "@tanstack/react-query"

// ── Sessions ──────────────────────────────────────────────────────────────────

export function useSessions(status = null) {
  return trpc.sessions.list.useQuery(
    { status },
    { queryKey: ["sessions", status] }
  )
}

export function useSession(sessionId) {
  return trpc.sessions.byId.useQuery(
    { id: sessionId },
    { enabled: !!sessionId, queryKey: ["session", sessionId] }
  )
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export function useUsage() {
  return trpc.dashboard.usage.useQuery(
    undefined,
    { queryKey: ["usage"], staleTime: 60_000 }
  )
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export function useTimeline(sessionId) {
  return trpc.dashboard.timeline.useQuery(
    { sessionId },
    { enabled: !!sessionId, queryKey: ["timeline", sessionId] }
  )
}

export function useSnapshotBundle(snapshotId) {
  return trpc.snapshots.bundle.useQuery(
    { id: snapshotId },
    { enabled: !!snapshotId, queryKey: ["bundle", snapshotId] }
  )
}

export function useSnapshot(snapshotId) {
  return trpc.snapshots.byId.useQuery(
    { id: snapshotId },
    { enabled: !!snapshotId, queryKey: ["snapshot", snapshotId] }
  )
}

// ── Rollback + Diff ───────────────────────────────────────────────────────────

export function useRollback(sessionId) {
  const queryClient = useQueryClient()
  return trpc.snapshots.rollback.useMutation({
    onSuccess: (data) => {
      queryClient.setQueryData(["timeline", sessionId], (old) => {
        if (!old) return old
        return [...old, {
          id: data.rollback_snapshot_id,
          label: data.label,
          tokenTotal: data.token_total,
          source: "proxy",
          createdAt: data.captured_at,
        }]
      })
      queryClient.invalidateQueries({ queryKey: ["timeline", sessionId] })
    },
  })
}

export function useDiff(sessionId, fromId, toId) {
  return trpc.dashboard.diff.useQuery(
    { sessionId, from: fromId, to: toId },
    {
      enabled: !!sessionId && !!fromId && !!toId,
      queryKey: ["diff", sessionId, fromId, toId],
    }
  )
}

export function useGraph(sessionId) {
  return trpc.dashboard.graph.useQuery(
    { sessionId },
    { enabled: !!sessionId, queryKey: ["graph", sessionId] }
  )
}
