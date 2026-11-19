"use client";
import { useState } from "react";
import type { DashboardData, Member } from "../types";
import { isSpecialGroup, memberGroupIds } from "../../lib/access-policy";
import AccessChangeDialog, { type AccessRequest } from "./AccessChangeDialog";

export default function MemberGroupEditor({ member, data, onRefresh }: { member: Member; data: DashboardData; onRefresh: () => Promise<void> }) {
  const [target, setTarget] = useState("");
  const [request, setRequest] = useState<AccessRequest | null>(null);
  let current: string[] = []; let unresolved = false;
  try { current = memberGroupIds(member, data.groups); } catch { unresolved = true; }
  const disabled = data.mode === "demo" || unresolved;
  const special = data.groups.filter(isSpecialGroup);
  return <div className="member-group-editor">
    <h3>Regular group</h3><p className="section-helper">Choose one regular group. Moving replaces other regular memberships and preserves special groups. SCIM groups are read-only.</p>
    <div className="group-tags">{data.groups.filter((group) => current.includes(group.id) && !isSpecialGroup(group)).map((group) => <span key={group.id}>{group.name}</span>)}</div>
    <label>Move to<select value={target} onChange={(event) => setTarget(event.target.value)} disabled={disabled}><option value="">Choose regular group</option>{data.groups.filter((group) => !isSpecialGroup(group) && group.source === "Manual").map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <button className="button button--secondary" disabled={disabled || !target} onClick={() => setRequest({ memberIds: [member.id], operation: { kind: "move", groupId: target } })}>Review move</button>
    <h3>Special groups</h3><p className="section-helper">Assign admin and cat-team individually. These memberships are never changed by Organize or auto-sync. Group membership is not the built-in OpenAI Admin role.</p>
    <div className="membership-list">{special.map((group) => { const present = current.includes(group.id); return <button key={group.id} disabled={disabled || group.source !== "Manual"} onClick={() => setRequest({ memberIds: [member.id], operation: { kind: "special", groupId: group.id, action: present ? "remove" : "add" } })}><span><strong>{group.name}</strong><small>{present ? "Assigned" : "Not assigned"} · {group.source}</small></span><span>{present ? "Review removal" : "Review assignment"}</span></button>; })}</div>
    {!special.length && <p>No admin or cat-team group found in this workspace.</p>}
    {unresolved && <p role="alert">Sync to resolve group identifiers before editing.</p>}
    {request && <AccessChangeDialog request={request} groups={data.groups} onClose={() => setRequest(null)} onDone={onRefresh} />}
  </div>;
}
