import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../api/client"

// ── Search ────────────────────────────────────────────────────────────────────

export function useSearch(q, sessionId = null) {
  const params = new URLSearchParams({ q })
  if (sessionId) params.set("session_id", sessionId)
  return useQuery({
    queryKey: ["search", q, sessionId],
    queryFn: () => apiFetch(`/v1/search?${params}`),
    enabled: !!q && q.trim().length > 0,
    retry: (count, err) => {
      // Do not retry 503 (search unavailable)
      if (err?.status === 503) return false
      return count < 1
    },
  })
}

// ── API Keys ──────────────────────────────────────────────────────────────────

export function useKeys() {
  return useQuery({
    queryKey: ["keys"],
    queryFn: () => apiFetch("/v1/keys"),
  })
}

export function useCreateKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ label }) => apiFetch("/v1/keys", { method: "POST", body: { label } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
  })
}

export function useDeleteKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id) => apiFetch(`/v1/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keys"] }),
  })
}
