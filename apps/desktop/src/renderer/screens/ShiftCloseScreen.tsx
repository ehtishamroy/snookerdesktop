import { useEffect, useState } from "react";
import type { ZReport } from "@snooker/shared";
import { Modal } from "../components/Modal";
import { useAuthStore } from "../state/authStore";

/**
 * Shift close = logout, logout = shift close (decision #5/#6): whether this
 * was opened via "Log Out" or a "Close Shift" button, the flow is identical
 * — declare cash, review the Z-report, confirm — and it ALWAYS ends the
 * session immediately after confirming, with no way to back out once
 * confirmed.
 */
export function ShiftCloseScreen({ mode }: { mode: "logout" | "close-shift" }) {
  const previewShiftClose = useAuthStore((s) => s.previewShiftClose);
  const confirmShiftClose = useAuthStore((s) => s.confirmShiftClose);
  const cancelPendingShiftClose = useAuthStore((s) => s.cancelPendingShiftClose);

  const [preview, setPreview] = useState<ZReport | null>(null);
  const [declaredCash, setDeclaredCash] = useState("");
  const [finalReport, setFinalReport] = useState<ZReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void previewShiftClose().then(setPreview);
  }, [previewShiftClose]);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const zReport = await confirmShiftClose(Number(declaredCash) || 0);
      setFinalReport(zReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close shift");
    } finally {
      setBusy(false);
    }
  }

  if (finalReport) {
    // Session is already cleared at this point (App.tsx will show LoginScreen
    // behind this modal) — this is just a final confirmation screen.
    return (
      <Modal title="Shift Closed" width="max-w-lg">
        <div className="space-y-3">
          <p className="text-lg">
            Cash variance:{" "}
            <strong className={finalReport.cashVarianceNeedsAttention ? "text-red-600" : "text-green-600"}>
              Rs. {finalReport.cashVariance}
            </strong>
            {finalReport.cashVarianceNeedsAttention && <span className="ml-2 text-sm text-red-600">(needs owner attention)</span>}
          </p>
          <p className="text-slate-500 dark:text-slate-400">You have been logged out. Sign in again to start a new shift.</p>
          <button className="btn-primary w-full" onClick={() => window.location.reload()}>
            Back to Login
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={mode === "logout" ? "Log Out — Close Your Shift" : "Close Shift"} width="max-w-lg">
      {!preview ? (
        <div className="text-slate-400">Loading shift summary…</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-100 p-4 text-sm dark:bg-slate-700">
            <div>
              Cash collected: <strong>Rs. {preview.totalsByMethod.cash}</strong>
            </div>
            <div>
              EasyPaisa: <strong>Rs. {preview.totalsByMethod.easypaisa}</strong>
            </div>
            <div>
              JazzCash: <strong>Rs. {preview.totalsByMethod.jazzcash}</strong>
            </div>
            <div>
              Card: <strong>Rs. {preview.totalsByMethod.card}</strong>
            </div>
            <div>
              Discounts given: <strong>Rs. {preview.totalDiscountsGiven}</strong>
            </div>
            <div>
              Pending created: <strong>Rs. {preview.totalPendingCreated}</strong>
            </div>
            <div>
              Loan created: <strong>Rs. {preview.totalLoanCreated}</strong>
            </div>
            <div>
              Tricked / collateral: <strong>{preview.totalTrickedCount} / {preview.totalCollateralCount}</strong>
            </div>
            <div className="col-span-2 border-t border-slate-300 pt-2 text-base font-bold dark:border-slate-600">
              System expects cash-in-hand: Rs. {preview.systemCashTotal}
            </div>
          </div>

          <div>
            <label className="field-label">Declared Cash-in-Hand (count the drawer)</label>
            <input
              type="number"
              autoFocus
              className="field-input text-2xl"
              value={declaredCash}
              onChange={(e) => setDeclaredCash(e.target.value)}
              placeholder="0"
            />
          </div>

          {error && <div className="rounded-lg bg-red-100 px-4 py-2 text-red-800 dark:bg-red-900/40 dark:text-red-300">{error}</div>}

          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={cancelPendingShiftClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn-danger" onClick={handleConfirm} disabled={busy}>
              {busy ? "Closing…" : "Confirm Close & Log Out"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
