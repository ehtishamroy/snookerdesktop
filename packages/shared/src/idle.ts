import { IDLE_ALERT_MULTIPLIER } from "./constants";

export interface IdleCheckInput {
  startTime: Date;
  now: Date;
  /** The billed block duration for this game type (minutes), e.g. 25 or 60. */
  blockDurationMinutes: number;
}

export interface IdleCheckResult {
  isIdleAlert: boolean;
  minutesElapsed: number;
  thresholdMinutes: number;
}

/**
 * Detects a forgotten "End Game" press. If a receptionist forgets to close a
 * game, the table would otherwise show occupied for hours, silently
 * corrupting both revenue and vacancy reports. Owner decision: this is
 * important, flag it — recommended threshold is double the expected block
 * duration (spec §8/§14.16).
 */
export function checkIdleAlert(input: IdleCheckInput): IdleCheckResult {
  const minutesElapsed = (input.now.getTime() - input.startTime.getTime()) / 60000;
  const thresholdMinutes = input.blockDurationMinutes * IDLE_ALERT_MULTIPLIER;
  return {
    isIdleAlert: minutesElapsed > thresholdMinutes,
    minutesElapsed,
    thresholdMinutes,
  };
}
