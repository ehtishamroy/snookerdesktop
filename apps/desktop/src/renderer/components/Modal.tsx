import type { ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  width = "max-w-2xl",
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-6 backdrop-blur-sm">
      <div className={`card my-8 w-full ${width} p-6`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold">{title}</h2>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-full p-2 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
            >
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
