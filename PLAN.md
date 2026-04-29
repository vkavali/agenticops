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

- [x] **SRM**: `slos` + `slo_evals` tables — `server/slo.js` evaluator
      runs every 60s, computes availability or latency SLI from
      `health_checks` over the SLO window, derives error-budget remaining
      and burn rate. Burn rate ≥ alert threshold (default 2.0×) opens a
      critical incident, deduped against existing actives. CRUD at
      `/api/slos`, eval history at `/api/slos/:id/evals`.
- [x] **Feature Flags**: `flags` + `flag_rules` + `flag_rollouts` schema.
      `server/flags.js` evaluator: enabled-check → priority-ordered rules
      with conditions (equals/in/contains/gt/etc.) → stable sha1
      bucketing for percentage rollout → default. Gradual-rollout
      controller bumps `current_pct` every `increment_interval_ms`,
      auto-pauses at 1.5× SLO burn and auto-rolls-back at 2× — the
      agentic angle Harness can't tell as cleanly. `/api/flags`: CRUD,
      rules, `POST /:key/evaluate`, rollout start/pause/resume/rollback.
- [ ] **CCM**: AWS Cost Explorer / GCP Billing connectors, anomaly detection,
      idle-resource recommendations
- [ ] **STO**: SAST/DAST/SCA orchestration as pipeline step types
      (Semgrep, Trivy, Snyk integrations)
- [ ] **Chaos**: fault-injection actions (latency, error rate, pod kill),
      blast radius controls, hypothesis-driven runs
- [ ] **IDP**: service catalog, scorecards (test coverage, SLO compliance,
      security posture), software templates
- [ ] **GitOps**: Argo-style sync loop, app-of-apps, drift auto-correct
- [ ] **DB DevOps**: schema migration tracking, online-DDL safety checks

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
