import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'healthy',
  version TEXT, instances TEXT, cpu INTEGER DEFAULT 0, memory INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
  x REAL DEFAULT 0, y REAL DEFAULT 0, status TEXT DEFAULT 'healthy'
);
CREATE TABLE IF NOT EXISTS links (
  id SERIAL PRIMARY KEY, source TEXT NOT NULL, target TEXT NOT NULL,
  speed TEXT, dashed BOOLEAN DEFAULT false, is_error BOOLEAN DEFAULT false, is_broken BOOLEAN DEFAULT false
);
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, branch TEXT DEFAULT 'main',
  last_run TEXT DEFAULT 'passed', last_run_time TEXT,
  trigger_config JSONB, schedule TEXT, stages JSONB DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  number TEXT, commit_hash TEXT, message TEXT, status TEXT DEFAULT 'pending',
  duration TEXT, time TEXT, run_timestamp BIGINT, triggered_by TEXT,
  stage_results JSONB DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, service TEXT NOT NULL, version TEXT, commit_hash TEXT,
  message TEXT, deployed_by TEXT, deploy_timestamp BIGINT, environments JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, service TEXT, severity TEXT DEFAULT 'warning',
  status TEXT DEFAULT 'active', opened TEXT, incident_timestamp BIGINT, resolved TEXT,
  assignee TEXT, description TEXT, timeline JSONB DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY, event TEXT NOT NULL, type TEXT DEFAULT 'system', activity_timestamp BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS github_connections (
  id SERIAL PRIMARY KEY, access_token TEXT NOT NULL, github_user TEXT,
  github_avatar TEXT, scopes TEXT, created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);
CREATE TABLE IF NOT EXISTS connected_repos (
  id SERIAL PRIMARY KEY, github_connection_id INTEGER REFERENCES github_connections(id),
  repo_full_name TEXT NOT NULL UNIQUE, repo_url TEXT, default_branch TEXT DEFAULT 'main',
  webhook_id BIGINT, webhook_secret TEXT, connected_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT * 1000
);
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS repo_full_name TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS health_url TEXT;
CREATE TABLE IF NOT EXISTS health_checks (
  id SERIAL PRIMARY KEY, service_id TEXT NOT NULL,
  status TEXT, response_time INTEGER, status_code INTEGER,
  checked_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_checks_service ON health_checks(service_id, checked_at DESC);
CREATE TABLE IF NOT EXISTS cloud_connectors (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL,
  name TEXT NOT NULL, region TEXT, credentials JSONB,
  status TEXT DEFAULT 'connected', created_at BIGINT
);
CREATE TABLE IF NOT EXISTS api_tokens (
  id SERIAL PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('viewer','operator','admin')),
  label TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail JSONB,
  audit_timestamp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(audit_timestamp DESC);
CREATE TABLE IF NOT EXISTS approval_gates (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  required_role TEXT NOT NULL DEFAULT 'operator',
  requested_by TEXT,
  decided_by TEXT,
  decided_at BIGINT,
  payload JSONB,
  created_at BIGINT NOT NULL,
  expires_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_approval_gates_status ON approval_gates(status, created_at DESC);

-- Phase 1: deployment strategies, templates, artifacts
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'rolling'
  CHECK (strategy IN ('rolling','canary','blue-green'));
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS gate_id TEXT;

CREATE TABLE IF NOT EXISTS pipeline_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables JSONB DEFAULT '{}'::jsonb,
  created_at BIGINT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  registry TEXT NOT NULL,
  repository TEXT NOT NULL,
  tag TEXT NOT NULL,
  digest TEXT,
  size_bytes BIGINT,
  pushed_at BIGINT NOT NULL,
  pushed_by TEXT,
  pipeline_run_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_artifacts_repo ON artifacts(registry, repository, pushed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_unique ON artifacts(registry, repository, tag);

-- Phase 2: IaC management
CREATE TABLE IF NOT EXISTS iac_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_full_name TEXT,
  branch TEXT DEFAULT 'main',
  tf_dir TEXT DEFAULT '.',
  cloud_connector_id TEXT,
  drift_check_interval_ms BIGINT DEFAULT 3600000,
  last_drift_check_at BIGINT,
  last_known_state_hash TEXT,
  created_at BIGINT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS iac_runs (
  id TEXT PRIMARY KEY,
  iac_config_id TEXT NOT NULL REFERENCES iac_configs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('plan','apply','drift-check','destroy')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','failed','drift-detected','no-changes','cancelled')),
  triggered_by TEXT,
  incident_id TEXT,
  gate_id TEXT,
  plan_summary JSONB,
  proposed_patch TEXT,
  agent_diagnosis TEXT,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_iac_runs_config ON iac_runs(iac_config_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_iac_runs_kind ON iac_runs(kind, status, started_at DESC);

ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS pr_number INTEGER;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS pr_url TEXT;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS pr_branch TEXT;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS pr_status TEXT;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS applied_sha TEXT;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS previous_sha TEXT;
ALTER TABLE iac_runs ADD COLUMN IF NOT EXISTS rolled_back_from TEXT;
CREATE INDEX IF NOT EXISTS idx_iac_runs_pr ON iac_runs(pr_number) WHERE pr_number IS NOT NULL;

-- Phase 3: SLOs / error budgets
CREATE TABLE IF NOT EXISTS slos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  sli_type TEXT NOT NULL CHECK (sli_type IN ('availability','latency')),
  target_pct NUMERIC(6,3) NOT NULL,
  window_ms BIGINT NOT NULL DEFAULT 2592000000,
  latency_threshold_ms INTEGER,
  burn_rate_alert_threshold NUMERIC(5,2) NOT NULL DEFAULT 2.0,
  enabled BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS slo_evals (
  id BIGSERIAL PRIMARY KEY,
  slo_id TEXT NOT NULL REFERENCES slos(id) ON DELETE CASCADE,
  evaluated_at BIGINT NOT NULL,
  sli_value NUMERIC(6,3) NOT NULL,
  error_budget_remaining_pct NUMERIC(7,3) NOT NULL,
  burn_rate NUMERIC(8,3) NOT NULL,
  sample_count INTEGER NOT NULL,
  alerting BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_slo_evals_slo ON slo_evals(slo_id, evaluated_at DESC);

-- Phase 3: feature flags with agent-driven gradual rollout
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('boolean','string','number','json')),
  default_value JSONB NOT NULL,
  rolled_out_value JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS flag_rules (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  value JSONB NOT NULL,
  description TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flag_rules_flag ON flag_rules(flag_id, priority);
CREATE TABLE IF NOT EXISTS flag_rollouts (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  start_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  target_pct NUMERIC(5,2) NOT NULL DEFAULT 100,
  current_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  increment_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  increment_interval_ms BIGINT NOT NULL DEFAULT 600000,
  slo_id TEXT REFERENCES slos(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','paused','complete','rolled-back')),
  pause_reason TEXT,
  started_at BIGINT NOT NULL,
  last_increment_at BIGINT,
  finished_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flag_rollouts_active
  ON flag_rollouts(flag_id) WHERE status IN ('running','paused');

-- Phase 3: Cloud Cost Management
CREATE TABLE IF NOT EXISTS cost_data (
  id BIGSERIAL PRIMARY KEY,
  cloud_connector_id TEXT,
  provider TEXT NOT NULL,
  account TEXT,
  service TEXT,
  resource TEXT,
  daily_cost NUMERIC(12,4) NOT NULL,
  currency TEXT DEFAULT 'USD',
  captured_at BIGINT NOT NULL,
  date_key DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_data_date ON cost_data(date_key DESC);
CREATE INDEX IF NOT EXISTS idx_cost_data_service ON cost_data(provider, service, date_key DESC);
CREATE TABLE IF NOT EXISTS cost_anomalies (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  resource TEXT,
  observed_cost NUMERIC(12,4) NOT NULL,
  baseline_cost NUMERIC(12,4) NOT NULL,
  delta_pct NUMERIC(7,2) NOT NULL,
  detected_at BIGINT NOT NULL,
  status TEXT DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS cost_recommendations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource TEXT NOT NULL,
  estimated_monthly_savings NUMERIC(12,2) NOT NULL,
  rationale TEXT,
  status TEXT DEFAULT 'open',
  created_at BIGINT NOT NULL
);

-- Phase 3: Chaos Engineering
CREATE TABLE IF NOT EXISTS chaos_experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_service TEXT NOT NULL,
  fault_type TEXT NOT NULL CHECK (fault_type IN ('latency','error-rate','pod-kill','cpu-stress','network-loss')),
  fault_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  blast_radius_pct NUMERIC(5,2) NOT NULL DEFAULT 10,
  duration_ms BIGINT NOT NULL DEFAULT 60000,
  hypothesis TEXT,
  abort_on_slo_id TEXT REFERENCES slos(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  created_by TEXT
);
CREATE TABLE IF NOT EXISTS chaos_runs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES chaos_experiments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','aborted','completed','failed')),
  gate_id TEXT,
  triggered_by TEXT,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  abort_reason TEXT,
  observations JSONB DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_chaos_runs_exp ON chaos_runs(experiment_id, started_at DESC);

-- Phase 3: IDP / Service Catalog scorecards
ALTER TABLE services ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS repo_full_name TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS scorecards (
  id BIGSERIAL PRIMARY KEY,
  service_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(7,3),
  grade TEXT,
  detail JSONB,
  computed_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scorecards_service ON scorecards(service_id, computed_at DESC);

-- Phase 3: Security Testing (STO)
CREATE TABLE IF NOT EXISTS security_scans (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL CHECK (scan_type IN ('sast','dast','sca','secrets','iac')),
  target TEXT NOT NULL,
  pipeline_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','passed','failed','warning')),
  findings_critical INTEGER DEFAULT 0,
  findings_high INTEGER DEFAULT 0,
  findings_medium INTEGER DEFAULT 0,
  findings_low INTEGER DEFAULT 0,
  started_at BIGINT NOT NULL,
  finished_at BIGINT
);
CREATE TABLE IF NOT EXISTS security_findings (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES security_scans(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  rule_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT,
  line INTEGER,
  cve TEXT,
  status TEXT DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS idx_findings_scan ON security_findings(scan_id, severity);

-- Phase 3: GitOps app sync
CREATE TABLE IF NOT EXISTS gitops_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  manifest_path TEXT NOT NULL DEFAULT '.',
  target_cluster TEXT,
  sync_interval_ms BIGINT DEFAULT 300000,
  last_sync_at BIGINT,
  last_sync_status TEXT,
  last_sync_revision TEXT,
  auto_sync BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS gitops_syncs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES gitops_apps(id) ON DELETE CASCADE,
  revision TEXT,
  status TEXT NOT NULL,
  drift_detected BOOLEAN DEFAULT false,
  changes JSONB DEFAULT '[]'::jsonb,
  started_at BIGINT NOT NULL,
  finished_at BIGINT
);

-- Phase 3: Database DevOps
CREATE TABLE IF NOT EXISTS db_migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  database_name TEXT,
  sql_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','failed','rolled-back')),
  safety_score INTEGER,
  safety_warnings JSONB DEFAULT '[]'::jsonb,
  gate_id TEXT,
  pipeline_run_id TEXT,
  created_at BIGINT NOT NULL,
  applied_at BIGINT,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_db_migrations_status ON db_migrations(status, created_at DESC);

-- Phase 4: real K8s integration
ALTER TABLE gitops_apps ADD COLUMN IF NOT EXISTS cluster_connector_id TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deploy_target JSONB;
ALTER TABLE chaos_experiments ADD COLUMN IF NOT EXISTS cluster_connector_id TEXT;
ALTER TABLE chaos_runs ADD COLUMN IF NOT EXISTS injected_resource TEXT;

-- Phase 7: enterprise readiness — multi-tenancy, OIDC, integrations, canary analysis
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at BIGINT NOT NULL
);
INSERT INTO orgs (id, name, slug, created_at)
  VALUES ('org-default', 'Default', 'default', EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE services ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE slos ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE flags ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE iac_configs ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE gitops_apps ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE db_migrations ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE chaos_experiments ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';
ALTER TABLE cloud_connectors ADD COLUMN IF NOT EXISTS org_id TEXT REFERENCES orgs(id) DEFAULT 'org-default';

CREATE TABLE IF NOT EXISTS oidc_configs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  audience TEXT,
  role_claim TEXT DEFAULT 'role',
  groups_claim TEXT DEFAULT 'groups',
  group_role_map JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS scim_users (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  user_name TEXT NOT NULL,
  display_name TEXT,
  emails JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT true,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  role TEXT DEFAULT 'viewer',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scim_users_org ON scim_users(org_id, user_name);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL CHECK (kind IN ('slack','pagerduty','datadog','webhook')),
  config JSONB NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integrations_org_kind ON integrations(org_id, kind);

CREATE TABLE IF NOT EXISTS canary_analyses (
  id TEXT PRIMARY KEY,
  deployment_id TEXT,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  baseline_mean NUMERIC(10,3),
  canary_mean NUMERIC(10,3),
  baseline_n INTEGER,
  canary_n INTEGER,
  z_score NUMERIC(8,3),
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','fail','inconclusive')),
  evaluated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canary_analyses_deploy ON canary_analyses(deployment_id, evaluated_at DESC);
`;

export async function initDb() {
  const client = await pool.connect();
  try { await client.query(SCHEMA); console.log('✓ Database schema initialized'); }
  finally { client.release(); }
}

export async function query(text, params) { return (await pool.query(text, params)).rows; }
export async function queryOne(text, params) { return (await pool.query(text, params)).rows[0] || null; }
export async function execute(text, params) { return pool.query(text, params); }
export { pool };
export default pool;
