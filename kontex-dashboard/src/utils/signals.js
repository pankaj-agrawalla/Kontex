/**
 * Derive signal entries from a timeline snapshot list.
 * timeline: TimelineEntry[] from trpc/dashboard.timeline
 * Returns: Signal[]
 */
export function computeSignals(timeline) {
  const signals = []

  for (let i = 1; i < timeline.length; i++) {
    const entry = timeline[i]
    const prev = timeline[i - 1]
    const tokenDelta = entry.tokenTotal - prev.tokenTotal

    // context_bloat: token delta > 5000 in one snapshot
    if (tokenDelta > 5_000) {
      signals.push({
        id: `bloat_${entry.id}`,
        type: "context_bloat",
        severity: "warning",
        snapshotId: entry.id,
        label: entry.label,
        createdAt: entry.createdAt,
        detail: `+${tokenDelta.toLocaleString()} tokens`,
      })
    }

    // context_limit_proximity: tokenTotal > 80,000
    if (entry.tokenTotal > 80_000) {
      signals.push({
        id: `limit_${entry.id}`,
        type: "context_limit_proximity",
        severity: "critical",
        snapshotId: entry.id,
        label: entry.label,
        createdAt: entry.createdAt,
        detail: `${entry.tokenTotal.toLocaleString()} tokens`,
      })
    }
  }

  // retry_storm: same tool called 3+ times in a window
  // NOTE: this requires toolCalls data from the bundle — if not available in timeline entries,
  // skip this signal type rather than crashing. It is optional.

  return signals
}
