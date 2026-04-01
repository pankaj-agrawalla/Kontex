// Stub — built in Sprint 3 (Prompt 3.1)
export default function RollbackDrawer({ open, onClose, snapshot }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-bg/80" onClick={onClose} />
      <div className="relative w-96 h-full bg-surface border-l border-border p-6 flex flex-col">
        <p className="font-sans text-sm text-subtle">
          Rollback drawer — Sprint 3
        </p>
        <button onClick={onClose} className="mt-4 text-xs text-subtle hover:text-text">
          Close
        </button>
      </div>
    </div>
  );
}
