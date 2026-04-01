export default function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
      {Icon && <Icon size={32} className="text-muted mb-4" strokeWidth={1.5} />}
      <p className="font-sans font-medium text-sm text-text mb-1">{title}</p>
      {subtitle && (
        <p className="font-sans text-xs text-subtle max-w-xs leading-relaxed">{subtitle}</p>
      )}
    </div>
  );
}
