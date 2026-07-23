import { useState, type FormEvent } from "react";
import { useAuthStore } from "../state/authStore";

/** Username + PIN login. Success opens (or reuses) the caller's shift — shift open = login (decision #5/#12). */
export function LoginScreen() {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const login = useAuthStore((s) => s.login);
  const isBusy = useAuthStore((s) => s.isBusy);
  const error = useAuthStore((s) => s.error);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !pin.trim()) return;
    try {
      await login(username.trim(), pin.trim());
    } catch {
      // error surfaced via the store
    }
  }

  function pressDigit(d: string) {
    setPin((p) => (p.length < 8 ? p + d : p));
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-blue-700 to-slate-900">
      <form onSubmit={handleSubmit} className="card w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <div className="text-4xl">🎱</div>
          <h1 className="mt-2 text-2xl font-extrabold">Snooker Counter</h1>
          <p className="text-slate-500 dark:text-slate-400">Sign in to start your shift</p>
        </div>

        <label className="field-label">Username</label>
        <input
          className="field-input mb-4"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          placeholder="e.g. ali"
        />

        <label className="field-label">PIN</label>
        <input
          className="field-input mb-2 text-center tracking-[0.5em]"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          type="password"
          inputMode="numeric"
          maxLength={8}
          placeholder="••••"
        />

        <div className="mb-6 grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button type="button" key={d} className="btn-secondary py-3 text-2xl" onClick={() => pressDigit(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="btn-secondary py-3 text-lg" onClick={() => setPin("")}>
            Clear
          </button>
          <button type="button" className="btn-secondary py-3 text-2xl" onClick={() => pressDigit("0")}>
            0
          </button>
          <button type="button" className="btn-secondary py-3 text-lg" onClick={() => setPin((p) => p.slice(0, -1))}>
            ⌫
          </button>
        </div>

        {error && <div className="mb-4 rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

        <button type="submit" disabled={isBusy} className="btn-primary w-full">
          {isBusy ? "Signing in…" : "Sign In"}
        </button>

        <p className="mt-4 text-center text-xs text-slate-400">
          Works fully offline — signing in and starting your shift never needs an internet connection.
        </p>
      </form>
    </div>
  );
}
