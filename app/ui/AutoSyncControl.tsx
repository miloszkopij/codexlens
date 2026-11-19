"use client";
import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "../types";
import { defaultSyncSettings, emptySyncState, type SyncSettings, type SyncState } from "../../lib/sync-settings";

export default function AutoSyncControl({ data, onRefresh, onNotice }: { data: DashboardData; onRefresh: () => Promise<void>; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<SyncSettings>(defaultSyncSettings);
  const [state, setState] = useState<SyncState>(emptySyncState);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [observedAt, setObservedAt] = useState(0);
  const callbacks = useRef({ onRefresh, onNotice });
  useEffect(() => { callbacks.current = { onRefresh, onNotice }; }, [onRefresh, onNotice]);
  const demo = data.mode === "demo";
  useEffect(() => {
    if (demo) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>; let lastSuccess: string | null | undefined;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/sync-settings", { signal: controller.signal });
        if (!response.ok) throw new Error("Could not load auto-sync status.");
        const result = await response.json() as { settings: SyncSettings; state: SyncState };
        if (cancelled) return;
        setSettings(result.settings); setState(result.state); setLoaded(true); setError("");
        if (lastSuccess !== undefined && result.state.lastSuccessAt && result.state.lastSuccessAt !== lastSuccess) {
          await callbacks.current.onRefresh();
          if (result.state.changes || result.state.status === "partial") callbacks.current.onNotice(`Auto-sync: ${result.state.changes} directory changes. ${result.state.error || "Open Changes to see who and what changed. No access changes were applied."}`);
        }
        lastSuccess = result.state.lastSuccessAt;
      } catch (reason) { if (!cancelled) setError((reason as Error).message); }
      finally { if (!cancelled) { setObservedAt(Date.now()); timer = setTimeout(load, 15_000); } }
    }
    void load();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [demo]);
  async function update(next: SyncSettings) {
    setBusy(true);
    try {
      const response = await fetch("/api/sync-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const result = await response.json() as { settings: SyncSettings; error?: string }; if (!response.ok) throw new Error(result.error);
      setSettings(result.settings); setError("");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const runnerOnline = Boolean(state.runnerSeenAt && observedAt - Date.parse(state.runnerSeenAt) < (state.status === "running" ? 30 * 60_000 : 90_000));
  const format = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";
  return <div className="auto-sync"><button className="button button--secondary" onClick={() => setOpen(!open)} aria-expanded={open}>Auto-sync: {demo ? "demo" : !loaded ? "loading" : !settings.enabled ? "paused" : !runnerOnline ? "runner offline" : state.status === "running" ? "running" : `${settings.intervalMinutes} min`}</button>
    {open && <section className="auto-sync-popover panel" aria-label="Auto-sync settings"><h2>Automatic data refresh</h2><p>Refreshes data and detects changes. Never applies membership or role changes.</p><label><input type="checkbox" disabled={demo || !loaded || busy} checked={settings.enabled} onChange={(event) => update({ ...settings, enabled: event.target.checked })} />Enable automatic sync while CodexLens is running</label><label>Interval<select disabled={demo || !loaded || busy} value={settings.intervalMinutes} onChange={(event) => update({ ...settings, intervalMinutes: Number(event.target.value) })}>{[5,15,30,60,240].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label><dl><dt>Last directory snapshot</dt><dd>{format(data.lastSyncedAt)}</dd><dt>Last automatic attempt</dt><dd>{format(state.lastAttemptAt)}</dd><dt>Next automatic run</dt><dd>{!settings.enabled ? "Paused" : !runnerOnline ? "Waiting for local runner" : state.nextRunAt ? format(state.nextRunAt) : "Within 30 seconds"}</dd><dt>Runner</dt><dd>{runnerOnline ? "Connected" : "Offline — restart with npm run dev"}</dd><dt>Automatic result</dt><dd>{state.status} · {state.changes} changes</dd></dl><p>Usage refreshes hourly with a seven-day overlap. Use Sync directory for full history. Requires the local server and network/VPN; no runs while the computer sleeps.</p>{(error || state.error) && <p className="access-feedback" role="alert">{error || state.error}</p>}<button className="text-button" onClick={() => setOpen(false)}>Close</button></section>}
  </div>;
}
