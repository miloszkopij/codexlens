"use client";
import { useEffect, useState } from "react";
import type { DashboardData, OrganizerMappings, OrganizerStructureContext } from "../types";

interface Result extends OrganizerStructureContext { rulesKey: string; directoryKey: string; requestKey: string; }
export function useStructureContext(data: DashboardData, rules: OrganizerMappings | null) {
  const [result, setResult] = useState<Result | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const rulesKey = JSON.stringify(rules?.structureRules ?? []);
  const directoryKey = JSON.stringify(data.members.map((member) => [member.id, member.email]).sort());
  const required = Boolean(rules) && data.mode !== "demo";
  const requestKey = JSON.stringify([rulesKey, directoryKey, data.lastSyncedAt, refreshIndex]);
  useEffect(() => {
    if (!required) return;
    const controller = new AbortController();
    fetch(`/api/organizer-structure${refreshIndex ? "?refresh=1" : ""}`, { signal: controller.signal })
      .then(async (response) => {
        const context = await response.json() as Result;
        if (!response.ok) throw new Error(context.error || "Could not load People API structures.");
        if (context.rulesKey !== rulesKey || context.directoryKey !== directoryKey) throw new Error("Directory or structure rules changed. Reload this page before reviewing assignments.");
        if (!controller.signal.aborted) setResult({ ...context, requestKey });
      })
      .catch((error) => { if (!controller.signal.aborted) setResult({ members: {}, retrievedAt: null, error: error.message, rulesKey, directoryKey, requestKey }); });
    return () => controller.abort();
  }, [required, rulesKey, directoryKey, requestKey, refreshIndex]);
  const current = required && result?.requestKey === requestKey ? result : null;
  return { members: current?.members, retrievedAt: current?.retrievedAt, loading: required && !current,
    error: current?.error, leaderName: current?.leaderName ?? "David Roberts", n1Heads: current?.n1Heads ?? [], n1Error: current?.n1Error,
    refresh: () => setRefreshIndex((value) => value + 1) };
}
