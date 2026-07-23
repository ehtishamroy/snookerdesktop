import { api } from "../api";
import { AutosuggestInput, type AutosuggestSuggestion } from "./AutosuggestInput";

async function fetchCustomerSuggestions(query: string): Promise<AutosuggestSuggestion[]> {
  const results = await api.customers.search(query);
  return results.map((c) => ({ id: c.id, label: c.displayName, owedAmount: c.owedAmount }));
}

export interface PlayerNameFieldState {
  loser: AutosuggestSuggestion | null;
  isNishani: boolean;
  nishaniText: string;
  winner: AutosuggestSuggestion | null;
}

/**
 * Who's expected to pay ("loser" — the customer/tab a round is attributed
 * to) plus an optional winner, with a "don't know the name yet" nishani
 * fallback. Shared by the mid-game "set player name" action, the End Game
 * checkout (when no name was set during the round), and the game-history
 * edit affordance — one control, three call sites.
 */
export function PlayerNameField({
  state,
  onChange,
  showWinner = true,
  autoFocus,
}: {
  state: PlayerNameFieldState;
  onChange: (next: PlayerNameFieldState) => void;
  showWinner?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-3">
      {!state.isNishani ? (
        <AutosuggestInput
          label="Player / Customer Name"
          placeholder="Type a name…"
          fetchSuggestions={fetchCustomerSuggestions}
          onSelect={(loser) => onChange({ ...state, loser })}
          selected={state.loser}
          onClearSelection={() => onChange({ ...state, loser: null })}
          allowCreateNew
          onCreateNew={async (name) => {
            const customer = await api.customers.create({ displayName: name });
            onChange({ ...state, loser: { id: customer.id, label: customer.displayName } });
          }}
          autoFocus={autoFocus}
        />
      ) : (
        <div>
          <label className="field-label">Temporary / Nishani Description</label>
          <input
            className="field-input"
            placeholder="e.g. Red shirt, Table 3 regular"
            value={state.nishaniText}
            onChange={(e) => onChange({ ...state, nishaniText: e.target.value })}
          />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={state.isNishani}
          onChange={(e) => onChange({ ...state, isNishani: e.target.checked, loser: null })}
        />
        Don&rsquo;t know the name (use a temporary description instead)
      </label>

      {showWinner && (
        <AutosuggestInput
          label="Winner Name (optional)"
          placeholder="Type a name…"
          fetchSuggestions={fetchCustomerSuggestions}
          onSelect={(winner) => onChange({ ...state, winner })}
          selected={state.winner}
          onClearSelection={() => onChange({ ...state, winner: null })}
          allowCreateNew
          onCreateNew={async (name) => {
            const customer = await api.customers.create({ displayName: name });
            onChange({ ...state, winner: { id: customer.id, label: customer.displayName } });
          }}
        />
      )}
    </div>
  );
}

/** Resolves the current field state to a concrete loserCustomerId, creating the nishani record if that path was chosen. Returns null if nothing was entered at all. */
export async function resolveLoserCustomerId(state: PlayerNameFieldState): Promise<number | null> {
  if (state.isNishani) {
    if (!state.nishaniText.trim()) return null;
    const customer = await api.customers.createNishani({ nishaniDescription: state.nishaniText.trim() });
    return customer.id;
  }
  return state.loser?.id ?? null;
}
