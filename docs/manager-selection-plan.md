# Management tab: selectable managers

Status: implemented locally; validation completed in synthetic demo mode.

## Objective and agreed defaults

Generalize the current `David's org` tab into **Management**. A user can select a person from the People API directory and inspect that person's direct reports and their reporting subtrees. David Roberts remains the initial selection through the existing `MANAGEMENT_LEADER_NAME` default. Preserve the current dark Admin Console aesthetic.

This is a selection and reporting refactor. Reuse the existing period controls, usage attribution, and invoice allocation policy. No database migration or change to workspace memberships is needed.

## Current implementation

- `app/ui/CodexlensApp.tsx` defines the navigation label and mounts `ManagementCostView` with dashboard data.
- `app/ui/ManagementCostView.tsx` requests `/api/management-cost?start=...&end=...`. Several KPI and table labels contain David's name. Its loading check currently compares only dates, so it must also account for manager selection.
- `app/api/management-cost/route.ts` resolves only `config.managementLeaderName`. It finds direct reports, walks current member reporting chains, calculates team shares, and adds an outside/unresolved reconciliation row.
- `lib/config.ts` already reads `MANAGEMENT_LEADER_NAME`, falling back to `David Roberts`.
- `lib/people-api.ts` provides unique email/name lookups and employee retrieval, but no candidate-search or profile-by-ID helpers. Profiles and manager references can include stable IDs.
- `app/types.ts` contains `davidOrgShare`, `davidOrgUsage`, `davidOrgInvoiceShare`, and `davidOrgAllocatedCost`.
- `tests/rendered-html.test.mjs` has a management test that mainly checks source strings. The test script currently runs only that file after a build.

## User experience

1. Rename the sidebar entry to **Management**, retaining the internal view ID `management` and existing links.
2. Place a **Manager** searchable combobox before the date controls. Show the selected person's full name, with role and department in search results; use email to distinguish duplicate names.
3. Load David by default, honoring the existing server configuration. Provide a **Reset to default** action. Keep selection when moving between app tabs by holding it in the app shell; a fresh page load returns to the configured default. No browser persistence is needed for this version.
4. Search the People API directory rather than only Codex members: a manager can own a team without having a Codex seat. Select a candidate by stable People ID. Do not pick the first matching name automatically.
5. Change the title to `<selected manager>'s teams`. Use neutral labels such as **Teams' invoice allocation**, **Teams' usage**, **Direct reports**, and **Share of selected teams**. The table heading includes the selected name. All warnings and reconciliation labels follow that selection.
6. Keep the selected period when switching managers. Fetch the new report immediately on selection. Replace previous results with a loading state until the selected manager and period have matching data.
7. Show explicit states for no search matches, a person with no direct reports, missing profile, missing sync, and unavailable People API. A failed selection must never silently fall back to David or show another manager's costs.
8. Support keyboard selection, Escape, visible focus, accessible result labels, and the existing responsive layout.

## Backend and data contract

### People directory helpers

Extend `lib/people-api.ts` with candidate search and profile-by-ID retrieval using the supplied People API endpoints:

- `GET /api/people?displayName=...` or `?email=...` for candidates;
- `GET /api/people/{id}` for the selected identity;
- the existing `GET /api/people/{id}/employees` for reporting structure.

Use encoded parameters and fixed configured People API origin. Reuse current response parsing, but verify response shapes and search matching behavior during execution; partial-name search and pagination are not established by the current client. If only full-name filtering is supported, make that clear in the search hint rather than claiming autocomplete coverage. Return candidates with stable IDs; missing IDs are not selectable.

### Candidate route

Add `app/api/management-managers/route.ts`:

- `GET /api/management-managers` resolves the configured default into a lightweight identity.
- `GET /api/management-managers?q=...` returns lightweight candidates: ID, name, email, title, department. Require at least two characters, cap query length and returned results (for example, 20), and report truncation when known.
- Do not retrieve the reporting tree for every search result. Confirm reports when a candidate is selected; zero reports is a valid empty state.
- Return separate default/search failures so a default-resolution error does not prevent searching for a different person.
- Debounce client searches (about 300 ms), cancel superseded requests, and bound server lookup concurrency and cache size. Keep upstream credentials and configuration on the server.

### Cost route

Extend the existing route to accept:

`GET /api/management-cost?managerId=<people-id>&start=YYYY-MM-DD&end=YYYY-MM-DD`

- If `managerId` is supplied, validate it and resolve exactly that profile by ID. Return a useful error for invalid or missing profiles, without falling back to the configured leader.
- If `managerId` is omitted, retain configured-default resolution for existing callers.
- Retain the response's `leader` identity. Rename David-specific fields consistently in route, types, and UI: `selectedOrgShare`, `selectedOrgUsage`, `selectedOrgInvoiceShare`, `selectedOrgAllocatedCost`.
- Replace `__outside_david_org__` with `__outside_selected_teams__` and construct the visible label from the selected name.
- Treat an empty direct-report list as a successful report with zero team rows and an explanatory empty state. An upstream failure must remain an error, not look like zero spend.
- Use People IDs for root identity, direct-report detection, and ancestry matching wherever available. Match Codex members to profiles by unique email when possible. Retain name fallback only when unique; conflicting names or incomplete ancestry stay unresolved.
- Preserve cycle/depth protection. Cache profile lookups with People API origin and identity in the key. Any added ownership/report cache must also distinguish selected manager, workspace, and directory sync version; never reuse one manager's ownership map for another.

## Reporting semantics to preserve and explain

- Each row represents a direct report and that person's complete subtree, including the direct report's own usage if they have Codex access. Direct reports without reports of their own are valid rows.
- The selected leader's own usage is not part of their direct reports' subtrees. Keep it in the reconciliation remainder for this refactor, and explain that the remainder includes usage outside the selected teams, the leader's own usage, and unresolved attribution. Do not imply that remainder consists only of confirmed outsiders.
- Use current People API reporting lines for historical usage; retain a visible note about this limitation.
- Team share = team usage / sum of selected direct-report team usage.
- Invoice fraction = team usage / entire workspace usage for the selected period. Switching managers must never change that denominator.
- Allocated estimated invoice = eligible saved invoice estimate x invoice fraction. Continue to distinguish this estimate from usage valued at price per credit. Preserve the current snapshot eligibility policy; a billing-policy redesign is a separate task.
- Selected teams plus reconciliation must account for workspace usage exactly once. Protect zero-usage denominators; when no usage exists, display shares as unavailable or zero consistently rather than claim a measured 100% split.

## Execution sequence for Luna

1. Check repository instructions and current diff in `/Users/milosz.kopij/Desktop/Codex Users/codexlens`. Preserve local environment files and existing work.
2. Add reusable manager identity types, People search/profile helpers, and the candidate route.
3. Parameterize the cost route. Extract just enough reporting logic into a helper to test ownership and allocation with synthetic fixtures. Update generic response fields and reconciliation copy together.
4. Add the combobox and selected-manager state; connect the new query parameter. Use request identity (manager ID plus period) and cancellation/sequence guards for both lookup and cost requests. Stop loading on failures and offer retry.
5. Rename the navigation and all personal labels, retaining the configured David default. Refresh the README description and clarify how manager selection and current reporting lines work.
6. Provide synthetic manager options and reports when dashboard mode is demo, including forced demo mode. Demo manager selection must not call the real directory or report routes. Use this for UI verification without organizational data.
7. Complete the checks below, then report the diff and verification results. The implementation is local and uncommitted; repository publishing remains a separate user-directed action.

## Verification and acceptance criteria

- Opening Management loads the configured default; selecting another person changes the title, rows, totals, warnings, and remainder without resetting dates.
- A manager without a Codex seat is selectable and their team's usage resolves through intervening managers without Codex seats.
- Two people with the same name are independently selectable by ID; ambiguous ancestry never merges their teams.
- Switching A -> B while A is loading cannot render A's results under B's name. Changing dates or receiving a failed request has equivalent coverage.
- No reports, unknown ID, unavailable People API, zero usage, and unmatched billing snapshot produce distinct, useful states.
- Synthetic allocation fixture: workspace usage 1,000, team rows 300 and 200, eligible estimated invoice $40. Expect team shares 60%/40%, workspace invoice fractions 30%/20%, costs $12/$8, and remainder 500 usage / $20. Verify the same denominator after selecting a different manager and verify leader personal usage remains explicitly in the remainder.
- Behavioral tests cover unique identity matching, subtree attribution, reconciliation, and default versus explicit selection. Update obsolete hardcoded-label assertions. Add new test files to the test command if necessary so these tests actually execute.
- Run `npm run lint` and `npm test` (which includes the production build), then check default/alternate manager selection, keyboard navigation, loading, and failure states in the browser using synthetic data.
- No David-specific display text or response fields remain except the intentional configured default and its documentation.

## Deliberately deferred

Historical org-chart snapshots, manager comparisons, saved manager favorites, a chart of the org tree, drill-down navigation, new billing rules, and bulk membership changes are outside this version.
