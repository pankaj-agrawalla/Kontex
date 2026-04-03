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
