import { trpc } from "../api/trpc"

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
