export interface SyncSettings { enabled: boolean; intervalMinutes: number; }
export interface SyncState {
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastUsageAt: string | null;
  nextRunAt: string | null; runnerSeenAt: string | null; status: "idle" | "running" | "success" | "partial" | "failed";
  error: string | null; changes: number; staleProfiles: number;
}
// Opt in once: installing or restarting the app must not unexpectedly call upstream services.
export const defaultSyncSettings: SyncSettings = { enabled: false, intervalMinutes: 15 };
export const emptySyncState: SyncState = { lastAttemptAt: null, lastSuccessAt: null, lastUsageAt: null, nextRunAt: null, runnerSeenAt: null, status: "idle", error: null, changes: 0, staleProfiles: 0 };
export function validateSyncSettings(value: unknown): SyncSettings {
  const body = value as Partial<SyncSettings> | null;
  if (!body || typeof body.enabled !== "boolean" || ![5, 15, 30, 60, 240].includes(Number(body.intervalMinutes))) throw new Error("Choose a supported sync interval and enabled state.");
  return { enabled: body.enabled, intervalMinutes: Number(body.intervalMinutes) };
}
export function syncDue(settings: SyncSettings, state: SyncState, now: number) {
  return settings.enabled && (!state.nextRunAt || Date.parse(state.nextRunAt) <= now);
}
