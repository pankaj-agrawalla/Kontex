import SessionList from "../components/sessions/SessionList";
import UsageStats from "../components/usage/UsageStats";

export default function Home() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="font-sans text-base font-medium text-text">Sessions</h1>
      </div>
      <UsageStats />
      <SessionList />
    </div>
  );
}
