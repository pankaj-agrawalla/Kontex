import KeysManager from "../components/keys/KeysManager";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-sans font-medium text-base text-text">Settings</h1>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6 max-w-3xl">
        <section>
          <h2 className="font-sans font-medium text-sm text-text mb-1">API Keys</h2>
          <p className="font-sans text-xs text-subtle mb-5">
            Keys authenticate requests to the Kontex API. A key is shown only once at creation.
          </p>
          <KeysManager />
        </section>
      </div>
    </div>
  );
}
