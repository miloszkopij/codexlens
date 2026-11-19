import { timingSafeEqual } from "node:crypto";
import { acquireWorkspaceLock, readLocalSetting, releaseWorkspaceLock, writeLocalSetting } from "../../../db/access-store";
import { getWorkspaceConfig, value } from "../../../lib/config";
import { runDirectorySync } from "../../../lib/directory-sync";
import { defaultSyncSettings, emptySyncState, syncDue, type SyncState } from "../../../lib/sync-settings";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const expected = value("CODEXLENS_SYNC_TOKEN");
  const supplied = request.headers.get("x-codexlens-sync-token") ?? "";
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return Response.json({ error: "Local sync runner authentication required." }, { status: 403 });
  const { workspaceId } = getWorkspaceConfig();
  const owner = crypto.randomUUID(); const lock = `scheduler:${workspaceId}`;
  await writeLocalSetting(`sync-runner:${workspaceId}`, new Date().toISOString());
  if (!await acquireWorkspaceLock(lock, owner)) return Response.json({ skipped: "Already running" });
  try {
    const settings = await readLocalSetting(`sync-settings:${workspaceId}`, defaultSyncSettings);
    const key = `sync-state:${workspaceId}`;
    const state = await readLocalSetting<SyncState>(key, emptySyncState);
    if (!syncDue(settings, state, Date.now())) return Response.json({ skipped: "Paused or not due" });
    const now = new Date().toISOString();
    const next = () => new Date(Date.now() + settings.intervalMinutes * 60_000).toISOString();
    await writeLocalSetting(key, { ...state, status: "running", lastAttemptAt: now, error: null, nextRunAt: next() });
    try {
      const usageDue = !state.lastUsageAt || Date.now() - Date.parse(state.lastUsageAt) >= 60 * 60_000;
      const result = await runDirectorySync(usageDue ? "incremental" : "none");
      const partial = result.sync.directory.staleProfiles > 0 || (usageDue && !result.sync.usageHistory.updated) || !result.sync.roleImport.updated;
      await writeLocalSetting(key, { ...state, status: partial ? "partial" : "success", lastAttemptAt: now, lastSuccessAt: new Date().toISOString(),
        lastUsageAt: result.sync.usageHistory.updated ? new Date().toISOString() : state.lastUsageAt,
        nextRunAt: next(), changes: result.changesCreated, staleProfiles: result.sync.directory.staleProfiles,
        error: partial ? [result.sync.directory.staleProfiles ? `${result.sync.directory.staleProfiles} People API profiles unavailable; last known fields retained.` : "", usageDue && !result.sync.usageHistory.updated ? result.sync.usageHistory.message : "", !result.sync.roleImport.updated ? result.sync.roleImport.message : ""].filter(Boolean).join(" ") : null });
      return Response.json({ changes: result.changesCreated, partial });
    } catch (error) {
      const message = (error as Error).message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
      await writeLocalSetting(key, { ...state, status: "failed", lastAttemptAt: now, nextRunAt: next(), error: message });
      return Response.json({ error: "Auto-sync failed; inspect Sync status." }, { status: 500 });
    }
  } finally { await releaseWorkspaceLock(lock, owner); }
}
