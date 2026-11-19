# codexlens architecture

## Product boundary

`codexlens` combines upstream sources without pretending they have identical
semantics:

1. ChatGPT Admin API is authoritative for workspace members, groups, and manual
   group membership.
2. People API is authoritative for organizational role, department, manager,
   company, and entity enrichment.
3. Unified Daily Usage Analytics API is authoritative for daily per-user credits,
   messages, and source-provided USD usage estimates across Work and Codex.
   Codex-only Analytics and attributed CSV remain fallbacks; aggregate-only sources cannot
   power per-user averages.
4. Addition attribution is authoritative only when the workspace directory or
   an auditable upstream event explicitly identifies the actor. Snapshot timing
   is never treated as proof of who performed a change.

## Local flow

```text
ChatGPT Admin API ─┐
                   ├─ sync route ─ snapshot diff ─ local D1/SQLite ─ dashboard
People API ────────┘                         │
                                             └─ change inbox + actor provenance

Unified Usage API ─ cursor pages ─ ID/email match ─ usage records ─ filtered analytics
Codex-only API ─ fallback, non-overlapping dates ────────────────────┘

Analytics CSV ─ fallback import ─ email match ────────────────┘

Price / credit + budget guardrails ─ settings route ─ local D1 ─ finance analytics

Member drawer ─ confirmation ─ Admin API write ─ read-back verification ─ local state

Organize ─ person exception > exact email domain > manager structure > People job title ─ reviewed plan ─ confirmed writes

Member special-group controls ─ explicit per-person plan ─ confirmed writes

Permissions & roles ─ local role/group plan ─ manual assignment in OpenAI Admin

Workspace roles + each group's roles ─ GET-only import ─ complete local snapshot ─ Current OpenAI configuration

Local runner ─ authenticated scheduled tick ─ read-only directory/usage sync
```

## Storage

- `members`: latest enriched member state plus workspace-addition provenance
- `workspace_groups`: latest group directory and management source
- `memberships`: latest many-to-many member/group relation
- `change_events`: immutable diff events with read state and optional actor
- `usage_records`: attributed period records with unit, source, and reported/estimated USD provenance
- `app_settings`: price-per-credit, reporting currency, Billing snapshot,
  workspace budget, alert threshold, and overage-limit configuration
- `sync_runs`: success/failure history and row counts
- `access_plans`: expiring, single-use immutable membership previews
- `workspace_locks`: renewable leases shared by sync and access mutations

Assignment rules, role/group planning records, manual attestations and sync
settings/status live in `app_settings`. Directory snapshots and their success
records commit in one transaction. People API outages retain prior enrichment
and mark it stale; stale job-title rules cannot be applied.

Role imports use the workspace-scoped `openai-role-import:<workspaceId>` setting,
separate from `role-group-mappings:<workspaceId>` local plans. A single upsert
replaces a snapshot only after fetching and validating the complete role catalog
and every group's role list. Failure records a sanitized error and attempt time
without replacing the last successful snapshot. Imports share the workspace lock;
directory sync and the scheduler report role-import failures as partial results.
The UI reloads imported state after directory sync without resetting local drafts.
Permission states and inheritance flags are preserved, not interpreted as effective
access. Import sends GET requests only; it neither reconciles nor applies plans.

Indexes follow current queries: member email/entity, membership by group,
changes by time, and usage by member/period and period end.

## API routes

- `GET /api/dashboard` — saved dashboard or explicit demo fallback
- `POST /api/sync` — fetch, enrich, diff, and persist directory plus unified usage (Codex-only fallback)
- `POST /api/access-plan` — preview or explicitly apply a single-use membership plan
- `POST /api/group-membership` — retired (410); cannot bypass the reviewed plan
- `GET/PATCH /api/organizer-mappings` — person exceptions plus domain/structure/job-title rules; automatic rules choose one regular target
- `GET /api/organizer-structure` — verified reporting paths for current workspace members
- `POST /api/workspace-groups` — create and verify an empty manual group
- `GET/PATCH /api/role-group-mappings` — local plan and manual attestation only
- `GET/POST /api/role-import` — read saved snapshot / import roles and group assignments (all upstream calls are GET)
- `GET/PATCH /api/sync-settings` — opt-in schedule and sync status
- `POST /api/auto-sync` — authenticated loopback runner; never changes access
- `POST /api/usage-import` — normalized attributed CSV import
- `GET /api/analytics` — period, bucket, entity, and group-filtered analytics
- `GET/PATCH /api/settings` — persisted price-per-credit and currency settings
- `POST /api/changes-read` — persist change-inbox read state
- `GET /api/export` — Excel-friendly UTF-8 member CSV export

## Analytics model

The analytics query assigns each attributed source row to the daily, weekly, or
monthly bucket containing its `period_end`. It does not invent intra-period
usage. If a monthly source row is viewed daily, the response carries a warning
that the source is coarser than the requested chart. Group breakdowns overlap;
workspace and per-user totals do not.

For each row, a reported USD cost takes precedence over an OpenAI USD estimate;
older credit-only rows use the manually configured fallback rate. Token-only
rows remain unpriced. Unified rows supersede overlapping Codex-only credit rows
for the same user/day. Historical rows for departed members remain in workspace
totals but cannot be attached to current group/manager dimensions.

The finance layer keeps usage value and the dated manual overage balance separate.
It never calls usage value a payable invoice. The selected period is compared with
the immediately preceding equal-length period. Open periods use observed daily
value pace to project period-end usage value. The billing-cycle budget is prorated by day only
for unfiltered workspace selections; group/entity filters remain contribution
views because workspace budgets cannot be safely inferred per dimension.

## Provider roadmap

The usage adapter remains provider-based:

- Unified Daily Usage Analytics API using daily per-user rows and the workspace Admin key's
  `enterprise.analytics.usage.read` scope
- Codex-only Analytics fallback with `codex.enterprise.analytics.read`
- a separate invoiced Billing source only if its supported API/export and accounting semantics are verified
- API Platform usage only for API Platform activity, never presented as ChatGPT
  workspace usage
- Admin Console CSV as the portable fallback

An Enterprise Compliance API collector is the planned auditable source for
member-addition actors that are absent from directory responses. Its event
coverage, schema, permissions, and retention must be validated against the
current tenant API reference before implementation.

If a provider exposes only aggregate data, `codexlens` should show workspace and
group-safe aggregates only. It must not synthesize user attribution.

## Next increments

- add server-side authorization for multi-admin use
- integrate native workspace role/group assignment only when a supported API is available
- add OS/email/Slack notification adapters (current notifications stay in the app)
- add retention controls and encrypted local backup/export

Do not replay access plans: every retry requires a fresh preview, live
preconditions and explicit confirmation. Regular moves preserve `admin` and
`cat-team`; only individual special-group operations may change those memberships.
Auto-sync runs only while the local app process is alive and is paused by default.

Structure rules persist manager IDs, descriptive labels and one group ID in
`app_settings`; they do not persist a company-wide directory. The People API
directory cache is reused for the UI, but bypassed for membership preview and
confirmation. Exact email joins resolve workspace identities; stable manager IDs
form nearest-first ancestor paths. Matching checks the verified person's own ID
first (including a selected manager in their own structure), then their ancestors.
Unresolved paths block job-title fallback, not higher-priority person exceptions or domain rules.
Relevant ancestor paths are included in single-use access-plan fingerprints.
The verified person ID is also fingerprinted. Organizer and role-plan editors
stay mounted, but hidden, after their first visit so sidebar navigation does not
discard drafts or pending saves. Workspace/demo boundaries reset the editors;
page reloads warn about unsaved changes. Only explicit save persists the draft.
Organizer saves send the last-loaded rules revision, checked under the workspace
lock, so a long-lived draft cannot overwrite a newer save from another session.
