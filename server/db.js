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
