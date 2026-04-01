import { useLocation } from "react-router-dom";
import { mockUsage } from "../../data/mock";

const breadcrumbs = {
  "/":        "Sessions",
  "/search":  "Search",
  "/settings":"Settings",
  "/graph":   "Task Graph",
};

function getBreadcrumb(pathname) {
  if (pathname.startsWith("/session/")) return "Session Detail";
  return breadcrumbs[pathname] ?? "Kontex";
}

export default function TopBar() {
  const { pathname } = useLocation();

  return (
    <header className="flex items-center justify-between px-5 h-10 bg-bg border-b border-border shrink-0">
      <span className="font-sans text-sm text-subtle">
        {getBreadcrumb(pathname)}
      </span>
      <span className="font-mono text-xs text-subtle">
        {mockUsage.total_tokens_stored.toLocaleString()} tokens
      </span>
    </header>
  );
}
