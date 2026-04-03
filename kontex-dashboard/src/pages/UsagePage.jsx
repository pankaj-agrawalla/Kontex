import { useUsage } from "../hooks/useTrpc";

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return String(n);
}

const BAR_COLORS = ["bg-teal", "bg-[#63B3ED]", "bg-[#B794F4]", "bg-amber"];

function BarRow({ label, value, max, formattedValue, colorClass }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 mb-3 last:mb-0">
      <span className="font-mono text-xs text-subtle w-40 truncate shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${pct}%`, transition: "width 0.6s ease" }}
        />
      </div>
      <span className="font-mono text-xs text-subtle w-14 text-right shrink-0">{formattedValue}</span>
    </div>
  );
}

function UsageCard({ title, children }) {
  return (
    <div className="bg-surface border border-border rounded-md p-4">
      <p className="font-mono text-2xs text-muted uppercase tracking-widest mb-4">{title}</p>
      {children}
    </div>
  );
}

export default function UsagePage() {
  const { data: usage, isLoading } = useUsage();

  const bySession = usage?.by_session ?? [];
  const maxTokens    = bySession.length > 0 ? Math.max(...bySession.map((s) => s.tokens))    : 0;
  const maxSnapshots = bySession.length > 0 ? Math.max(...bySession.map((s) => s.snapshots)) : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Usage</h1>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {/* Top stat row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Total Snapshots",      value: isLoading ? "—" : (usage?.total_snapshots ?? 0).toLocaleString() },
            { label: "Tokens This Month",    value: isLoading ? "—" : formatTokens(usage?.tokens_this_month ?? 0)    },
            { label: "Snapshots This Month", value: isLoading ? "—" : (usage?.snapshots_this_month ?? 0).toLocaleString() },
          ].map((s) => (
            <div key={s.label} className="bg-surface border border-border rounded-md px-4 py-3">
              <p className="font-mono text-2xs text-muted uppercase tracking-widest mb-1">{s.label}</p>
              <p className="font-mono text-2xl font-semibold text-text">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Bar chart cards */}
        {bySession.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            <UsageCard title="Token usage by session">
              {bySession.map((s, i) => (
                <BarRow
                  key={s.sessionId}
                  label={s.name}
                  value={s.tokens}
                  max={maxTokens}
                  formattedValue={formatTokens(s.tokens)}
                  colorClass={BAR_COLORS[i % BAR_COLORS.length]}
                />
              ))}
            </UsageCard>

            <UsageCard title="Snapshots by session">
              {bySession.map((s, i) => (
                <BarRow
                  key={s.sessionId}
                  label={s.name}
                  value={s.snapshots}
                  max={maxSnapshots}
                  formattedValue={s.snapshots.toLocaleString()}
                  colorClass={BAR_COLORS[i % BAR_COLORS.length]}
                />
              ))}
            </UsageCard>
          </div>
        )}
      </div>
    </div>
  );
}
