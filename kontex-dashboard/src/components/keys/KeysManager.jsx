import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Copy, Check, KeyRound } from "lucide-react";
import EmptyState from "../shared/EmptyState";
import { useKeys, useCreateKey, useDeleteKey } from "../../hooks/useKontexAPI";

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
  const [label, setLabel]               = useState("");
  const [newKey, setNewKey]             = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);

  const { data: keys = [], isLoading } = useKeys();
  const createKey = useCreateKey();
  const deleteKey = useDeleteKey();

  function handleGenerate(e) {
    e.preventDefault();
    createKey.mutate(
      { label: label.trim() || undefined },
      {
        onSuccess: (data) => {
          setNewKey(data);
          setLabel("");
        },
      }
    );
  }

  function handleRevoke(id) {
    deleteKey.mutate(id, {
      onSuccess: () => setConfirmingId(null),
    });
  }

  const activeKeys = keys.filter((k) => k.active !== false);

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
      <form onSubmit={handleGenerate} className="flex items-center gap-3 mb-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="bg-surface border border-border rounded px-3 py-2 font-sans text-sm text-text placeholder:text-subtle focus:outline-none focus:border-teal transition-colors duration-150 w-56"
        />
        <button
          type="submit"
          disabled={createKey.isPending}
          className="px-4 py-2 bg-teal text-bg font-sans font-medium text-sm rounded hover:opacity-90 transition-opacity duration-150 disabled:opacity-40"
        >
          {createKey.isPending ? "Generating…" : "Generate Key"}
        </button>
      </form>

      {/* Inline create error */}
      {createKey.isError && (
        <p className="font-sans text-xs text-red mb-4">
          Failed to generate key. Try again.
        </p>
      )}

      {/* Keys table */}
      {isLoading ? (
        <p className="font-sans text-sm text-subtle py-4">Loading…</p>
      ) : activeKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys"
          subtitle="Generate one above to authenticate API requests."
        />
      ) : (
        <div className="border border-border rounded-md overflow-hidden mt-4">
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
