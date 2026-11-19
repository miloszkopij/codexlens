"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceGroup } from "../types";
import type { AccessChange, AccessOperation } from "../../lib/access-policy";
import { accessBatchComplete, splitAccessBatches } from "../../lib/access-batches";

export interface AccessRequest { memberIds: string[]; operation: AccessOperation; }
interface Preview { id: string; expiresAt: number; changes: AccessChange[]; blocked: { name: string; reason: string }[]; unchanged: number; }
export default function AccessChangeDialog({ request, groups, onClose, onDone }: {
  request: AccessRequest; groups: WorkspaceGroup[]; onClose: (completed: boolean) => void; onDone: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const advancingRef = useRef(false);
  const [batches] = useState(() => splitAccessBatches(request.memberIds));
  const [batchIndex, setBatchIndex] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<{ verified: number; message: string; results: { name: string; status: string; message: string }[] } | null>(null);
  const [completed, setCompleted] = useState({ verified: 0, blocked: 0, unchanged: 0 });
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    advancingRef.current = false;
    const controller = new AbortController();
    fetch("/api/access-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "preview", memberIds: batches[batchIndex], operation: request.operation }), signal: controller.signal })
      .then(async (response) => { const data = await response.json() as Preview & { error?: string }; if (!response.ok) throw new Error(data.error); return data as Preview; })
      .then((data) => { if (!controller.signal.aborted) setPreview(data); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [request, batchIndex, batches]);
  const names = (ids: string[]) => ids.map((id) => groups.find((group) => group.id === id)?.name ?? "Unavailable group").join(", ") || "None";
  const batchComplete = Boolean(preview && accessBatchComplete(preview.changes.length, result?.verified ?? null, Boolean(error) || refreshFailed, busy));
  const hasMore = batchIndex + 1 < batches.length;
  function nextBatch() {
    if (advancingRef.current || !batchComplete || !hasMore) return;
    advancingRef.current = true;
    setCompleted((current) => ({ verified: current.verified + (result?.verified ?? 0), blocked: current.blocked + (preview?.blocked.length ?? 0), unchanged: current.unchanged + (preview?.unchanged ?? 0) }));
    setPreview(null); setError(""); setAck(false); setAttempted(false); setResult(null); setRefreshFailed(false);
    setBatchIndex((current) => current + 1);
  }
  async function apply() {
    if (!preview || !ack || attempted || busyRef.current) return;
    if (Date.now() > preview.expiresAt) { setError("Preview expired. Close and review again."); return; }
    busyRef.current = true; setBusy(true); setAttempted(true);
    try {
      const response = await fetch("/api/access-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "apply", planId: preview.id, acknowledged: true }) });
      const data = await response.json() as { error?: string; verified: number; message: string; results: { name: string; status: string; message: string }[] };
      if (!response.ok) throw new Error(data.error || "Change could not be verified.");
      setResult(data);
    } catch (reason) { setError(`${(reason as Error).message} Refresh and create a new preview before retrying.`); }
    finally { try { await onDone(); } catch { setRefreshFailed(true); setError("Refresh failed. Sync before editing again; the next batch was not started."); } setBusy(false); busyRef.current = false; }
  }
  const allComplete = batchComplete && !hasMore;
  return <dialog ref={dialog} className="access-dialog access-dialog--wide" aria-labelledby="access-plan-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(allComplete); }}>
    <span className="eyebrow">Confirm workspace change</span><h2 id="access-plan-title">Review group changes</h2>
    <p>Batch {batchIndex + 1} of {batches.length} · {batches[batchIndex]?.length ?? 0} people in this batch · {batches.slice(batchIndex + 1).reduce((sum, ids) => sum + ids.length, 0)} still to review. Each batch needs its own confirmation.</p>
    {(completed.verified > 0 || completed.blocked > 0 || completed.unchanged > 0) && <p role="status">Earlier batches: {completed.verified} verified · {completed.unchanged} unchanged · {completed.blocked} blocked.</p>}
    <p>Moves remove obsolete regular memberships, then add the destination. These are separate OpenAI requests; a failed move may be incomplete. Special-group exceptions add membership without removing regular groups.</p>
    {!preview && !error && <p role="status">Preparing a server-validated preview…</p>}
    {error && <p className="access-feedback" role="alert">{error}</p>}
    {preview && <><p>{preview.changes.length} people to change · {preview.unchanged} unchanged · {preview.blocked.length} blocked</p>
      <div className="table-scroll plan-table"><table><thead><tr><th>Person / reason</th><th>Remove</th><th>Add</th><th>Keep special</th></tr></thead><tbody>{preview.changes.map((change) => <tr key={change.memberId}><td><strong>{change.name}</strong><small>{change.email}</small><small>{change.reason}</small></td><td>{names(change.remove)}</td><td>{names(change.add)}</td><td>{names(change.retainedSpecial)}</td></tr>)}</tbody></table></div>
      {preview.blocked.length > 0 && <details><summary>Blocked people — not included</summary>{preview.blocked.map((row, index) => <p key={index}><strong>{row.name}</strong>: {row.reason}</p>)}</details>}
      {!attempted && preview.changes.length > 0 && <label className="role-acknowledgement"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />I reviewed these memberships and any access they grant, and authorize these changes in OpenAI.</label>}
    </>}
    {result && <div role="status"><strong>{result.message}</strong>{result.results.map((row, index) => <p key={index}>{row.name}: <strong>{row.status}</strong> — {row.message}</p>)}</div>}
    {result && result.verified < (preview?.changes.length ?? 0) && <p className="access-feedback" role="alert">This batch was only partly verified. The next batch is stopped. Sync and review the remaining people again.</p>}
    <div className="access-dialog-actions"><button className="button button--secondary" disabled={busy} onClick={() => onClose(allComplete)}>{allComplete ? "Done" : attempted ? "Close" : "Cancel"}</button>{!attempted && <button className="button button--primary" disabled={!ack || !preview?.changes.length} onClick={apply}>Confirm {preview?.changes.length ?? 0} people</button>}{batchComplete && hasMore && <button className="button button--primary" onClick={nextBatch}>Review next {batches[batchIndex + 1]?.length ?? 0} people</button>}{busy && <span role="status">Applying and verifying… Keep this window open.</span>}</div>
  </dialog>;
}
