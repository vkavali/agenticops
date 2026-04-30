# AgenticOps — Roadmap to Harness Parity

## Positioning

Match the Harness module surface (CI, CD, FF, CCM, STO, SRM, IaCM, IDP, Chaos,
GitOps), but lead with **agentic auto-remediation** as the differentiator: the
agent detects → diagnoses → proposes IaC patch → opens PR → applies with
approval. Harness has the breadth; we win on the autonomy loop.

## Current state vs. Harness

| Harness module           | AgenticOps today                  | Gap                                                  |
| ------------------------ | --------------------------------- | ---------------------------------------------------- |
| CI                       | `executor.js` runs stages         | No artifact registry, caching, matrix, parallel      |
| CD                       | `deployments` table               | No promotion, canary/BG/rolling, approval, rollback  |
| Feature Flags            | —                                 | Module missing                                       |
| Cloud Cost Mgmt          | —                                 | Module missing                                       |
| Security Testing (STO)   | —                                 | Module missing                                       |
| Service Reliability      | `incidents` (basic)               | No SLOs, error budgets, burn-rate alerts             |
| Chaos Engineering        | —                                 | Module missing                                       |
| IaC Management           | Static diff modal in `App.jsx`    | No real TF state, plan/apply, drift detection        |
| Internal Dev Portal      | `services` table                  | No catalog, scorecards, templates                    |
| GitOps                   | GitHub OAuth + clone              | No sync loop, app-of-apps                            |
| DB DevOps                | —                                 | Module missing                                       |
| **RBAC / Audit / Secrets** | None                            | Critical foundation — blocks everything else         |

## Phased delivery

### Phase 0 — Foundation (must come first) ✅

Blocks every other module. No agent should mutate infra without these.

- [x] Auth middleware (bearer token via env, swap for OIDC later) — `server/auth.js`
- [x] RBAC: roles (viewer, operator, admin), per-route guards
- [x] `audit_log` table — append-only record of every mutation — `server/audit.js`
- [x] Secrets manager: encrypt `github_connections.access_token`, `connected_repos.webhook_secret`,
      and `cloud_connectors.credentials` at rest (AES-256-GCM) — `server/crypto.js` + `migrate-secrets.js`
- [x] Approval gates primitive — reusable across pipelines, IaC, chaos — `server/routes/gates.js`
- [x] SSE heartbeat + per-client error isolation in `broadcast()` — `server/sse.js`
- [x] CORS lockdown (allowlist via `APP_CORS_ORIGINS`)
- [x] GitHub webhook HMAC signature verification (was a TODO)
- [x] Frontend token gate — `src/TokenGate.jsx`

#### Bootstrap

1. `openssl rand -hex 32` → set `APP_ENCRYPTION_KEY`
2. Generate a random admin token → set `APP_BOOTSTRAP_ADMIN_TOKEN`
3. Boot — the bootstrap token becomes the first admin
4. `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"role":"operator","label":"alice"}' /api/tokens`
5. Hand that token to the user; they paste it into the TokenGate prompt

### Phase 1 — Close obvious CI/CD gaps ✅

- [x] CD: env promotion (dev → staging → prod) with approval gates — `server/strategy.js`
      auto-creates a gate for `production`, parks the deploy in `pending-approval`,
      auto-resumes when the gate listener fires.
- [x] Deployment strategies: canary, blue-green, rolling — phase progression with
      `provisioning → canary-10/50/100 → verifying → complete` (and equivalents).
      Strategy is set at deploy creation; engine drives state.
- [x] One-click rollback per deployment — `strategyRollback` cancels in-flight
      progression and marks the env `rolledback`.
- [x] Pipeline templates + reusable step library — `server/routes/templates.js`,
      `${VAR_NAME}` substitution + `/instantiate` to clone into a new pipeline.
- [x] Artifact registry metadata — `server/routes/artifacts.js`, dedupe on
      (registry, repository, tag).
- [x] Parallel stage execution in `executor.js` — consecutive `stage.parallel`
      stages run concurrently within a batch; batches run sequentially.
- [x] Pipeline-level timeout — `pipeline.timeout` ("30m", "2h"); SIGKILLs all
      in-flight processes for the run on expiry.

### Phase 2 — Lead wedge: agentic IaC remediation ✅ (core)

The headline demo. The hardcoded Lambda diff in `App.jsx` is now replaced
with the live agent-proposed patch when one exists.

- [x] Real Terraform runner: `terraform init/plan/apply` from cloned repo —
      `server/iac.js`. Streams logs via SSE under `iac:log`. Uses
      `-detailed-exitcode` so drift checks distinguish "no changes" from
      "changes pending".
- [x] Drift detection: scheduled sweep — `startDriftSweep()` walks every
      config and re-plans on its configured interval; emits
      `iac:run-finished` with `status='drift-detected'`.
- [x] Agent diagnosis: `server/agent.js` calls `claude-opus-4-7` with
      adaptive thinking (`effort: "xhigh"`). Prompt-caching layout: system
      instructions + Terraform source as cached blocks; incident +
      `terraform plan` output as the volatile user message. Verified via
      `usage.cache_read_input_tokens` (logged in the run).
- [x] Apply gate: when the agent proposes a non-empty patch we call
      `createGate(subject_type='iac_run', required_role='operator')` and
      park the run. `routes/iac.js#apply` refuses unless the gate is
      approved.
- [x] Static `App.jsx` diff modal replaced — fetches
      `/api/iac/latest-proposal` and renders the agent's diagnosis +
      unified diff. Falls back to the demo diff only when no real proposal
      exists yet.
- [x] Auto-PR flow: `openRemediationPR()` clones, creates a branch
      (`agenticops/remediation-<runId>`), applies the patch, commits with
      the agent's identity, pushes, and opens a PR via the GitHub API.
      The diagnosis goes into the PR body; gate id + source run id are
      cited. `/api/iac/runs/:id/apply` defaults to PR mode when the
      config has a linked repo (`mode: 'in-place'` overrides). Webhook
      handler in `routes/github.js` watches `pull_request.closed` events
      — `merged: true` triggers `terraform apply` against the merged
      base; `merged: false` marks the run closed.
- [x] CI checks gate — `verifyChecksPassing()` queries GitHub
      `/repos/.../commits/{sha}/check-runs` before applying. Refuses
      apply if any check failed or is still pending; fails closed on
      fetch errors. Skipped only when no checks are configured.
- [x] Rollback by re-running apply at the previous SHA — `runRollback()`
      full-clones, checks out the target SHA, re-runs `terraform apply`.
      `iac_runs.applied_sha` / `previous_sha` / `rolled_back_from`
      track lineage. `/api/iac/runs/:id/rollback`.
- [ ] **Follow-on:** TF state visualization driving the topology view.

### Phase 3 — Fill out remaining surface

Schema + skeleton routes + minimal UI per module. Polish opportunistically.

- [x] **SRM**: `slos` + `slo_evals` — 60s evaluator computes availability
      or latency SLI from `health_checks`, derives error budget +
      burn rate, auto-creates incidents at burn ≥ threshold.
- [x] **Feature Flags**: rules + percentage rollout + SLO-aware
      auto-pause (1.5×) and auto-rollback (2×). The agentic angle.
- [x] **CCM**: `cost_data` + anomaly detection + recommendations.
      **Real AWS Cost Explorer adapter** (`server/cost-aws.js`) polls
      `GetCostAndUsage` daily per `cloud_connectors` row with
      `provider='aws'`, decrypts credentials from the encrypted-at-rest
      envelope, upserts grouped-by-service cost rows. `seedSyntheticCosts`
      remains as a demo fallback when no connector is configured.
- [x] **STO**: `security_scans` + `security_findings` schema with
      severity rollup. Generic ingest endpoint accepts findings from any
      scanner (Trivy/Semgrep/Snyk wrappers). `hasOpenCriticalFindings`
      exposed to other modules as a deployment pre-flight gate.
- [x] **Chaos**: experiments + gated runs + auto-abort on linked SLO
      burn ≥ 1.5×. Fault types modeled (latency, error-rate, pod-kill,
      cpu-stress, network-loss); a real provider (LitmusChaos / Gremlin /
      Chaos Mesh) plugs into `startInjection`/`clearInjection`.
- [x] **IDP**: scorecard computer (`server/idp.js`) — 30-min sweep
      computes SLO compliance, incident health, deploy freshness, and
      security posture per service from existing data; letter grades A-F.
- [x] **GitOps**: `gitops_apps` + `gitops_syncs`. 60s sweep clones each
      app's repo, hashes the manifest tree, compares against
      `last_sync_revision`, emits drift events. Real apply requires a
      kubectl/helm plug-in at `gitops:sync-applied`.
- [x] **DB DevOps**: `db_migrations` + safety analyzer. Heuristic SQL
      pass flags destructive DDL (DROP/TRUNCATE), unrestricted UPDATE/
      DELETE, ADD COLUMN NOT NULL without DEFAULT, non-CONCURRENT
      CREATE INDEX, etc. Score < 50 → admin-required gate; else
      operator-required gate.

## Frontend tabs (Phase 3 surface)

All eight new modules now have visible tabs in the sidebar with the same
visual language as the existing views (border-2 black, mono accents):

- **Flags** (⌘6): list + start/pause/resume/rollback rollouts; modal
  exposes increment %, interval, and SLO auto-pause linkage.
- **SLOs** (⌘7): list with live SLI / budget / burn columns from the
  evaluator; create dialog covers availability + latency types.
- **Cost** (⌘8): anomaly table, idle-resource recommendations,
  spend-by-service rollup, manual sweep trigger.
- **Catalog** (⌘9): per-service scorecard cards (SLO / Incidents /
  Deploys / Security with letter grades + overall grade).
- **Security**: scan history with severity rollup, findings list with
  resolve/ignore actions.
- **Chaos**: experiments with run-request flow, recent runs table,
  manual abort, create-experiment modal with SLO auto-abort selector.
- **GitOps**: app list with last-sync status badge, sync-history side
  panel, register-app modal.
- **DB DevOps**: SQL submission with live safety analysis (warnings +
  score), migration history.

Shared primitives in `src/components/views.jsx`: PageHeader, Badge,
Grade (A-F), MetricCard, EmptyState, fmtUSD/fmtPct/fmtAgo.

## Phase 4 — Real K8s integration ✅ (rolling + GitOps apply)

- [x] **kubectl wrapper** (`server/k8s.js`): runs against any
      `cloud_connectors` row with `provider='kubernetes'`. Kubeconfig
      lives in the encrypted credentials envelope, gets written to a
      temp file scoped to the call (`mode 0o600`), `KUBECONFIG` set,
      kubectl spawned, output streamed via `k8s:log` SSE, temp dir
      cleaned. Helpers: apply (kustomize), set image, rollout status,
      rollout undo, version.
- [x] **Real GitOps apply**: `gitops_apps.cluster_connector_id` links
      an app to a K8s cluster. When auto-sync triggers and a connector
      is wired, the sweep runs `kubectl apply -k` against the manifest
      directory, captures the `created/configured/unchanged/deleted`
      lines into `gitops_syncs.changes`, and emits `gitops:sync-applied`
      with the count. No connector → falls back to drift-event-only
      mode (still useful for demos without a cluster).
- [x] **Real rolling deploy**: when `services.deploy_target.k8s` is
      set (`{connector_id, deployment, container, image_repo}`), the
      strategy engine swaps its simulated phase machine for
      `kubectl set image` → `kubectl rollout status`. On failure, an
      automatic `kubectl rollout undo` keeps the cluster healthy.
      Rollback button uses the same primitive.
- [x] **Test suite (Vitest)**: 30 tests covering crypto round-trip,
      AES-GCM tamper detection, AES key validation, SQL safety
      analyzer (8 hazard rules + clean migration baseline), flag bucket
      stability + uniformity, condition operators, all-vs-any matching.
      `npm test` runs in ~300ms.
- [x] **Real canary + blue-green via Argo Rollouts** (`server/argo.js`):
      `kubectl patch rollout` to bump the image, `kubectl get rollout
      -o json` polled every 5s, status distilled to `{strategy, phase,
      currentStep, totalSteps, weight, activeSelector, pauseConditions}`
      and broadcast as `deployment:argo-status`. When the rollout
      pauses awaiting promotion, an approval gate is auto-opened
      (`subject_type='argo_rollout'`); on approval the gate listener
      annotates the rollout to promote. On Healthy → deployment passes;
      on Degraded → fails. Operator-facing `/api/deployments/:id/argo/
      promote` + `/abort` + `/status` endpoints for manual control.
- [x] **Trivy pipeline step type**: `stage.type='trivy'` runs
      `trivy fs --format json` in the pipeline workdir, parses
      Vulnerabilities by severity, ingests as a `security_scan` with
      `findings_critical/high/medium/low` populated and individual
      findings rows. Stage fails on critical findings unless
      `stage.allow_critical` is set — that's the deployment gate from
      pipelines.
- [x] **Real Chaos Mesh integration** (`server/chaos-mesh.js`): pure
      CRD generator maps each `fault_type` to a Chaos Mesh resource —
      PodChaos (pod-kill), NetworkChaos (latency, network-loss),
      StressChaos (cpu-stress), HTTPChaos (error-rate). Blast-radius
      maps to mode: 100→all, 1→one, mid→fixed-percent. `chaos.js`
      applies the CRD via `kubectl apply -f -` when the experiment has
      a `cluster_connector_id`, records the resource ref on the run,
      and `kubectl delete`s it on completion / abort / SLO-burn auto-
      abort. Falls back to simulation when no connector is set.
- [x] **DeploymentsView Argo UI** — canary deployments now show a live
      weight bar (polled every 5s from `/argo/status`), step counter,
      phase badge (Progressing/Healthy/Paused/Degraded), and Promote /
      Promote-full / Abort buttons. Strategy badge added to each row.
- [ ] **Follow-on**: Playwright e2e covering incident → agent → PR →
      merge → apply against a kind cluster.

## Cross-cutting work

- [ ] Replace ad-hoc `ALTER TABLE … ADD COLUMN` in `db.js` with a real
      migration tool (node-pg-migrate or drizzle)
- [ ] Retention sweeps: `health_checks`, `pipeline_runs.stage_results`,
      `audit_log`
- [ ] Test suite — currently zero. Add Vitest for unit, Playwright for e2e
- [ ] TypeScript or JSDoc types — 5k LOC of plain JS coordinating shell
      execution is a liability
- [ ] Extract `TopologyView` from `App.jsx` (currently 616 lines)
- [ ] Memoize `getConnections()` in `App.jsx`

## Anti-goals

- Do **not** chase Harness breadth-first. Ten shallow modules lose to two
  deep ones.
- Do **not** ship the agent without approval gates and audit logging.
- Do **not** keep cloud credentials in plaintext past Phase 0.

## Sequencing rationale

Phase 0 unblocks everything and removes the existing security cliff
(unauthenticated RCE via `executor.js:120`, plaintext tokens in DB).
Phase 1 reaches table-stakes CD parity so the platform is usable.
Phase 2 is the differentiator — what we lead with on the website.
Phase 3 catches up on surface area once the core loop is proven.

## Open questions

- LLM provider choice for the agent loop (Claude vs. self-hosted)?
- Multi-tenancy: single-instance per customer, or shared with org isolation?
- Self-hosted offering or SaaS only?
- Pricing model — match Harness per-service, or per-agent-action?
