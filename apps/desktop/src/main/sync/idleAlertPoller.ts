/**
 * Auto-detection of a forgotten "End Game" press (decision #16). Every 30s,
 * checks every currently-open game against @snooker/shared's checkIdleAlert
 * (running past double its billed block duration) and pushes the current
 * list to the renderer, which keeps a persistent banner on the Main
 * Dashboard until each alert is acknowledged or its game is ended.
 */
import type { BrowserWindow } from "electron";
import { getIdleAlerts } from "../db/repositories/gamesRepo";
import { IPC_CHANNELS } from "../../ipc/contract";

const POLL_INTERVAL_MS = 30_000;

export class IdleAlertPoller {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private getWindow: () => BrowserWindow | null) {}

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private tick(): void {
    try {
      const alerts = getIdleAlerts();
      this.getWindow()?.webContents.send(IPC_CHANNELS.alertsIdleEvent, alerts);
    } catch {
      // Never let a transient DB hiccup crash the poller — it retries on the next tick.
    }
  }
}
