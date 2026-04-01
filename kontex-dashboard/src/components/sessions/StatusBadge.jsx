const config = {
  ACTIVE:    { dot: "bg-teal",   text: "text-teal",   label: "Active"    },
  PAUSED:    { dot: "bg-amber",  text: "text-amber",  label: "Paused"    },
  COMPLETED: { dot: "bg-subtle", text: "text-subtle", label: "Completed" },
  PENDING:   { dot: "bg-subtle", text: "text-subtle", label: "Pending"   },
  FAILED:    { dot: "bg-red",    text: "text-red",    label: "Failed"    },
};

export default function StatusBadge({ status }) {
  const c = config[status] ?? config.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 font-sans text-xs ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  );
}
