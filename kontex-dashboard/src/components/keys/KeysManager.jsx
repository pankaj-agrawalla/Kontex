import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Check } from "lucide-react";
import { mockKeys } from "../../data/mock";

// Simulates POST /v1/keys — returns a fake key with value (only time it's shown)
function mockGenerateKey(label) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const rand = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return {
    id:        "key_" + Math.random().toString(36).slice(2, 7),
    key:       "kontex_" + rand,
    label:     label || null,
    createdAt: new Date().toISOString(),
    active:    true,
    lastUsed:  null,
  };
}

function NewKeyPanel({ keyValue, onDismiss }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(keyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border border-teal rounded-md bg-[#00E5CC08] p-4 mb-6">
      <p className="font-sans text-xs text-amber mb-3">
        Copy this key now. It will not be shown again.
      </p>
      <div className="flex items-center gap-2 bg-bg border border-border rounded px-3 py-2 mb-3">
        <code className="font-mono text-xs text-teal flex-1 break-all select-all">
          {keyValue}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 text-subtle hover:text-text transition-colors duration-150 ml-2"
          aria-label="Copy key"
        >
          {copied ? <Check size={14} className="text-teal" /> : <Copy size={14} />}
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="font-sans text-xs text-subtle hover:text-text transition-colors duration-150"
      >
        Dismiss
      </button>
    </div>
  );
}

function RevokeConfirm({ onConfirm, onCancel }) {
  return (
    <span className="inline-flex items-center gap-2 font-sans text-xs">
      <span className="text-subtle">Revoke this key?</span>
      <button
        onClick={onConfirm}
        className="text-red hover:opacity-80 transition-opacity duration-150"
      >
        Yes
      </button>
      <button
        onClick={onCancel}
        className="text-subtle hover:text-text transition-colors duration-150"
      >
        Cancel
      </button>
    </span>
  );
}

export default function KeysManager() {
  const [label, setLabel]             = useState("");
  const [newKey, setNewKey]           = useState(null);   // shown once after generation
  const [keys, setKeys]               = useState(mockKeys);
  const [confirmingId, setConfirmingId] = useState(null); // id being confirmed for revoke

  function handleGenerate(e) {
    e.preventDefault();
    const created = mockGenerateKey(label.trim());
    setNewKey(created);
    setLabel("");
    // Add to list without the key value (as the API would return in GET /v1/keys)
    setKeys((prev) => [
      { id: created.id, label: created.label, lastUsed: null, active: true, createdAt: created.createdAt },
      ...prev,
    ]);
  }

  function handleRevoke(id) {
    // Soft-delete: active: false (mirrors DELETE /v1/keys/:id)
    setKeys((prev) => prev.filter((k) => k.id !== id));
    setConfirmingId(null);
  }

  const activeKeys = keys.filter((k) => k.active);

  return (
    <div>
      {/* New key one-time display */}
      {newKey && (
        <NewKeyPanel
          keyValue={newKey.key}
          onDismiss={() => setNewKey(null)}
        />
      )}

      {/* Generate key form */}
      <form onSubmit={handleGenerate} className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="bg-surface border border-border rounded px-3 py-2 font-sans text-sm text-text placeholder:text-subtle focus:outline-none focus:border-teal transition-colors duration-150 w-56"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-teal text-bg font-sans font-medium text-sm rounded hover:opacity-90 transition-opacity duration-150"
        >
          Generate Key
        </button>
      </form>

      {/* Keys table */}
      {activeKeys.length === 0 ? (
        <p className="font-sans text-sm text-subtle">
          No API keys — generate one above
        </p>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-2 font-sans text-2xs uppercase tracking-wide text-subtle">Label</th>
                <th className="text-left px-4 py-2 font-sans text-2xs uppercase tracking-wide text-subtle">Last Used</th>
                <th className="text-left px-4 py-2 font-sans text-2xs uppercase tracking-wide text-subtle">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activeKeys.map((k) => (
                <tr key={k.id} className="hover:bg-surface transition-colors duration-150">
                  <td className="px-4 py-3 font-sans text-sm text-text">
                    {k.label ?? <span className="text-subtle italic">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">
                    {k.lastUsed
                      ? formatDistanceToNow(new Date(k.lastUsed), { addSuffix: true })
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">
                    {formatDistanceToNow(new Date(k.createdAt), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmingId === k.id ? (
                      <RevokeConfirm
                        onConfirm={() => handleRevoke(k.id)}
                        onCancel={() => setConfirmingId(null)}
                      />
                    ) : (
                      <button
                        onClick={() => setConfirmingId(k.id)}
                        className="font-sans text-xs border border-amber text-amber rounded px-2.5 py-1 hover:bg-[#F5A62310] transition-colors duration-150"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
