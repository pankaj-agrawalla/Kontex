import { BrowserRouter, Routes, Route } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import Home from "./pages/Home";
import SessionDetailPage from "./pages/SessionDetailPage";
import TaskGraphPage from "./pages/TaskGraphPage";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";

function Layout({ children }) {
  return (
    <div className="flex h-screen bg-bg overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
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
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
