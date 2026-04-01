import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import Home from "./pages/Home";
import SessionDetailPage from "./pages/SessionDetailPage";
import TaskGraphPage from "./pages/TaskGraphPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import SignalsPage from "./pages/SignalsPage";
import TimelinePage from "./pages/TimelinePage";
import DiffPage from "./pages/DiffPage";
import UsagePage from "./pages/UsagePage";

function Layout({ children }) {
  const { pathname } = useLocation();
  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <main key={pathname} className="flex-1 overflow-auto kontex-fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"            element={<Home />} />
          <Route path="/session/:id" element={<SessionDetailPage />} />
          <Route path="/graph"       element={<TaskGraphPage />} />
          <Route path="/search"      element={<SearchPage />} />
          <Route path="/settings"    element={<SettingsPage />} />
          <Route path="/signals"     element={<SignalsPage />} />
          <Route path="/timeline"    element={<TimelinePage />} />
          <Route path="/diff"        element={<DiffPage />} />
          <Route path="/usage"       element={<UsagePage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
