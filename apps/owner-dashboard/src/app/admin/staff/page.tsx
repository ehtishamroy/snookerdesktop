"use client";

import { useState } from "react";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { PageGuard } from "@/components/PageGuard";
import { useUsers } from "@/hooks/useUsers";
import { apiClient, ApiError } from "@/lib/apiClient";
import type { UserEntity } from "@/lib/apiTypes";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@snooker/shared";
import { ROLES } from "@snooker/shared";

export default function AdminStaffPage() {
  return (
    <PageGuard allow={["owner"]}>
      <AdminStaffContent />
    </PageGuard>
  );
}

function AdminStaffContent() {
  const { users, isLoading, refresh } = useUsers();
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<UserEntity | null>(null);

  const columns: DataTableColumn<UserEntity>[] = [
    { key: "fullName", header: "Name", render: (r) => r.fullName },
    { key: "username", header: "Username", render: (r) => `@${r.username}` },
    {
      key: "role",
      header: "Role",
      render: (r) => <span className="capitalize">{r.role}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            r.isActive
              ? "bg-felt-100 text-felt-800 dark:bg-felt-900/40 dark:text-felt-300"
              : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
          }`}
        >
          {r.isActive ? "Active" : "Deactivated"}
        </span>
      ),
    },
    { key: "createdAt", header: "Created", render: (r) => formatDateTime(r.createdAt), sortValue: (r) => new Date(r.createdAt).getTime() },
    {
      key: "actions",
      header: "",
      sortable: false,
      render: (r) => (
        <button className="btn-secondary text-xs" onClick={() => setEditingUser(r)}>
          Manage
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Staff accounts</h1>
          <p className="page-subtitle">Owner-only: create/deactivate accounts, reset PINs, assign roles.</p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + New staff account
        </button>
      </div>

      <DataTable columns={columns} rows={users} keyField={(r) => r.id} isLoading={isLoading} defaultSortKey="fullName" defaultSortDir="asc" />

      {creating ? (
        <CreateUserModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await refresh();
          }}
        />
      ) : null}

      {editingUser ? (
        <ManageUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={async () => {
            setEditingUser(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void | Promise<void> }) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("receptionist");
  const [pin, setPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2 || username.trim().length < 2 || pin.trim().length < 4) {
      setError("Fill in a full name, username, and a PIN of at least 4 digits.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.createUser({ fullName: fullName.trim(), username: username.trim(), role, pin: pin.trim() });
      await onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create account.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-md flex flex-col gap-3">
        <h2 className="text-base font-semibold">New staff account</h2>
        <div>
          <label className="label">Full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Username</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">PIN</label>
          <input className="input" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} required />
        </div>
        {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSaving}>
            {isSaving ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ManageUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserEntity;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [role, setRole] = useState<Role>(user.role);
  const [newPin, setNewPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(partial: Parameters<typeof apiClient.updateUser>[1]) {
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.updateUser(user.id, partial);
      await onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not update account.");
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md flex flex-col gap-3">
        <h2 className="text-base font-semibold">Manage {user.fullName}</h2>
        <div>
          <label className="label">Full name</label>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Reset PIN (leave blank to keep current)</label>
          <input className="input" type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
        </div>
        {error ? <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            className={user.isActive ? "btn-danger text-xs" : "btn-secondary text-xs"}
            disabled={isSaving}
            onClick={() => save({ isActive: !user.isActive })}
          >
            {user.isActive ? "Deactivate account" : "Reactivate account"}
          </button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={isSaving}
              onClick={() =>
                save({
                  fullName: fullName.trim() || undefined,
                  role,
                  pin: newPin.trim() || undefined,
                })
              }
            >
              {isSaving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
