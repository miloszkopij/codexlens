"use client";
import { useState } from "react";
import type { Member, WorkspaceGroup } from "../types";
import { isSpecialGroup, titleMatchesWords } from "../../lib/access-policy";

export default function PersonExceptions({ members, groups, overrides, disabled, query, onChange }: {
  members: Member[];
  groups: WorkspaceGroup[];
  overrides: Record<string, string>;
  disabled: boolean;
  query: string;
  onChange: (memberId: string, groupId: string) => void;
}) {
  const [personQuery, setPersonQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [groupId, setGroupId] = useState("");
  const targets = groups.filter((group) => group.source === "Manual").sort((a, b) => a.name.localeCompare(b.name));
  const candidates = personQuery.trim().length >= 2 ? members.filter((member) =>
    member.status === "Active" && !overrides[member.id]
    && titleMatchesWords(`${member.name} ${member.email} ${member.peopleRole ?? ""}`, personQuery),
  ).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30) : [];
  const selected = candidates.some((member) => member.id === memberId) ? memberId : "";
  const existing = Object.entries(overrides).map(([id, idGroup]) => ({ member: members.find((person) => person.id === id), memberId: id, groupId: idGroup }))
    .filter(({ member, memberId: id }) => titleMatchesWords(`${member?.name ?? id} ${member?.email ?? ""} ${member?.peopleRole ?? ""}`, query))
    .sort((a, b) => (a.member?.name ?? a.memberId).localeCompare(b.member?.name ?? b.memberId));
  return <section className="panel person-exceptions"><div className="panel-heading"><div><span className="eyebrow">Priority 1 · exception</span><h2>Specific person → group</h2></div></div>
    <p className="table-note">An exception skips domain, manager and job-title rules for that member. A regular destination replaces other regular groups on review; a special destination (admin or cat-team) is added while regular groups stay unchanged. Only manually managed groups can be chosen.</p>
    <div className="person-exception-form"><label>Find workspace member<input aria-label="Find person for exception" placeholder="Name, email or job title" value={personQuery} onChange={(event) => { setPersonQuery(event.target.value); setMemberId(""); }} /></label><label>Person<select aria-label="Person for exception" value={selected} disabled={disabled || !candidates.length} onChange={(event) => setMemberId(event.target.value)}><option value="">{personQuery.trim().length < 2 ? "Type at least 2 characters" : candidates.length ? "Select a person" : "No active matches"}</option>{candidates.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label><label>Group<select aria-label="Exception destination group" value={groupId} disabled={disabled} onChange={(event) => setGroupId(event.target.value)}><option value="">Choose a group</option>{targets.map((group) => <option key={group.id} value={group.id}>{group.name}{isSpecialGroup(group) ? " · special" : ""}</option>)}</select></label><button className="button button--secondary" disabled={disabled || !selected || !groupId} onClick={() => { onChange(selected, groupId); setMemberId(""); setPersonQuery(""); }}>Add exception</button></div>
    <div className="table-scroll"><table className="policy-table"><thead><tr><th>Person</th><th>People API job title</th><th>Destination</th><th></th></tr></thead><tbody>{existing.map(({ member, memberId: id, groupId: destination }) => <tr key={id}><td><strong>{member?.name ?? "Member no longer in snapshot"}</strong><small>{member?.email ?? id}</small></td><td>{member?.peopleRole ?? "—"}</td><td><select aria-label={`Exception group for ${member?.name ?? id}`} value={targets.some((group) => group.id === destination) ? destination : "__missing__"} disabled={disabled} onChange={(event) => onChange(id, event.target.value)}>{!targets.some((group) => group.id === destination) && <option value="__missing__" disabled>Group unavailable</option>}{targets.map((group) => <option key={group.id} value={group.id}>{group.name}{isSpecialGroup(group) ? " · special" : ""}</option>)}</select></td><td><button className="button button--secondary" disabled={disabled} onClick={() => onChange(id, "")}>Remove</button></td></tr>)}</tbody></table>{!existing.length && <div className="empty-state">No person exceptions match this search.</div>}</div>
  </section>;
}
