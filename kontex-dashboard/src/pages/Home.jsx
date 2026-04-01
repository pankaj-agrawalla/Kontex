import SessionList from "../components/sessions/SessionList";

export default function Home() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border">
        <h1 className="font-sans text-base font-medium text-text">Sessions</h1>
      </div>
      <SessionList />
    </div>
  );
}
