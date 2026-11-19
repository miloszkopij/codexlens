import { db, initializeDatabase } from "./store";

export async function readLocalSetting<T>(key: string, fallback: T): Promise<T> {
  await initializeDatabase();
  const row = await db().prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : fallback;
}
export async function writeLocalSetting(key: string, value: unknown) {
  await initializeDatabase();
  await db().prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), new Date().toISOString()).run();
}
export async function acquireWorkspaceLock(workspaceId: string, owner: string) {
  await initializeDatabase();
  const now = Date.now();
  const result = await db().prepare(`INSERT INTO workspace_locks (name, owner, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET owner=excluded.owner, expires_at=excluded.expires_at WHERE workspace_locks.expires_at < ?`)
    .bind(workspaceId, owner, now + 30 * 60_000, now).run();
  return result.meta.changes === 1;
}
export async function renewWorkspaceLock(workspaceId: string, owner: string) {
  const result = await db().prepare("UPDATE workspace_locks SET expires_at = ? WHERE name = ? AND owner = ? AND expires_at > ?")
    .bind(Date.now() + 30 * 60_000, workspaceId, owner, Date.now()).run();
  if (result.meta.changes !== 1) throw new Error("Operation lock expired. Refresh before continuing.");
}
export async function releaseWorkspaceLock(workspaceId: string, owner: string) {
  await db().prepare("DELETE FROM workspace_locks WHERE name = ? AND owner = ?").bind(workspaceId, owner).run();
}
export async function saveAccessPlan(id: string, workspaceId: string, payload: unknown, expiresAt: number) {
  await initializeDatabase();
  await db().batch([
    db().prepare("DELETE FROM access_plans WHERE expires_at < ?").bind(Date.now()),
    db().prepare("INSERT INTO access_plans (id, workspace_id, payload, expires_at) VALUES (?, ?, ?, ?)").bind(id, workspaceId, JSON.stringify(payload), expiresAt),
  ]);
}
export async function claimAccessPlan<T>(id: string, workspaceId: string): Promise<T> {
  await initializeDatabase();
  const row = await db().prepare("UPDATE access_plans SET claimed = 1 WHERE id = ? AND workspace_id = ? AND claimed = 0 AND expires_at > ? RETURNING payload")
    .bind(id, workspaceId, Date.now()).first<{ payload: string }>();
  if (!row) throw new Error("Preview expired or was already attempted. Create a fresh preview; changes are never replayed automatically.");
  return JSON.parse(row.payload) as T;
}
