/**
 * Thin, typed wrapper around `window.api` (exposed by src/main/preload.ts).
 * Screens/components import from here rather than touching `window.api`
 * directly so call sites read naturally and stay typed against
 * @snooker/shared + src/ipc/contract.ts in one place.
 */
export const api = window.api;

export * from "../../ipc/contract";
