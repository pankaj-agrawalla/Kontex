import { NavLink } from "react-router-dom";
import { Layers, BarChart3, AlertTriangle, History, GitCompare, Search, Settings } from "lucide-react";
import { useSessions } from "../../hooks/useTrpc";

function NavItem({ to, icon: Icon, label, badge, badgeVariant }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        [
          "relative flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors duration-150",
          isActive
            ? "bg-[#00E5CC15] text-teal"
            : "text-subtle hover:text-text hover:bg-border",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-teal rounded-r" />
          )}
          <Icon size={15} className="shrink-0" />
          <span className="font-sans flex-1 truncate">{label}</span>
          {badge && (
            <span
              className={[
                "font-mono text-2xs px-1.5 py-0.5 rounded",
                badgeVariant === "warn"
                  ? "bg-[#F5A62318] text-amber"
                  : "bg-border text-subtle",
              ].join(" ")}
            >
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { data: sessionsData } = useSessions();
  const totalSessions = sessionsData?.data?.length ?? 0;

  const NAV = [
    {
      section: "Overview",
      items: [
        { to: "/",       icon: Layers,        label: "Sessions",        badge: String(totalSessions), badgeVariant: "neutral" },
        { to: "/usage",  icon: BarChart3,     label: "Usage",           badge: null },
      ],
    },
    {
      section: "Diagnostics",
      items: [
        { to: "/signals",  icon: AlertTriangle, label: "Signals",       badge: null, badgeVariant: "warn" },
        { to: "/timeline", icon: History,       label: "Timeline",      badge: null },
        { to: "/diff",     icon: GitCompare,    label: "Diff view",     badge: null },
      ],
    },
    {
      section: "Search",
      items: [
        { to: "/search", icon: Search, label: "Semantic search", badge: null },
      ],
    },
  ];

  return (
    <aside className="flex flex-col h-screen w-[220px] shrink-0 bg-surface border-r border-border overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
        <div className="w-[26px] h-[26px] rounded bg-teal flex items-center justify-center shrink-0">
          <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
            <rect x="1" y="1" width="5" height="5" rx="1" fill="#0A0A0B" />
            <rect x="8" y="1" width="5" height="5" rx="1" fill="#0A0A0B" />
            <rect x="1" y="8" width="5" height="5" rx="1" fill="#0A0A0B" />
            <rect x="8" y="8" width="5" height="5" rx="1" fill="#0A0A0B" opacity="0.4" />
          </svg>
        </div>
        <div>
          <p className="font-mono text-sm font-semibold text-text leading-none">kontex</p>
          <span className="font-mono text-2xs text-teal bg-[#00E5CC18] border border-[#00E5CC30] rounded px-1 py-px mt-0.5 inline-block">
            v0.1.0
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-4">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="font-mono text-2xs text-muted uppercase tracking-widest px-2 mb-1">
              {group.section}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — active API key + settings */}
      <div className="border-t border-border p-3 flex flex-col gap-2">
        <div className="bg-bg border border-border rounded px-3 py-2">
          <p className="font-mono text-2xs text-muted uppercase tracking-widest mb-1">API Key</p>
          <p className="font-mono text-xs text-subtle">kontex_••••••••a3f2</p>
        </div>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [
              "flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors duration-150",
              isActive ? "text-teal bg-[#00E5CC15]" : "text-subtle hover:text-text hover:bg-border",
            ].join(" ")
          }
        >
          <Settings size={14} className="shrink-0" />
          <span className="font-sans">Settings</span>
        </NavLink>
      </div>
    </aside>
  );
}
