import SessionList from "../components/sessions/SessionList";
import StatCards from "../components/sessions/StatCards";

export default function Home() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Sessions</h1>
      </div>
      <StatCards />
      <SessionList />
    </div>
  );
}
