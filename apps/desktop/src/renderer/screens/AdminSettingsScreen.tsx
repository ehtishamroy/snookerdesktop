import { useEffect, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { api } from "../api";
import type { GameTypeEntity, LoanLedgerRow, PricingRuleEntity, Role, TableType, UserEntity } from "../api";
import { AutosuggestInput, type AutosuggestSuggestion } from "../components/AutosuggestInput";
import { useAuthStore, useIsOwner } from "../state/authStore";

type Tab = "pricing" | "staff" | "merge" | "backup";

export function AdminSettingsScreen() {
  const [tab, setTab] = useState<Tab>("pricing");
  const isOwner = useIsOwner();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex gap-2">
        {(
          [
            ["pricing", "Pricing"],
            ["staff", "Staff Accounts"],
            ["merge", "Customer Merge"],
            ["backup", "Backup"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-4 py-2 font-semibold ${
              tab === key ? "bg-blue-600 text-white" : "bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pricing" && <PricingTab canEdit={isOwner} />}
      {tab === "staff" && <StaffTab canEdit={isOwner} />}
      {tab === "merge" && <MergeTab />}
      {tab === "backup" && <BackupTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function PricingTab({ canEdit }: { canEdit: boolean }) {
  const session = useAuthStore((s) => s.session)!;
  const [tableType, setTableType] = useState<TableType>("standard");
  const [gameTypes, setGameTypes] = useState<GameTypeEntity[]>([]);
  const [rules, setRules] = useState<PricingRuleEntity[]>([]);
  const [history, setHistory] = useState<Record<number, PricingRuleEntity[]>>({});
  const [editValues, setEditValues] = useState<Record<number, { price: string; duration: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const [gts, active] = await Promise.all([api.gameTypes.list(), api.pricingRules.getActive(tableType)]);
    setGameTypes(gts);
    setRules(active);
  }

  useEffect(() => {
    void refresh();
  }, [tableType]);

  async function toggleHistory(gameTypeId: number) {
    if (history[gameTypeId]) {
      setHistory((h) => {
        const next = { ...h };
        delete next[gameTypeId];
        return next;
      });
      return;
    }
    const rows = await api.pricingRules.getHistory({ tableType, gameTypeId });
    setHistory((h) => ({ ...h, [gameTypeId]: rows }));
  }

  async function saveNewPrice(gameTypeId: number) {
    const values = editValues[gameTypeId];
    if (!values) return;
    await api.pricingRules.create({
      tableType,
      gameTypeId,
      price: Number(values.price),
      durationMinutes: Number(values.duration),
      createdByUserId: session.user.id,
    });
    setMessage("Price updated — old price preserved in history for past sessions.");
    setEditValues((v) => ({ ...v, [gameTypeId]: undefined as any }));
    void refresh();
  }

  const applicableGameTypes = gameTypes.filter((gt) => rules.some((r) => r.gameTypeId === gt.id) || tableType === "standard");

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold">Pricing Table</h2>
        <div className="flex gap-2">
          <button
            className={`rounded-lg px-4 py-2 font-semibold ${tableType === "standard" ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}
            onClick={() => setTableType("standard")}
          >
            Standard (1–5)
          </button>
          <button
            className={`rounded-lg px-4 py-2 font-semibold ${tableType === "private_room" ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-slate-700"}`}
            onClick={() => setTableType("private_room")}
          >
            Private Room (6)
          </button>
        </div>
      </div>

      {message && <div className="mb-4 rounded-lg bg-green-100 px-4 py-2 text-green-800 dark:bg-green-900/40 dark:text-green-300">{message}</div>}
      {!canEdit && (
        <div className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          Only the owner can change pricing. You can still view current prices and history below.
        </div>
      )}

      <div className="space-y-3">
        {applicableGameTypes.map((gt) => {
          const rule = rules.find((r) => r.gameTypeId === gt.id);
          const edit = editValues[gt.id];
          return (
            <div key={gt.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold">{gt.name}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">
                    {rule ? `Rs. ${rule.price} / ${rule.durationMinutes} min` : "No active price for this table type"}
                  </div>
                </div>
                <button className="text-sm font-semibold text-blue-600 underline dark:text-blue-400" onClick={() => toggleHistory(gt.id)}>
                  {history[gt.id] ? "Hide History" : "View History"}
                </button>
              </div>

              {canEdit && (
                <div className="mt-3 flex items-end gap-3">
                  <div>
                    <label className="field-label">New Price (Rs.)</label>
                    <input
                      type="number"
                      className="field-input w-32"
                      value={edit?.price ?? ""}
                      onChange={(e) => setEditValues((v) => ({ ...v, [gt.id]: { price: e.target.value, duration: v[gt.id]?.duration ?? String(rule?.durationMinutes ?? gt.defaultDurationMinutes) } }))}
                    />
                  </div>
                  <div>
                    <label className="field-label">Duration (min)</label>
                    <input
                      type="number"
                      className="field-input w-32"
                      value={edit?.duration ?? rule?.durationMinutes ?? gt.defaultDurationMinutes}
                      onChange={(e) => setEditValues((v) => ({ ...v, [gt.id]: { price: v[gt.id]?.price ?? String(rule?.price ?? ""), duration: e.target.value } }))}
                    />
                  </div>
                  <button className="btn-primary py-2" disabled={!edit?.price} onClick={() => saveNewPrice(gt.id)}>
                    Save New Price
                  </button>
                </div>
              )}

              {history[gt.id] && (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-1">Price</th>
                      <th className="py-1">Duration</th>
                      <th className="py-1">Effective From</th>
                      <th className="py-1">Effective To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history[gt.id]!.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-1">Rs. {h.price}</td>
                        <td className="py-1">{h.durationMinutes} min</td>
                        <td className="py-1">{format(new Date(h.effectiveFrom), "d MMM yyyy, h:mm a")}</td>
                        <td className="py-1">{h.effectiveTo ? format(new Date(h.effectiveTo), "d MMM yyyy, h:mm a") : "current"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

function StaffTab({ canEdit }: { canEdit: boolean }) {
  const session = useAuthStore((s) => s.session)!;
  const [users, setUsers] = useState<UserEntity[]>([]);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("receptionist");
  const [pin, setPin] = useState("");
  const [resetPinFor, setResetPinFor] = useState<number | null>(null);
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setUsers(await api.users.list());
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!fullName.trim() || !username.trim() || pin.length < 4) {
      setError("Full name, username, and a PIN of at least 4 digits are required");
      return;
    }
    try {
      await api.users.create({ fullName: fullName.trim(), username: username.trim(), role, pin, performedByUserId: session.user.id });
      setFullName("");
      setUsername("");
      setPin("");
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff account");
    }
  }

  async function toggleActive(user: UserEntity) {
    await api.users.update({ id: user.id, isActive: !user.isActive, performedByUserId: session.user.id });
    void refresh();
  }

  async function resetPin(userId: number) {
    if (newPin.length < 4) return;
    await api.users.update({ id: userId, pin: newPin, performedByUserId: session.user.id });
    setResetPinFor(null);
    setNewPin("");
  }

  if (!canEdit) {
    return <div className="card p-5 text-slate-500 dark:text-slate-400">Only the owner can manage staff accounts.</div>;
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      <form onSubmit={handleCreate} className="card col-span-1 space-y-3 p-5">
        <h2 className="text-lg font-bold">Add Staff</h2>
        <input className="field-input" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input className="field-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <select className="field-input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="receptionist">Receptionist</option>
          <option value="manager">Manager</option>
          <option value="owner">Owner</option>
        </select>
        <input className="field-input" placeholder="Initial PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}
        <button className="btn-primary w-full" type="submit">
          Create Account
        </button>
      </form>

      <div className="card col-span-2 p-5">
        <h2 className="mb-3 text-lg font-bold">Staff Accounts</h2>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-4 py-3 dark:bg-slate-700">
              <div>
                <div className="font-semibold">
                  {u.fullName} <span className="text-sm capitalize text-slate-500 dark:text-slate-400">({u.role})</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">@{u.username}</div>
              </div>
              <div className="flex items-center gap-2">
                {resetPinFor === u.id ? (
                  <>
                    <input
                      className="field-input w-24 py-1"
                      placeholder="New PIN"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    />
                    <button className="btn-primary py-1 px-3 text-sm" onClick={() => resetPin(u.id)}>
                      Save
                    </button>
                  </>
                ) : (
                  <button className="btn-secondary py-1 px-3 text-sm" onClick={() => setResetPinFor(u.id)}>
                    Reset PIN
                  </button>
                )}
                <button
                  className={`py-1 px-3 text-sm ${u.isActive ? "btn-danger" : "btn-success"}`}
                  onClick={() => toggleActive(u)}
                >
                  {u.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer Merge
// ---------------------------------------------------------------------------

function MergeTab() {
  const session = useAuthStore((s) => s.session)!;
  const [from, setFrom] = useState<AutosuggestSuggestion | null>(null);
  const [into, setInto] = useState<AutosuggestSuggestion | null>(null);
  const [loanLedger, setLoanLedger] = useState<LoanLedgerRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.customers.getLoanLedger().then(setLoanLedger);
  }, []);

  async function fetchCustomerSuggestions(query: string): Promise<AutosuggestSuggestion[]> {
    const results = await api.customers.search(query);
    return results.map((c) => ({ id: c.id, label: c.displayName, owedAmount: c.owedAmount }));
  }

  async function handleMerge() {
    setError(null);
    setMessage(null);
    if (!from || !into) {
      setError("Select both a 'from' and an 'into' customer");
      return;
    }
    try {
      await api.customers.merge({ fromCustomerId: from.id, intoCustomerId: into.id, performedByUserId: session.user.id });
      setMessage(`Merged "${from.label}" into "${into.label}" — full history preserved.`);
      setFrom(null);
      setInto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    }
  }

  return (
    <div className="card space-y-5 p-5">
      <h2 className="text-lg font-bold">Merge Duplicate / Nishani Customers</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Collapses an informal duplicate (e.g. &ldquo;Ali&rdquo; vs &ldquo;Ali Bhai&rdquo;) or a nishani whose real name you&rsquo;ve now
        learned into one profile — full history is preserved, never duplicated.
      </p>

      <div>
        <label className="field-label">From (the record being merged away)</label>
        <AutosuggestInput
          label=""
          placeholder="Search a real customer by name…"
          fetchSuggestions={fetchCustomerSuggestions}
          onSelect={setFrom}
          selected={from}
          onClearSelection={() => setFrom(null)}
        />
        <p className="mt-1 text-xs text-slate-400">Or pick an open nishani record with a balance:</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {loanLedger
            .filter((r) => r.isTemporary)
            .map((r) => (
              <button
                key={r.customerId}
                onClick={() => setFrom({ id: r.customerId, label: r.displayName, owedAmount: r.totalOwed })}
                className="rounded-full bg-slate-200 px-3 py-1 text-sm hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
              >
                {r.displayName} — owes Rs. {r.totalOwed}
              </button>
            ))}
          {loanLedger.filter((r) => r.isTemporary).length === 0 && <span className="text-xs text-slate-400">No open nishani records right now.</span>}
        </div>
      </div>

      <div>
        <label className="field-label">Into (the profile that survives)</label>
        <AutosuggestInput
          label=""
          placeholder="Search the real customer to keep…"
          fetchSuggestions={fetchCustomerSuggestions}
          onSelect={setInto}
          selected={into}
          onClearSelection={() => setInto(null)}
          allowCreateNew
          onCreateNew={async (name) => {
            const customer = await api.customers.create({ displayName: name });
            setInto({ id: customer.id, label: customer.displayName });
          }}
        />
      </div>

      {message && <div className="rounded-lg bg-green-100 px-4 py-2 text-green-800 dark:bg-green-900/40 dark:text-green-300">{message}</div>}
      {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

      <button className="btn-primary" onClick={handleMerge} disabled={!from || !into}>
        Merge Customers
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

function BackupTab() {
  const [folder, setFolder] = useState<string | null>(null);
  const [intervalHours, setIntervalHours] = useState(24);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  useEffect(() => {
    void api.settings.get().then((s) => {
      setFolder(s.backupFolderPath);
      setIntervalHours(s.backupIntervalHours);
      setLastBackupAt(s.lastBackupAt);
    });
  }, []);

  async function chooseFolder() {
    const chosen = await api.settings.chooseBackupFolder();
    if (!chosen) return;
    const updated = await api.settings.update({ backupFolderPath: chosen });
    setFolder(updated.backupFolderPath);
  }

  async function saveInterval(hours: number) {
    setIntervalHours(hours);
    await api.settings.update({ backupIntervalHours: hours });
  }

  return (
    <div className="card max-w-xl space-y-4 p-5">
      <h2 className="text-lg font-bold">Local Backup (decision #14)</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        A scheduled copy of this counter&rsquo;s database is written to the folder below so a disk failure never loses unsynced data.
      </p>

      <div>
        <label className="field-label">Backup Folder</label>
        <div className="flex gap-2">
          <input className="field-input flex-1" readOnly value={folder ?? "Not set — choose a folder (e.g. a USB drive)"} />
          <button className="btn-secondary" onClick={chooseFolder}>
            Choose…
          </button>
        </div>
      </div>

      <div>
        <label className="field-label">Backup Interval (hours)</label>
        <input
          type="number"
          className="field-input w-32"
          value={intervalHours}
          onChange={(e) => saveInterval(Number(e.target.value) || 24)}
        />
      </div>

      <div className="text-sm text-slate-500 dark:text-slate-400">
        Last backup: {lastBackupAt ? format(new Date(lastBackupAt), "d MMM yyyy, h:mm a") : "never yet"}
      </div>
    </div>
  );
}
