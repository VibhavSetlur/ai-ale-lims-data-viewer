# KIND/KBase Integration and Cross-Branch Remediation Plan

**Status:** planning only. This plan authorizes no code, Git state, deployment, service, environment, data, or external-repository change.

## 1. Outcome, assumptions, and acceptance criteria

### Outcome

Produce a KIND-compatible packaging and operating path for the dynamic viewer while first establishing a repeatable, evidence-led process to review every meaningful difference between the dynamic and static-dev histories. Selectively propagate only shared bug, issue, and remediation fixes into the authoritative dynamic line without breaking dynamic AI integration, intentional dynamic user behavior, or static deployment and data constraints.

### Assumptions to validate, not treat as authority

- Plausible refs are `dev` (dynamic), `deploy/aiale-dev` (static dev), and `main`; the observed merge-base is `3e463b6`, with observed heads `dev=9b34fbe`, `deploy/aiale-dev=d6641a1`, and `main=e520d3c`.
- A prior inventory and the explicit seed list below both account for eight `dev`-only and 23 static-only commits. The later inventory must reconcile these 31 candidates against current authoritative refs and stop on any drift before disposition.
- `b18713a` and `e8acc3e` are dynamic AI/auth/workspace commits and are protected from bulk integration.
- The existing mode boundary is `src/lib/dataSource.ts:71-85`: server mode fetches APIs; static mode maps only supported curated endpoints to baked artifacts and degrades server-only endpoints.

### Invariants

1. Preserve intentional dynamic-only AI, authentication, workspace, API, raw-browser, and live-export behavior.
2. Preserve static-only export, prebaked-artifact, manifest, base-path, database, capability, and barcode-policy constraints.
3. Keep legacy KBase SDK work distinct from KIND integration. Legacy SDK documentation or access does not authorize KIND implementation.
4. Never blind-merge, bulk-cherry-pick, move a deployment pointer, or infer a branch role from its name.
5. Preserve unrelated dirty and untracked work, including existing `e2e/`, `ops/watchdog.*`, and `plans/` work, throughout all later execution.

### Non-goals

- No implementation, deployment, data publication, migration, credential change, install, restart, container publication, commit, push, merge, cherry-pick, or branch checkout is authorized by this plan.
- No replacement of dynamic server hosting with static export, or of static deployment with KIND.
- No decision on KBase identity, authorization, supported database, telemetry, registry, or product-default behavior without the responsible owner.

### Checkable acceptance criteria

1. **Inventory complete:** the committed review ledger has one record for every SHA in both ancestry ranges, including merge commits and patch-equivalent commits, with a final disposition and evidence reference.
2. **Selective propagation safe:** each admitted change has an isolated branch, `cherry-pick -x` provenance or a documented minimal reimplementation, and passes the shared and affected-mode verification matrix.
3. **KIND contract proven:** a declared environment can install, launch, readiness-check, and proxy the dynamic viewer under its declared root path while normal server operation remains unchanged.
4. **Release boundaries preserved:** static manifest/data/barcode checks and dynamic AI/user-flow checks pass before a shared fix is accepted; deployment refs remain unchanged unless a later explicit deploy authorization says otherwise.

## 2. Authority, branch roles, and evidence rules

Branch roles are provisional until Phase 0 records remote tracking configuration, ancestry, recent histories, and maintainer confirmation. `main` is normally the integration line under repository policy, `dev` is a source branch rather than a deployment target, and `deploy/aiale-dev` is a static deployment pointer, not a generic development branch. Do not assign authority from these names alone.

Authoritative evidence, in priority order:

1. actual local and, only if later authorized, fetched refs and object IDs;
2. inspected patch, parent topology, changed symbols, callers/consumers, and active runtime artifact;
3. linked issue/PR discussion and commit message;
4. reproducible behavior and verification results;
5. a maintainer decision where product, data, access, or branch ownership is involved.

A commit message, issue number, or apparent patch similarity is insufficient by itself. `git cherry` may establish patch equivalence but never establishes behavioral applicability.

## 3. Why reconciliation precedes and remains separate from KIND

Selective remediation is a branch-history and two-mode correctness exercise. KIND integration is a new packaging, lifecycle, proxy, manifest, release, and operations surface. Combining them would make a failure ambiguous: an AI integration regression could be caused by a static-derived fix, a mode boundary change, or KIND proxy packaging. Therefore reconcile shared fixes in small, independently verified batches before KIND adapter work consumes the resulting dynamic baseline. KIND-specific commits must not be used to justify propagation of static changes, and static deployment history must not be used as a proxy for KIND readiness.

Sequence protection: establish ref truth, inspect and classify all candidates, land only approved shared repairs on an isolated reconciliation branch, prove dynamic and static contracts, then build the KIND adapter against that accepted baseline. If the authoritative dynamic line changes, repeat the drift check before each KIND milestone.

## 4. Phase 0: preflight, ref snapshot, and ancestry proof

**Purpose:** create a reproducible, read-only evidence snapshot before any future remediation work.

**Actions**

1. Record `git status --short`, `git branch --show-current`, `git remote -v`, `git for-each-ref --format='%(refname:short) %(objectname) %(upstream:short)' refs/heads refs/remotes`, and `git show -s --format=fuller` for candidate heads. Store output outside the repository or in a later approved evidence artifact; do not alter worktree state.
2. Resolve actual commit IDs with `git rev-parse --verify <ref>^{commit}` and record `git merge-base <dynamic-ref> <static-ref>`, `git merge-base --is-ancestor`, and `git log --graph --decorate --oneline --all -n 80`.
3. If remote freshness is required, stop for explicit authorization before `git fetch --prune`; after authorization, snapshot before and after object IDs and repeat the ancestry proof. Fetching is not assumed harmless in this plan.
4. Confirm active artifacts: dynamic runtime source/configuration, static build inputs, `public/data/manifest.json`, declared database identity, and capability flags such as `hasBarcodes`. Do not claim current deployment state from Git alone.
5. Confirm the branch-owner table: authoritative dynamic target, static dev source/pointer, approval owners, and whether remediation may be staged in a reconciliation branch.

**VERIFY_CMD**

```bash
set -euo pipefail
DYNAMIC_REF=dev STATIC_REF=deploy/aiale-dev
printf 'dynamic='; git rev-parse --verify "$DYNAMIC_REF^{commit}"
printf 'static='; git rev-parse --verify "$STATIC_REF^{commit}"
printf 'base='; git merge-base "$DYNAMIC_REF" "$STATIC_REF"
git status --short
git for-each-ref --format='%(refname:short) %(objectname) %(upstream:short)' refs/heads refs/remotes
```

**Deliverable and exit:** dated ref/working-tree/authority snapshot plus confirmed branch-role table. Exit only when every ref used later is an object ID, not an assumed name; otherwise stop.

## 5. Phase 1: complete two-way inventory and per-SHA ledger

**Purpose:** enumerate all meaningful history differences before judging any change.

**Required extraction**

Run both directions from the proven merge base and retain merge topology:

```bash
set -euo pipefail
BASE=$(git merge-base "$DYNAMIC_REF" "$STATIC_REF")
git log --reverse --date=iso-strict --format='%H%x09%P%x09%ad%x09%s' "$BASE..$STATIC_REF"
git log --reverse --date=iso-strict --format='%H%x09%P%x09%ad%x09%s' "$BASE..$DYNAMIC_REF"
git log --left-right --cherry-mark --oneline "$DYNAMIC_REF...$STATIC_REF"
git cherry -v "$DYNAMIC_REF" "$STATIC_REF"
git range-diff "$BASE..$DYNAMIC_REF" "$BASE..$STATIC_REF"
```

For each commit, inspect `git show --stat --summary`, `git show --find-renames --find-copies`, and relevant `git diff <parent> <sha> -- <paths>`. For merge commits, inspect all parents and record the selected mainline rationale before any later cherry-pick attempt. A merge is never treated as one normal patch merely because `git show` emits a diff.

The ledger is mandatory for **every** candidate in both directions, including already-integrated and patch-equivalent changes. Fields:

| Field | Required record |
| --- | --- |
| Identity | SHA, parent(s), subject, author/date, source ref/range, merge status/mainline proof |
| Scope | files, changed symbols, callers/consumers, API/UI/static artifact/database/configuration impact |
| Provenance | issue/PR/commit-message links, stated intent, active-artifact evidence |
| Dependencies | prerequisite/follow-up SHAs, cluster, ordering, conflict surface |
| Equivalence | `git cherry` mark, range-diff result, existing implementation evidence |
| Classification | one taxonomy value below, provisional/final status, reviewer and timestamp |
| Disposition | propagate by `cherry-pick -x`, reimplement minimal equivalent, already present, defer/design, or reject |
| Acceptance | exact commands, exit codes, affected user/API/browser assertions, rollback point, final target SHA |

### Seed ledger, provisional only

The review runner must populate subject, date, paths, symbols, issue links, dependencies, equivalence, evidence, and final disposition for each row. Do not classify by family label alone.

| Source range and provisional family | Seed SHA(s) | Initial handling constraint |
| --- | --- | --- |
| DEV_ONLY: dynamic workspace | `b18713a` | Dynamic-only candidate; protected from bulk integration and requires workspace caller and user-flow review. |
| DEV_ONLY: dynamic auth/designs/assistant/Argo | `e8acc3e` | Dynamic-only candidate; protected from bulk integration and requires AI, auth, workspace, and user-flow review. |
| DEV_ONLY: shared issue fixes `#12/#13/#14/#15` | `135a908` | Shared-fix candidate only; inspect linked issue intent, symbols, callers, and both-mode behavior. |
| DEV_ONLY: `#12` typing patch-equivalent | `e664c07` | `git cherry` minus marker recorded; prove target symbols and behavior before an `already present` disposition. |
| DEV_ONLY: `#14` export legends | `602310c` | Shared-fix candidate only; inspect dynamic live-export and static unsupported-export boundaries. |
| DEV_ONLY: release metadata | `c891995` | Inspect release identity and mode/channel truth; do not infer shared applicability. |
| DEV_ONLY: assets patch-equivalent | `28892ae` | `git cherry` minus marker recorded; prove active asset and behavior equivalence before disposition. |
| DEV_ONLY: static/data identity patch-equivalent | `9b34fbe` | `git cherry` minus marker recorded; inspect active artifact/data identity before disposition. |
| STATIC_ONLY: plate factors | `5a784a6`, `c5ed37b` | Inspect together as a dependency cluster and review plate-design callers in both modes. |
| STATIC_ONLY: prebake freshness | `95549c4`, `251d5cd` | Inspect generated-artifact lifecycle and determine whether any shared source repair exists. |
| STATIC_ONLY: issue `#9/#10` plate fixes/releases | `8a6fac9`, `ac07cb9`, `e06ccd7`, `8fe6f7a`, `8367833`, `8c279b2`, `66d3dfe` | Inspect as dependency clusters, not independent commits; separate shared behavior from release/deploy history. |
| STATIC_ONLY: VerA/B grouping/release | `a946265`, `597cfc7` | Inspect data source, capability, UI consumer, and static artifact effects together. |
| STATIC_ONLY: mutation/data issues `#13/#14/#15` | `13cfaac`, `3b5e799`, `76d53ee`, `1c7b7f0`, `4fbbd81` | Inspect SQL/API contract, baked response, dynamic consumer effects, and error path together. |
| STATIC_ONLY: `#12` typing patch-equivalent | `ab94b07` | `git cherry` minus marker recorded; prove target symbols and behavior before an `already present` disposition. |
| STATIC_ONLY: metadata | `f21e522` | Inspect release/manifest identity and active artifact; do not presume it is deploy-only. |
| STATIC_ONLY: assets patch-equivalent | `a0b17a3` | `git cherry` plus/minus evidence must be recorded; prove active asset and behavior equivalence before disposition. |
| STATIC_ONLY: DB identity/static data | `4aeeb7a`, `d6641a1` | Presume static artifact/deploy candidate until active-artifact and shared-source evidence proves otherwise. |

This table explicitly seeds all 31 candidates: eight DEV_ONLY and 23 STATIC_ONLY. The known `git cherry` minus markers are DEV_ONLY `e664c07`, `28892ae`, `9b34fbe` and STATIC_ONLY `ab94b07`; they establish only a patch-equivalence lead. They do not prove a safe classification, final disposition, active-artifact equivalence, or permission to cherry-pick. An inventory run that differs from these 31 identities must record the discrepancy and stop classification until it is explained; never invent or omit a SHA.

**VERIFY_CMD**

```bash
set -euo pipefail
BASE=$(git merge-base "$DYNAMIC_REF" "$STATIC_REF")
test -n "$BASE"
git rev-list --left-right --count "$DYNAMIC_REF...$STATIC_REF"
git log --left-right --cherry-mark --oneline "$DYNAMIC_REF...$STATIC_REF" > /tmp/aiale-two-way-inventory.txt
test -s /tmp/aiale-two-way-inventory.txt
git cherry -v "$DYNAMIC_REF" "$STATIC_REF"
git range-diff "$BASE..$DYNAMIC_REF" "$BASE..$STATIC_REF"
```

**Deliverable and exit:** complete ledger, count reconciliation, and graph/patch-equivalence evidence for every candidate. Exit only when no SHA is unrecorded or silently omitted.

## 6. Phase 2: evidence-led classification and selection

Use exactly one classification for each final record:

1. **safe shared fix**: behavior is intended in both dynamic and static modes; changed symbols and consumers support equivalent behavior; no AI/auth/workspace, active-artifact, or deployment/data constraint is violated.
2. **dynamic-only**: required for dynamic server, AI integration, auth, workspace, raw-browser, live export, or another intentionally dynamic user flow.
3. **static-only artifact/deploy**: generated data, manifest identity, base-path asset output, static deployment metadata, static database/capability behavior, or deployment-pointer-only work that is not shared source behavior.
4. **conflict/needs design**: intent, ownership, behavior, dependency, data policy, or integration impact is uncertain or conflicts across modes.
5. **unrelated**: does not correct a shared behavior and has no justified propagation value.

For every candidate require: issue/PR/commit-message evidence; changed-symbol inspection; direct callers and consumers in both modes; active-artifact check; dependency cluster analysis; and a patch-equivalence result. A candidate with missing issue context may still be assessed from code and runtime evidence, but it cannot be called an issue fix without that evidence.

Dependency clusters are ordered topologically and, within a cluster, oldest first. Do not split a cluster if a later commit depends on earlier code or generated data. Handle merge commits only after parent topology and `-m <parent-number>` applicability are proven on a disposable later-authorized branch. Treat `git cherry` `-` or range-diff equivalence as **already present** only after confirming the target's symbols and behavior; otherwise use **reimplement minimal equivalent** or **defer/design**.

**VERIFY_CMD**

```bash
set -euo pipefail
# Ledger review gate: every emitted candidate has evidence and one final disposition.
# Replace LEDGER with the approved ledger path once execution is authorized.
awk -F'\t' 'NR>1 {if ($1=="" || $7=="" || $8=="" || $9=="") exit 1} END {if (NR<2) exit 1}' "$LEDGER"
```

**Deliverable and exit:** reviewed, dependency-ordered ledger and an approved candidate queue. Exit only when all candidates are classified or explicitly deferred; a missing dependency, ambiguous behavior, missing ref/issue evidence, data/migration/security effect, or possible AI/user regression is a stop condition.

## 7. Phase 3: selective propagation protocol

Only final `safe shared fix` records may enter this phase. Work in small dependency-complete batches, normally one cluster or one independently verifiable repair. Before each batch, record a clean recovery point: source and target object IDs, `git status --short`, exact ledger rows, and the test baseline. Preserve unrelated dirty/untracked files. Use a new, later-authorized reconciliation branch from the owner-approved dynamic target; do not work directly on deployment refs.

For each accepted record, choose exactly one disposition:

- **propagate by `cherry-pick -x`**: clean, applicable non-equivalent source patch with provenance retained.
- **reimplement minimal equivalent**: patch is structurally unsuitable or conflicts, but the verified shared behavior is appropriate; cite source SHA and explain the smallest equivalent change.
- **already present**: target patch and behavior proven equivalent; no duplicate change.
- **defer/design**: needs owner/design decision, dependency, data policy, or integration clarification.
- **reject**: static-only, dynamic-only, unrelated, or unsafe for the authoritative dynamic behavior.

No blind cherry-picks. Inspect the staged diff and symbol callers after each application. If a conflict occurs, do not use destructive Git commands, force resets, or worktree-cleaning commands. Preserve the conflict state and evidence, then either resolve only if the acceptance record already specifies the semantic resolution, abort that one operation safely, or stop for design. A failed batch is not retried by broadening scope. Keep prior accepted batch commits intact and recover by creating a new branch from the last recorded clean recovery point when authorized.

**VERIFY_CMD**

```bash
set -euo pipefail
git status --short
git diff --check
git log -1 --format='%H%n%B'
# For cherry-picked rows, verify source provenance:
git log --format='%B' -n 1 | grep -F 'cherry picked from commit'
```

**Deliverable and exit:** one small batch with ledger dispositions, source-to-target provenance, clean diff, and completed batch test record. Exit each batch only when its defined dynamic, static, and affected-flow gates pass; otherwise restore the last non-destructive recovery point and defer.

## 8. Verification matrix for remediation batches

Run the repository's established runtime only when later execution authorization permits it. Installs, restarts, prebakes, static builds, and deployment actions remain approval-gated. Template commands must be bound to validated refs, ports, database, and artifact paths at execution time.

| Surface | Required assertions |
| --- | --- |
| Shared type/build | `npx tsc --noEmit`, `npm test`, `npm run build`, and `git diff --check` pass. |
| Dynamic server | Built server exposes `/api/health`; affected `/api/mutations` or issue endpoint returns intended data and error behavior; affected browser flow works. |
| Dynamic AI/user boundary | AI/auth/workspace callers retain expected behavior; no static-derived change disables, leaks, changes default behavior, or bypasses dynamic user functionality. Exercise the affected AI and non-AI user flow where applicable. |
| Static mode | Static build uses declared non-root base path; curated views use baked data only; no forbidden runtime `/api/*` dependency; unavailable server-only endpoints degrade as designed. |
| Static data/manifest | `public/data/manifest.json` identity/timestamp/files are truthful for the declared source; expected DB and `hasBarcodes` agree with the artifact; barcode tab visibility and restored-tab fallback agree with capability. |
| KIND lifecycle | CLI/install, `kind-install`, manifest schema, release metadata, serve/root-path/proxy/readiness, shutdown, and normal server non-regression are exercised after KIND implementation begins. |
| Legacy KBase | Existing SDK behavior/docs remain unmodified unless a separately approved legacy task says otherwise. |

Suggested later-authorized commands:

```bash
source /scratch/vsetlur/anaconda3/etc/profile.d/conda.sh && conda activate ai-ale-dev
npx tsc --noEmit
npm test
npm run build
git diff --check
# Server lifecycle and curl are run only after explicit service authorization.
# Static prebake/build and manifest inspection are run only for an approved target.
```

For every batch, add exact command, exit code, fixture/DB identity, browser/API assertion, and error-path assertion to its acceptance record. Test the integration boundary, not only unit assertions: a mutation/data fix must cover API-to-consumer-to-static-artifact behavior; a UI fix must cover user navigation and state restoration; an AI-adjacent change must cover its direct dynamic caller.

## 9. KIND/KBase integration architecture and phases

### Architecture boundaries

The viewer retains dual modes from one codebase. Server mode supports live APIs, raw database tables, and live CSV export; static mode exposes curated prebaked JSON and hides unsupported raw/export behavior. KIND hosts the server-mode application behind a double reverse proxy. It is not a static deployment channel.

The KIND adapter must provide: declared package/distribution metadata; CLI and `kind-install`; a public manifest; release metadata and changelog; a local-only serve contract; root-path-aware asset and API routing; a cheap readiness endpoint; lifecycle-safe startup/shutdown; configuration validation; and an operator runbook. Manifest content must be authored from public surface only. Bind to `127.0.0.1`, accept declared port/root path, use relative/root-prefixed assets, retain the required trailing proxy slash, and do not introduce forwarding-header configuration that conflicts with KIND's doubled proxy behavior. Readiness must return a fast non-5xx result without heavy work.

Data, auth, and security stay explicit: do not package sensitive/full database content or credentials inadvertently; do not assume KBase identity confers data access; bind locally; validate root path/proxy behavior; define timeout and shutdown behavior; retain native `better-sqlite3` compatibility through the declared runtime; and do not add telemetry or registries without owner policy.

### Milestone 0: viability and ownership

Prove selected KIND target, manifest owner, data-access model, release channel, and whether container hosting is required. Verify a proxied root-path proof using the existing dynamic viewer before adapter implementation.

**VERIFY_CMD:** `test -n "$KIND_TARGET" && test -n "$MANIFEST_OWNER" && test -n "$DATA_POLICY_OWNER"` plus an approved root-path smoke command.

**Exit:** owners and target are recorded; no KIND implementation begins on guessed infrastructure.

### Milestone 1: shared-fix reconciliation baseline

Complete Phases 0-3 and admit only approved remediation batches to the authoritative dynamic line through reviewed integration.

**VERIFY_CMD:** all commands and acceptance records in Sections 5-8 for every admitted batch.

**Exit:** ledger complete, accepted baseline proven in dynamic and static modes, and no dynamic-only behavior crossed accidentally.

### Milestone 2: adapter proof of concept

Implement packaging/release metadata, CLI, `serve`, `kind-install`, manifest draft, local launch configuration, readiness probe, and documented smoke path. Exercise proxied root-path launch with one API/data path and normal server invocation.

**VERIFY_CMD:** declared-environment install/launch command, readiness curl, root-path browser/API smoke, `npx tsc --noEmit`, `npm test`, `npm run build`, `git diff --check`.

**Exit:** clean declared environment launches through adapter, readiness and smoke pass, and normal server path remains unchanged.

### Milestone 3: contract hardening

Add parity fixtures for curated responses, static artifacts, capability combinations, root paths, failure states, and configuration validation. Test unavailable DB/API, malformed/missing artifact, unsupported capability, bad base path, and readiness timeout.

**VERIFY_CMD:** approved fixture suite plus shared type/test/build/diff commands.

**Exit:** CI distinguishes intentional static limits from regressions and fails on KIND or mode-contract drift.

### Milestone 4: release candidate

Finalize version/release metadata, CLI/operator docs, security review, KING manifest review, and KBase/KIND acceptance test. Follow the guide's lifecycle obligations: viable premise, install/catalog, release UX and data axis, public-home/data grants where applicable, light serving, diagnostics policy, skin seam where applicable, standalone hosting, and cross-app contracts declared adopted or N/A.

**VERIFY_CMD:** manifest validation, lifecycle checklist, KIND acceptance command, and release metadata consistency review.

**Exit:** owning process accepts manifest and lifecycle requirements; rollback is rehearsed without moving static deployment refs.

### Milestone 5: controlled maintenance

Release KIND independently. Apply the reconciliation ledger and taxonomy to future changes; a shared fix goes through the same evidence and two-mode gates, while dynamic-only and static-only work remains in its domain.

**VERIFY_CMD:** drift check plus one documented shared-fix and one isolated dynamic-only example.

**Exit:** two release cycles demonstrate safe shared propagation and preserved isolation.

## 10. Release, manifest, serve, and handoff requirements

- Maintain truthful release version, channel, branch, commit, mode, expected DB, barcode policy, and snapshot identity. A data refresh alone does not imply a viewer version bump.
- Validate manifest identity and baked files against the exact static DB/artifact when static work is approved. KIND manifest/release metadata describes the dynamic app and must not claim static deployment identity.
- Keep `serve` proxy-safe: declared port and root path, local bind, root-prefixed/relative URLs, trailing slash, fast readiness endpoint, and lifecycle tolerance for reuse/adoption/group stop.
- Document install, `kind-install`, CLI, configuration, data availability, readiness, error handling, rollback, and support ownership. State explicitly which data modes and user paths are unavailable rather than silently degrading critical functionality.
- Retain a release handoff containing ref snapshot, ledger location, accepted/rejected/deferred disposition summary, KIND target/owner decisions, verification commands/results, active artifact identities, recovery points, and unresolved owner questions.

## 11. Stop conditions and owner decisions

Stop rather than improvise when refs or branch authority are missing; inventory counts disagree; issue/PR context or dependencies cannot be established; a merge mainline is uncertain; behavior is ambiguous; a conflict changes semantics; data, migration, security, credential, authorization, telemetry, or access policy is implicated; an AI/user flow regresses; or dynamic/static verification fails twice for the same gap.

Owner decisions required before implementation:

1. authoritative dynamic line and reconciliation-branch owner;
2. KIND environment, distribution, manifest owner, and release process;
3. authentication/authorization and permitted KIND data source, retention, and redaction;
4. container/registry, telemetry, security, and support policy if applicable;
5. product behavior for unavailable data, unsupported features, and export capability.

The smallest unblock for a stop is one evidence-backed owner decision recorded against the affected ledger row or milestone, followed by rerunning only that phase gate.

## 12. Post-propagation synchronization policy

Shared fixes are authored or normalized on the owner-approved shared integration line whenever practical. If a static-origin repair must be forwarded, create a ledger row first and use the selective protocol rather than silently copying it. Every future divergence gets a forward-port ledger entry with source SHA, target, classification, owner, evidence, and disposition.

Run drift checks before every KIND milestone, before a static promotion proposal, after a remediation batch, and on a regular owner-approved cadence. The check uses validated refs, merge-base, two-way `git log`, `git cherry`, and `range-diff`; it is not satisfied by commit counts alone. Deployment branch pointers and approved webroots do not move absent explicit static deploy authorization. The only active static promotion path is to `deploy/aiale-dev`, followed by a rebuild against the declared dev database and HTTPS, manifest, and byte-range verification. The Phase 1 amendment below supersedes prior public/private promotion language; those records are historical inspection-only.

## 13. Execution handoff for the later principal and runner

The principal should commission one read-only runner mission to execute Phases 0-2 evidence collection and return a filtered ledger, not patches. The runner contract must name the validated refs, forbid checkout/fetch unless separately authorized, preserve worktree state, inspect both ranges and all parents, and return file/symbol/caller/artifact evidence plus one disposition recommendation per SHA. The principal decides ambiguous classifications and owner-policy questions; a foreman later executes only settled, small propagation batches.

No phase may be compressed away: each has its own `VERIFY_CMD`, deliverable, and exit condition above. The first execution report must explicitly reconcile the stated 31-candidate count with the seed rows and report missing or duplicate identities as a blocker rather than hiding them.

---

## Execution amendment: 2026-09-17 Phase 1 reconciliation status

**Status: settled documentation/provenance boundary.** This amendment supersedes earlier provisional branch-role language and any earlier text that describes public/private deployment as a current promotion or rebuild flow. `dev` is the active dynamic line; `deploy/aiale-dev` is the only active static lineage; `main` is historical/integration evidence pending explicit reconciliation. Public/private records are historical inspection-only, not operational targets.

### Settled model and ref snapshot

- Current local `dev`: `9b34fbed`; `main`: `e520d3c`; `deploy/aiale-dev`: `d6641a1`; `origin/deploy/aiale-dev`: `f21e5228`.
- Reconciled merge-base: `3e463b6`.
- The seven candidates below are already present or equivalent in current `dev`. No source port is required or authorized.
- Source/caller evidence: `src/app/api/mutations/route.ts:758-795` supplies the MutationExplorer registry; `src/components/MutationExplorer.tsx:880-1050,1295-1385` consumes it in the UI; `src/lib/figureSpec.ts:782-805,1027-1041` generates exports; `MutationExplorer.tsx:4662-4668,4861,4946-4949` owns selection and legend behavior. The existing focused test is `src/lib/figureSpec.test.ts:4-24`.

### Complete settled candidate ledger

| SHA | Classification | Symbols/caller evidence | Disposition | Test evidence |
| --- | --- | --- | --- | --- |
| `135a908` | already-present/equivalent | `route.ts` registry and `MutationExplorer.tsx` registry UI; API-to-UI caller path above | no port | `figureSpec.test.ts:4-24` exists; not run in this documentation pass |
| `e664c07` | already-present/equivalent | MutationExplorer Breseq registry typing; registry UI caller path above | no port | no focused test identified; no test run claimed |
| `602310c` | already-present/equivalent | `figureSpec.ts` copy-number export legends; export caller path above | no port | `figureSpec.test.ts:4-24` exists; not run in this documentation pass |
| `13cfaac` | already-present/equivalent | `route.ts` mutation data flow; MutationExplorer registry consumer above | no port | no focused test identified; no test run claimed |
| `3b5e799` | already-present/equivalent | MutationExplorer selection/legend and `figureSpec.ts` export behavior; callers above | no port | `figureSpec.test.ts:4-24` exists for export behavior; not run in this documentation pass |
| `1c7b7f0` | already-present/equivalent | `route.ts` and MutationExplorer registry filtering; API-to-UI caller path above | no port | no focused test identified; no test run claimed |
| `4fbbd81` | already-present/equivalent | MutationExplorer copy-number lineage legends at `4861,4946-4949` | no port | no focused test identified; no test run claimed |

### KIND reversible boundary

The accessible guide specifies a minimal app manifest with `type: "app"`, a canonical hyphenated `id`, and `launch.cmd` whose executable is on `PATH` (`APP_DESIGN_GUIDE.md:430-465`). Its minimal launch command must receive `{port}` and `{proxy_path}`, and the app's `serve` command must accept the declared port and `--root-path`; a readiness probe may use `/api/health`. The proxy/lifecycle contract requires local `127.0.0.1` binding, root-path-prefixed assets and relative links, a trailing proxy slash, a fast non-5xx readiness endpoint, no forwarded-header configuration, and tolerance of reuse/adoption/group stop (`APP_DESIGN_GUIDE.md:517-529`). Legacy KBase SDK work remains distinct from KIND.

No KIND implementation is authorized: this repository has no authoritative KIND schema, CLI, or runtime. Package identity/distribution, manifest owner, and permitted data policy remain unresolved. Exact unblocks are either: (1) provide the owner-approved KIND package id, distribution/CLI/runtime, manifest owner, and data/retention policy; or (2) provide an accessible authoritative KIND installation plus schema/CLI contract and a named owner who accepts the resulting manifest and lifecycle behavior.

### Execution amendment: 2026-09-17 KIND boundary decision table

| Required boundary | Known repository interface/caller | Decision | Why no executable fixture is landed |
| --- | --- | --- | --- |
| Server launch | `package.json:8` exposes only `npm start` (`next start`) | blocked | No declared KIND package, console name, manifest owner, or authoritative launcher argv exists from which to derive a non-speculative `launch.cmd`. |
| Proxy root path | `next.config.ts:12-28` reads `NEXT_PUBLIC_BASE_PATH` only for static export; server mode has no root-path option | blocked | A test asserting `--root-path` support would invent adapter behavior and could alter the dynamic/static boundary. |
| Readiness | `src/app/api/health/route.ts:5-42` is consumed by `ops/serve.sh:113`; it probes the database before returning 200/503 | blocked | This is a known health consumer, but it is not proven to meet KIND's cheap readiness/lifecycle contract; do not label it a KIND probe without owner/runtime authority. |
| Manifest, install, release | No KIND package, CLI, manifest, or release metadata exists in `package.json:5-14` or repository scripts | blocked | Fixtures would choose an id, distribution, command, schema, and lifecycle policy that the accessible guide explicitly leaves app-owned. |

**Hard-block conclusion:** tests would either merely restate guide prose or assert invented CLI/manifest behavior, neither of which validates an integration. No source, UI, API, static, package, or test change is warranted. The exact unblocks remain: **(1)** an owner-approved KIND package id, distribution/console, CLI/runtime, manifest owner, and data/retention policy; or **(2)** an accessible authoritative KIND installation/schema/CLI contract plus a named owner accepting the manifest and lifecycle behavior. With either, implement the smallest adapter and focused launch/root-path/readiness fixtures against that authority.

### Execution amendment: 2026-09-17 local adapter evidence

A local-only Python `kind` package now provides a reversible adapter without changing the dynamic/static boundary. Its provisional `ai-ale-lims-viewer-kind` manifest uses only the guide's documented load-bearing `type`, `id`, and list-form `launch.cmd`; `kind-install` only validates and emits JSON locally or beneath `kind/`, and never invokes or writes external KIND state. `serve` has fixed `npm start` argv, loopback-only listener/proxy, normalized root-prefix handling, HTML root URL rewriting, `/api/kind-ready` polling, and child process-group cleanup. The dedicated route returns quick JSON and has no DB import/query.

This is local evidence, not catalog onboarding or registration. The provisional identity, manifest ownership, catalog repository, release track/tag, and data/retention policy remain blocked pending owner approval. Exact unblocks: an owner-approved durable package/catalog identity and manifest owner, plus approved release/data policy and access to the authoritative external KIND runtime/schema. No `release.yaml` is issued because those documented fields would make unsupported release claims.

### Execution amendment: 2026-09-18 repository-side completion

The local adapter exists on `dev` at `7208ad3f81daa39e6498f8439a045284f3c3d5fd` and is the only implementation authorized by this amendment. It supersedes the earlier planning-only statement only for the local `kind` package, focused tests, dedicated readiness route, and local operator documentation. It does not authorize catalog registration, publication, deployment, service operation, static promotion, or an external KIND mutation.

The adapter is a guide-derived local template, not an asserted external schema. `kind/cli.py` keeps the manifest in memory and permits output only beneath `kind/`; `pyproject.toml` defines a zero-dependency local console entry point; `kind/test_cli.py` covers its bounded behavior; and `src/app/api/kind-ready/route.ts` remains independent of database-backed health. The dynamic/static boundary is unchanged: the adapter invokes server-mode `npm start`, while static handling remains in the existing static data source and build configuration.

No viewer release bump is justified. The local adapter is documented as non-viewer release work in `CHANGELOG.md`, and `pyproject.toml` retains its pre-release local-tool version `0.0.0`. A `release.yaml` would require unsupported durable identity, repository, track, tag, function, and data claims. Before external onboarding, obtain: (1) owner-approved package/catalog identity and manifest owner; (2) authoritative KIND runtime, schema, and registration procedure; (3) approved data, retention, and redaction policy; and (4) approved release/catalog acceptance process. No deployment is claimed.
