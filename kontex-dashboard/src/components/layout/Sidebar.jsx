import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Home, Search, Settings } from "lucide-react";

const navItems = [
  { to: "/",        icon: Home,     label: "Sessions" },
  { to: "/search",  icon: Search,   label: "Search"   },
  { to: "/settings",icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      style={{ width: expanded ? "200px" : "56px" }}
      className="flex flex-col h-screen bg-surface border-r border-border shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out"
    >
      {/* Nav items */}
      <nav className="flex flex-col gap-1 pt-3 flex-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 px-4 py-2.5 mx-1 rounded transition-colors duration-150",
                "text-subtle hover:text-text hover:bg-border",
                isActive ? "text-teal border-l-2 border-teal bg-border" : "",
              ].join(" ")
            }
          >
            <Icon size={18} className="shrink-0" />
            <span
              className="font-sans text-sm whitespace-nowrap overflow-hidden transition-opacity duration-200"
              style={{ opacity: expanded ? 1 : 0 }}
            >
              {label}
            </span>
          </NavLink>
        ))}
      </nav>

      {/* Wordmark */}
      <div className="px-4 py-4 border-t border-border">
        <span
          className="font-mono text-xs text-subtle whitespace-nowrap overflow-hidden transition-opacity duration-200"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          kontex
        </span>
        <span
          className="font-mono text-xs text-teal block"
          style={{ opacity: expanded ? 0 : 1, marginTop: expanded ? 0 : 0 }}
        >
          k
        </span>
      </div>
    </aside>
  );
}
