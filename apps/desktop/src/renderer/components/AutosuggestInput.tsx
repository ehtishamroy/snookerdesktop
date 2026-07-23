import { useEffect, useRef, useState } from "react";

export interface AutosuggestSuggestion {
  id: number;
  label: string;
  /** Rendered as an "owes Rs. X" badge next to the suggestion (spec §5.2). */
  owedAmount?: number;
}

interface AutosuggestInputProps {
  label: string;
  placeholder?: string;
  fetchSuggestions: (query: string) => Promise<AutosuggestSuggestion[]>;
  onSelect: (suggestion: AutosuggestSuggestion) => void;
  /** When set, renders as a locked "selected" chip instead of a free-typing box. */
  selected?: AutosuggestSuggestion | null;
  onClearSelection?: () => void;
  allowCreateNew?: boolean;
  onCreateNew?: (name: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * Generic autosuggest text field: used for the Register Panel's Player/Loser
 * and Winner fields. Debounces typing, shows a dropdown of matches with an
 * "owes Rs. X" badge for anyone carrying a balance, and — if enabled — a
 * "+ Add new customer '…'" row when nothing matches.
 */
export function AutosuggestInput({
  label,
  placeholder,
  fetchSuggestions,
  onSelect,
  selected,
  onClearSelection,
  allowCreateNew,
  onCreateNew,
  autoFocus,
  disabled,
}: AutosuggestInputProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AutosuggestSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length === 0) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(query);
      setSuggestions(results);
      setLoading(false);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchSuggestions]);

  if (selected) {
    return (
      <div>
        <label className="field-label">{label}</label>
        <div className="flex items-center justify-between rounded-lg border-2 border-blue-500 bg-blue-50 px-4 py-3 dark:bg-blue-950/30">
          <span className="text-lg font-semibold">{selected.label}</span>
          <div className="flex items-center gap-3">
            {!!selected.owedAmount && selected.owedAmount > 0 && (
              <span className="text-sm font-bold text-red-600 dark:text-red-400">owes Rs. {selected.owedAmount}</span>
            )}
            {onClearSelection && (
              <button type="button" onClick={onClearSelection} className="text-sm font-semibold text-blue-700 underline dark:text-blue-300">
                Change
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const exactMatch = suggestions.some((s) => s.label.trim().toLowerCase() === query.trim().toLowerCase());

  return (
    <div ref={containerRef} className="relative">
      <label className="field-label">{label}</label>
      <input
        className="field-input"
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && (query.trim().length > 0 || loading) && (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
          {loading && <div className="px-4 py-3 text-slate-400">Searching…</div>}
          {!loading &&
            suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left text-lg hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => {
                  onSelect(s);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span>{s.label}</span>
                {!!s.owedAmount && s.owedAmount > 0 && (
                  <span className="ml-3 shrink-0 text-sm font-bold text-red-600 dark:text-red-400">owes Rs. {s.owedAmount}</span>
                )}
              </button>
            ))}
          {!loading && allowCreateNew && query.trim().length > 0 && !exactMatch && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-slate-200 px-4 py-3 text-left text-lg font-semibold text-blue-700 hover:bg-blue-50 dark:border-slate-600 dark:text-blue-300 dark:hover:bg-blue-950/30"
              onClick={() => {
                onCreateNew?.(query.trim());
                setOpen(false);
                setQuery("");
              }}
            >
              + Add new customer &ldquo;{query.trim()}&rdquo;
            </button>
          )}
          {!loading && suggestions.length === 0 && (!allowCreateNew || query.trim().length === 0) && (
            <div className="px-4 py-3 text-slate-400">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
