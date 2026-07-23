interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive" | "warning" | "danger";
  icon?: React.ReactNode;
}

const toneClasses: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-slate-900 dark:text-white",
  positive: "text-felt-700 dark:text-felt-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
};

export function StatCard({ label, value, hint, tone = "default", icon }: StatCardProps) {
  return (
    <div className="card flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="section-title">{label}</span>
        {icon}
      </div>
      <span className={`text-2xl font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</span>
      {hint ? <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span> : null}
    </div>
  );
}
