import { mockUsage } from "../../data/mock";

const STATS = [
  { key: "total_sessions",       label: "Total Sessions"        },
  { key: "active_sessions",      label: "Active Sessions"       },
  { key: "total_snapshots",      label: "Total Snapshots"       },
  { key: "total_tokens_stored",  label: "Tokens Stored"         },
  { key: "snapshots_this_month", label: "Snapshots This Month"  },
  { key: "tokens_this_month",    label: "Tokens This Month"     },
];

export default function UsageStats() {
  const data = mockUsage;

  return (
    <div className="flex bg-surface border-b border-border">
      {STATS.map((s, i) => (
        <div
          key={s.key}
          className={`flex flex-col justify-center px-6 py-3 flex-1 ${i < STATS.length - 1 ? "border-r border-border" : ""}`}
        >
          <span className="font-mono text-base text-text leading-tight">
            {data[s.key].toLocaleString()}
          </span>
          <span className="font-sans text-2xs uppercase tracking-widest text-subtle mt-1">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
