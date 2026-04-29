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
