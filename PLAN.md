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

### Phase 1 — Close obvious CI/CD gaps

- [ ] CD: env promotion (dev → staging → prod) with approval gates
- [ ] Deployment strategies: canary, blue-green, rolling
- [ ] One-click rollback per deployment
- [ ] Pipeline templates + reusable step library
- [ ] Artifact registry metadata (Docker Hub, ECR, GHCR)
- [ ] Parallel stage execution in `executor.js`
- [ ] Pipeline-level timeout, not just per-command

### Phase 2 — Lead wedge: agentic IaC remediation

The headline demo. Replaces the hardcoded Lambda diff in `App.jsx:184-227`
with a real loop.

- [ ] Real Terraform runner: `terraform init/plan/apply` from cloned repo
- [ ] TF state visualization in topology view (drives `nodes`/`links`)
- [ ] Drift detection: scheduled `plan` → diff vs. last-applied
- [ ] Agent diagnosis: feed incident + recent logs/metrics to LLM, get patch proposal
- [ ] Auto-PR flow: agent commits patch to branch, opens PR, waits for CI
- [ ] Apply gate: approval required before `terraform apply`
- [ ] Rollback path: revert PR + re-apply previous state

### Phase 3 — Fill out remaining surface

Schema + skeleton routes + minimal UI per module. Polish opportunistically.

- [ ] **SRM**: `slos` table, error-budget calc, burn-rate alerts → `incidents`
- [ ] **Feature Flags**: `flags`, `flag_rules`, evaluation API, agent-driven
      gradual rollout (auto-pause on metric regression)
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
