import { mockSessionsResponse, mockSignals } from "../../data/mock";

const totalSnapshots = mockSessionsResponse.data.reduce((s, x) => s + x.snapshotCount, 0);
const totalTokens    = mockSessionsResponse.data.reduce((s, x) => s + x.tokenTotal, 0);
const activeSignals  = mockSignals.length;

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

const CARDS = [
  {
    label:    "Total Sessions",
    value:    String(mockSessionsResponse.data.length),
    sub:      `${mockSessionsResponse.data.filter((s) => s.status === "ACTIVE").length} active`,
    subColor: "text-teal",
    accent:   "border-teal",
  },
  {
    label:    "Snapshots Captured",
    value:    totalSnapshots.toLocaleString(),
    sub:      "across all sessions",
    subColor: "text-subtle",
    accent:   "border-[#63B3ED]",
  },
  {
    label:    "Tokens Stored",
    value:    formatTokens(totalTokens),
    sub:      "total context captured",
    subColor: "text-subtle",
    accent:   "border-amber",
  },
  {
    label:    "Active Signals",
    value:    String(activeSignals),
    sub:      `${mockSignals.filter((s) => s.severity === "CRITICAL").length} critical`,
    subColor: activeSignals > 0 ? "text-red" : "text-subtle",
    accent:   "border-red",
  },
];

export default function StatCards() {
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
