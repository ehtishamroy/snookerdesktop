"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, isAuthenticated, isHydrating } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isHydrating && isAuthenticated) router.replace("/");
  }, [isHydrating, isAuthenticated, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username.trim(), pin.trim());
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Incorrect username or PIN." : err.message);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-felt-950 to-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-white">
          <div className="h-14 w-14 rounded-2xl bg-felt-600" />
          <h1 className="text-lg font-semibold">Snooker Club Owner Dashboard</h1>
          <p className="text-center text-sm text-slate-400">Live status, analytics &amp; admin — synced from the cloud</p>
        </div>

        <form onSubmit={handleSubmit} className="card flex flex-col gap-4 bg-white/95 dark:bg-slate-900/95">
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              className="input tracking-widest"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>

          <p className="text-center text-xs text-slate-400">
            Owner &amp; manager accounts only. Receptionist accounts can sign in but will only see their own shift
            totals here.
          </p>
        </form>
      </div>
    </div>
  );
}
