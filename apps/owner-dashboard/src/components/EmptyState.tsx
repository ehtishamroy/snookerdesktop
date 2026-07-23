export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 py-10 text-center">
      <div className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</div>
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}
