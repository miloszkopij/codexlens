# codexlens architecture

## Product boundary

`codexlens` combines three sources without pretending they have identical
semantics:

1. ChatGPT Admin API is authoritative for workspace members, groups, and manual
   group membership.
2. People API is authoritative for organizational role, department, manager,
   company, and entity enrichment.
3. Codex Analytics API is authoritative for daily per-user credits and turns.
   Attributed CSV records remain a fallback; aggregate-only sources cannot
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

Codex Analytics API ─ cursor pages ─ ID/email match ─ usage records ─ filtered analytics

Analytics CSV ─ fallback import ─ email match ────────────────┘

Price / credit + budget guardrails ─ settings route ─ local D1 ─ finance analytics

Member drawer ─ confirmation ─ Admin API write ─ read-back verification ─ local state

Organize tab ─ People role/entity filters ─ reviewed addition plan ─ confirmed writes
```

## Storage

- `members`: latest enriched member state plus workspace-addition provenance
- `workspace_groups`: latest group directory and management source
- `memberships`: latest many-to-many member/group relation
- `change_events`: immutable diff events with read state and optional actor
- `usage_records`: attributed period records with unit and source provenance
- `app_settings`: price-per-credit, reporting currency, Billing snapshot,
  workspace budget, alert threshold, and overage-limit configuration
- `sync_runs`: success/failure history and row counts

Indexes follow current queries: member email/entity, membership by group,
changes by time, and usage by member/period and period end.

## API routes

- `GET /api/dashboard` — saved dashboard or explicit demo fallback
- `POST /api/sync` — fetch, enrich, diff, and persist directory plus Codex usage
- `POST /api/group-membership` — confirmed manual group change with verification
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

Cost is derived for credit rows from the configured contract price. Direct cost
rows are treated as USD, while token-only rows remain unpriced. Usage value
is explicitly presented as monitoring/planning data rather than billing truth.

The finance layer keeps three values separate: usage value, reported/direct
cost, and a calibrated invoice estimate. The selected period is compared with
the immediately preceding equal-length period. Open periods use observed daily
burn to project period-end cost. The billing-cycle budget is prorated by day only
for unfiltered workspace selections; group/entity filters remain contribution
views because workspace budgets cannot be safely inferred per dimension.

## Provider roadmap

The usage adapter remains provider-based:

- Codex Analytics API using daily per-user rows and the workspace Admin key's
  `codex.enterprise.analytics.read` scope
- unified cost reporting when it contains the required workspace/user dimension
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
- add configurable entity aliases and role rules
- persist immutable bulk assignment plans for later approval and replay
- add scheduled local sync and OS/email/Slack notification adapters
- add retention controls and encrypted local backup/export
