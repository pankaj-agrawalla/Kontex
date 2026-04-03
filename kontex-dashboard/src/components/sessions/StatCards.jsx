import { useUsage, useSessions } from "../../hooks/useTrpc";

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

export default function StatCards() {
  const { data: usage } = useUsage();
  const { data: sessionsData } = useSessions();
  const sessions = sessionsData?.data ?? [];

  const totalSignals = sessions.reduce((n, s) =>
    n + (s.signals?.critical ?? 0) + (s.signals?.warning ?? 0), 0);

  const CARDS = [
    {
      label:    "Total Sessions",
      value:    usage?.total_sessions?.toLocaleString() ?? "—",
      sub:      usage ? `${usage.active_sessions} active` : "—",
      subColor: "text-teal",
      accent:   "border-teal",
    },
    {
      label:    "Snapshots Captured",
      value:    usage?.total_snapshots?.toLocaleString() ?? "—",
      sub:      "across all sessions",
      subColor: "text-subtle",
      accent:   "border-[#63B3ED]",
    },
    {
      label:    "Tokens Stored",
      value:    usage ? formatTokens(usage.total_tokens_stored) : "—",
      sub:      "total context captured",
      subColor: "text-subtle",
      accent:   "border-amber",
    },
    {
      label:    "Active Signals",
      value:    String(totalSignals),
      sub:      totalSignals > 0 ? `${totalSignals} total` : "none",
      subColor: totalSignals > 0 ? "text-red" : "text-subtle",
      accent:   "border-red",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-border shrink-0">
      {CARDS.map((c) => (
        <div
          key={c.label}
          className={`bg-surface border border-border border-t-2 ${c.accent} rounded-md px-4 py-3`}
        >
          <p className="font-mono text-2xs text-muted uppercase tracking-widest mb-2">{c.label}</p>
          <p className="font-mono text-2xl font-semibold text-text leading-none mb-1">{c.value}</p>
          <p className={`font-sans text-xs ${c.subColor}`}>{c.sub}</p>
        </div>
      ))}
    </div>
  );
}
