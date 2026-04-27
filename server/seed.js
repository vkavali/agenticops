import { query, execute, queryOne } from './db.js';

// Default data matching what was in store.jsx
const SERVICES = [
  { id: 'svc-1', name: 'api-service', status: 'healthy', version: 'v2.3.1', instances: '3/3', cpu: 42, memory: 67 },
  { id: 'svc-2', name: 'frontend', status: 'healthy', version: 'v3.1.0', instances: '2/2', cpu: 12, memory: 34 },
  { id: 'svc-3', name: 'worker-service', status: 'healthy', version: 'v1.8.2', instances: '4/4', cpu: 78, memory: 55 },
  { id: 'svc-4', name: 'auth-service', status: 'healthy', version: 'v2.1.0', instances: '2/2', cpu: 8, memory: 21 },
];

const NODES = [
  { id: 'users', type: 'users', name: 'Global Traffic', x: 50, y: 350, status: 'healthy' },
  { id: 'cloudfront', type: 'cdn', name: 'CloudFront Edge', x: 250, y: 350, status: 'healthy' },
  { id: 's3-static', type: 'storage', name: 'S3 Frontend', x: 450, y: 350, status: 'healthy' },
  { id: 'cognito', type: 'auth', name: 'Cognito Pool', x: 450, y: 550, status: 'healthy' },
  { id: 'api-gw', type: 'api', name: 'API Gateway', x: 250, y: 200, status: 'healthy' },
  { id: 'lambda-get', type: 'lambda', name: 'GET Handler', x: 450, y: 50, status: 'healthy' },
  { id: 'lambda-post', type: 'lambda', name: 'POST Handler', x: 450, y: 200, status: 'critical' },
  { id: 'lambda-auth', type: 'lambda', name: 'Authorizer', x: 450, y: 450, status: 'healthy' },
  { id: 'lambda-proc', type: 'lambda', name: 'Async Processor', x: 650, y: 200, status: 'healthy' },
  { id: 'dynamo', type: 'db', name: 'DynamoDB Core', x: 850, y: 50, status: 'healthy' },
  { id: 's3-assets', type: 'storage', name: 'S3 Assets', x: 850, y: 200, status: 'healthy' },
  { id: 'cloudwatch', type: 'monitor', name: 'CloudWatch', x: 850, y: 450, status: 'healthy' },
  { id: 'sns', type: 'notify', name: 'SNS Topics', x: 1050, y: 450, status: 'healthy' },
];

const LINKS = [
  { source: 'users', target: 'cloudfront', speed: '3s' },
  { source: 'users', target: 'cognito', speed: '4s', dashed: true },
  { source: 'cloudfront', target: 's3-static', speed: '3s' },
  { source: 'cloudfront', target: 'api-gw', speed: '2s' },
  { source: 'api-gw', target: 'lambda-get', speed: '2.5s' },
  { source: 'api-gw', target: 'lambda-post', speed: '1s', is_error: true },
  { source: 'api-gw', target: 'lambda-auth', speed: '2.5s' },
  { source: 'lambda-auth', target: 'cognito', speed: '2.5s' },
  { source: 'lambda-post', target: 'lambda-proc', speed: '0s', is_broken: true },
  { source: 'lambda-get', target: 'dynamo', speed: '2.5s' },
  { source: 'lambda-proc', target: 'dynamo', speed: '2.5s' },
  { source: 'lambda-proc', target: 's3-assets', speed: '3s' },
  { source: 'lambda-post', target: 'cloudwatch', speed: '1.2s', is_error: true, dashed: true },
  { source: 'cloudwatch', target: 'sns', speed: '2s', dashed: true },
];

const now = Date.now();

const PIPELINES = [
  {
    id: 'pipe-1', name: 'api-service / deploy', branch: 'main', last_run: 'passed', last_run_time: '8m ago',
    trigger_config: { type: 'push', branch: 'main' }, schedule: null,
    stages: [
      { id: 's1', type: 'build', name: 'Build', image: 'node:20-alpine', commands: ['npm ci', 'npm run build'], timeout: '10m' },
      { id: 's2', type: 'test', name: 'Unit Tests', image: 'node:20-alpine', commands: ['npm test -- --coverage'], timeout: '15m' },
      { id: 's3', type: 'security', name: 'Security Scan', image: 'aquasec/trivy:latest', commands: ['trivy fs --severity HIGH,CRITICAL .'], timeout: '5m' },
      { id: 's4', type: 'deploy', name: 'Deploy Staging', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'staging' },
      { id: 's5', type: 'approval', name: 'Manual Approval', approvers: ['ops-team'], timeout: '1h' },
      { id: 's6', type: 'deploy', name: 'Deploy Production', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'production' },
    ],
  },
  {
    id: 'pipe-2', name: 'frontend / build-test', branch: 'main', last_run: 'failed', last_run_time: '1h ago',
    trigger_config: { type: 'push', branch: 'main' }, schedule: '0 */6 * * *',
    stages: [
      { id: 's1', type: 'build', name: 'Build', image: 'node:20-alpine', commands: ['npm ci', 'npm run build:prod'], timeout: '10m' },
      { id: 's2', type: 'test', name: 'Unit Tests', image: 'node:20-alpine', commands: ['npm test -- --coverage'], timeout: '15m' },
      { id: 's3', type: 'deploy', name: 'Deploy CDN', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'staging' },
    ],
  },
  {
    id: 'pipe-3', name: 'worker-service / deploy', branch: 'main', last_run: 'passed', last_run_time: '3h ago',
    trigger_config: { type: 'tag', pattern: 'v*' }, schedule: null,
    stages: [
      { id: 's1', type: 'build', name: 'Build', image: 'golang:1.22', commands: ['npm ci', 'npm run build'], timeout: '10m' },
      { id: 's2', type: 'test', name: 'Unit Tests', image: 'golang:1.22', commands: ['go test ./...'], timeout: '15m' },
      { id: 's3', type: 'security', name: 'Security Scan', image: 'aquasec/trivy:latest', commands: ['trivy fs --severity HIGH,CRITICAL .'], timeout: '5m' },
      { id: 's4', type: 'deploy', name: 'Deploy', image: 'hashicorp/terraform:latest', commands: ['terraform init', 'terraform apply -auto-approve'], timeout: '20m', env: 'staging' },
    ],
  },
];

const RUNS = [
  { id: 'r-1', pipeline_id: 'pipe-1', number: '#47', commit_hash: 'a8f3c21', message: 'fix: POST handler memory', status: 'passed', duration: '4m 18s', time: '8m ago', run_timestamp: now - 480000, triggered_by: 'ARC-R', stage_results: [
    { name: 'Build', status: 'passed', duration: '34s', logs: ['> npm ci\n✓ 847 packages installed\n> npm run build\n✓ Build completed in 12.4s'] },
    { name: 'Unit Tests', status: 'passed', duration: '1m 12s', logs: ['142 passed, 142 total\nCoverage: 87.3%'] },
    { name: 'Security Scan', status: 'passed', duration: '22s', logs: ['0 vulnerabilities found'] },
    { name: 'Deploy Staging', status: 'passed', duration: '1m 45s', logs: ['Apply complete! Resources: 2 added'] },
    { name: 'Manual Approval', status: 'passed', duration: '15s', logs: ['Approved by: ARC-R Engine'] },
    { name: 'Deploy Production', status: 'passed', duration: '1m 50s', logs: ['Deployed to production\nHealth check: 200 OK'] },
  ]},
  { id: 'r-2', pipeline_id: 'pipe-1', number: '#46', commit_hash: 'f2b8d09', message: 'feat: user preferences endpoint', status: 'passed', duration: '4m 02s', time: '45m ago', run_timestamp: now - 2700000, triggered_by: 'v.kavali', stage_results: [] },
  { id: 'r-3', pipeline_id: 'pipe-1', number: '#45', commit_hash: 'b1c4e88', message: 'refactor: handler middleware', status: 'passed', duration: '3m 55s', time: '3h ago', run_timestamp: now - 10800000, triggered_by: 'ci-bot', stage_results: [] },
  { id: 'r-4', pipeline_id: 'pipe-2', number: '#31', commit_hash: 'c4e1a77', message: 'chore: bundle optimization', status: 'failed', duration: '2m 44s', time: '1h ago', run_timestamp: now - 3600000, triggered_by: 'v.kavali', stage_results: [
    { name: 'Build', status: 'passed', duration: '38s', logs: ['Build completed'] },
    { name: 'Unit Tests', status: 'failed', duration: '1m 06s', logs: ['FAIL: 3 failed, 139 passed'] },
    { name: 'Deploy CDN', status: 'skipped', duration: '—', logs: ['Skipped: previous stage failed'] },
  ]},
  { id: 'r-5', pipeline_id: 'pipe-2', number: '#30', commit_hash: 'e9a2f11', message: 'feat: dark mode support', status: 'passed', duration: '3m 10s', time: '6h ago', run_timestamp: now - 21600000, triggered_by: 'v.kavali', stage_results: [] },
  { id: 'r-6', pipeline_id: 'pipe-3', number: '#19', commit_hash: 'b9d2e44', message: 'perf: batch processing', status: 'passed', duration: '5m 02s', time: '3h ago', run_timestamp: now - 10800000, triggered_by: 'ci-bot', stage_results: [] },
];

const DEPLOYMENTS = [
  { id: 'd-001', service: 'api-service', version: 'v2.3.1', commit_hash: 'a8f3c21', message: 'fix: POST handler memory', deployed_by: 'ARC-R Engine', deploy_timestamp: now - 120000, environments: { development: { status: 'passed', time: '12m ago', timestamp: now - 720000 }, staging: { status: 'passed', time: '8m ago', timestamp: now - 480000 }, production: { status: 'running', time: '2m ago', timestamp: now - 120000 } } },
  { id: 'd-002', service: 'frontend', version: 'v3.1.0', commit_hash: 'f2b8d09', message: 'feat: user preferences UI', deployed_by: 'v.kavali', deploy_timestamp: now - 2700000, environments: { development: { status: 'passed', time: '2h ago', timestamp: now - 7200000 }, staging: { status: 'passed', time: '1h ago', timestamp: now - 3600000 }, production: { status: 'passed', time: '45m ago', timestamp: now - 2700000 } } },
  { id: 'd-003', service: 'frontend', version: 'v3.0.9', commit_hash: 'c4e1a77', message: 'chore: bundle optimization', deployed_by: 'v.kavali', deploy_timestamp: now - 3600000, environments: { development: { status: 'passed', time: '3h ago', timestamp: now - 10800000 }, staging: { status: 'failed', time: '1h ago', timestamp: now - 3600000 }, production: null } },
  { id: 'd-004', service: 'worker-service', version: 'v1.8.2', commit_hash: 'b9d2e44', message: 'perf: batch processing', deployed_by: 'ci-bot', deploy_timestamp: now - 10800000, environments: { development: { status: 'passed', time: '5h ago', timestamp: now - 18000000 }, staging: { status: 'passed', time: '4h ago', timestamp: now - 14400000 }, production: { status: 'passed', time: '3h ago', timestamp: now - 10800000 } } },
  { id: 'd-005', service: 'auth-service', version: 'v2.1.0', commit_hash: 'e7f1b33', message: 'sec: token rotation update', deployed_by: 'security-bot', deploy_timestamp: now - 21600000, environments: { development: { status: 'passed', time: '8h ago', timestamp: now - 28800000 }, staging: { status: 'passed', time: '7h ago', timestamp: now - 25200000 }, production: { status: 'passed', time: '6h ago', timestamp: now - 21600000 } } },
];

const INCIDENTS = [
  { id: 'INC-2847', title: 'Heap Memory Exhaustion — POST Handler', service: 'lambda-post', severity: 'critical', status: 'active', opened: '14m ago', incident_timestamp: now - 840000, assignee: 'ARC-R Engine', description: 'OutOfMemoryError on lambda-post.', timeline: [
    { time: '10:44:05', event: 'Alert triggered by CloudWatch alarm', type: 'alert' },
    { time: '10:44:08', event: 'ARC-R Engine auto-assigned', type: 'system' },
    { time: '10:44:12', event: 'Root cause identified: memory_size = 128MB', type: 'analysis' },
    { time: '10:44:15', event: 'IaC patch generated (memory_size → 256MB)', type: 'fix' },
    { time: '10:44:20', event: 'Awaiting operator approval', type: 'pending' },
  ]},
  { id: 'INC-2846', title: 'Elevated P99 Latency — API Gateway', service: 'api-gw', severity: 'warning', status: 'resolved', opened: '2h ago', incident_timestamp: now - 7200000, resolved: '1h 45m ago', assignee: 'ops-team', description: 'P99 latency exceeded 500ms threshold.', timeline: [
    { time: '08:15:00', event: 'Latency threshold breach detected', type: 'alert' },
    { time: '08:18:00', event: 'Provisioned concurrency auto-scaled', type: 'fix' },
    { time: '08:30:00', event: 'Incident resolved.', type: 'resolved' },
  ]},
  { id: 'INC-2845', title: 'DynamoDB Throttling — Read Capacity', service: 'dynamo', severity: 'warning', status: 'resolved', opened: '6h ago', incident_timestamp: now - 21600000, resolved: '5h ago', assignee: 'ARC-R Engine', description: 'ReadCapacityUnitsExceeded on DynamoDB.', timeline: [
    { time: '04:22:00', event: 'Throttling events detected (>50/min)', type: 'alert' },
    { time: '04:25:00', event: 'On-demand capacity mode enabled', type: 'fix' },
    { time: '05:00:00', event: 'Throttling resolved. Incident closed.', type: 'resolved' },
  ]},
];

const ACTIVITY = [
  { event: 'ARC-R started deploy of api-service v2.3.1 to production', type: 'deploy', activity_timestamp: now - 120000 },
  { event: 'api-service v2.3.1 deployed to staging successfully', type: 'deploy', activity_timestamp: now - 480000 },
  { event: 'INC-2847 opened: Heap Memory Exhaustion on POST Handler', type: 'incident', activity_timestamp: now - 840000 },
  { event: 'ARC-R detected anomaly: OutOfMemoryError on lambda-post', type: 'alert', activity_timestamp: now - 840000 },
  { event: 'frontend v3.1.0 deployed to production by v.kavali', type: 'deploy', activity_timestamp: now - 2700000 },
  { event: 'Pipeline frontend/build-test #31 failed (test stage)', type: 'pipeline', activity_timestamp: now - 3600000 },
  { event: 'worker-service v1.8.2 deployed to production by ci-bot', type: 'deploy', activity_timestamp: now - 10800000 },
  { event: 'INC-2845 resolved: DynamoDB throttling fixed', type: 'incident', activity_timestamp: now - 21600000 },
];

const SETTINGS = {
  envs: [
    { id: 'env-1', name: 'development', region: 'us-east-1', url: 'https://dev.agenticops.io', autoPromote: false, approvals: false, healthCheck: 'https://dev.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'development' }, { key: 'LOG_LEVEL', value: 'debug' }] },
    { id: 'env-2', name: 'staging', region: 'us-east-1', url: 'https://staging.agenticops.io', autoPromote: false, approvals: true, healthCheck: 'https://staging.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'staging' }, { key: 'LOG_LEVEL', value: 'info' }] },
    { id: 'env-3', name: 'production', region: 'us-east-1', url: 'https://app.agenticops.io', autoPromote: false, approvals: true, healthCheck: 'https://app.agenticops.io/health', vars: [{ key: 'NODE_ENV', value: 'production' }, { key: 'LOG_LEVEL', value: 'warn' }, { key: 'RATE_LIMIT', value: '1000' }] },
  ],
  integrations: [
    { id: 'int-1', name: 'GitHub', type: 'git', icon: '⌥', status: 'connected', account: 'agenticops-org', lastSync: '2m ago' },
    { id: 'int-2', name: 'AWS', type: 'cloud', icon: '☁', status: 'connected', account: '***4821', lastSync: '30s ago' },
    { id: 'int-3', name: 'Slack', type: 'notification', icon: '#', status: 'connected', account: '#deployments', lastSync: '1m ago' },
    { id: 'int-4', name: 'PagerDuty', type: 'notification', icon: '📟', status: 'disconnected', account: '—', lastSync: '—' },
    { id: 'int-5', name: 'GCP', type: 'cloud', icon: '◈', status: 'disconnected', account: '—', lastSync: '—' },
    { id: 'int-6', name: 'Azure', type: 'cloud', icon: '◆', status: 'disconnected', account: '—', lastSync: '—' },
    { id: 'int-7', name: 'GitLab', type: 'git', icon: '◉', status: 'disconnected', account: '—', lastSync: '—' },
    { id: 'int-8', name: 'Datadog', type: 'monitoring', icon: '🐕', status: 'disconnected', account: '—', lastSync: '—' },
  ],
  secrets: [
    { id: 's-1', key: 'DATABASE_URL', value: 'postgresql://***', created: '30d ago', rotated: '7d ago' },
    { id: 's-2', key: 'JWT_SECRET', value: 'sk_live_***', created: '90d ago', rotated: '30d ago' },
    { id: 's-3', key: 'AWS_ACCESS_KEY', value: 'AKIA***', created: '60d ago', rotated: '14d ago' },
    { id: 's-4', key: 'STRIPE_API_KEY', value: 'sk_live_***', created: '45d ago', rotated: '45d ago' },
    { id: 's-5', key: 'REDIS_URL', value: 'redis://***', created: '30d ago', rotated: '7d ago' },
  ],
  team: [
    { id: 'u-1', name: 'Vamsi Kavali', email: 'v.kavali@agenticops.io', role: 'owner', status: 'active', lastLogin: '2m ago' },
    { id: 'u-2', name: 'ARC-R Engine', email: 'arcr@system.internal', role: 'admin', status: 'active', lastLogin: 'Always on' },
    { id: 'u-3', name: 'CI Bot', email: 'ci-bot@agenticops.io', role: 'deployer', status: 'active', lastLogin: '8m ago' },
    { id: 'u-4', name: 'Security Bot', email: 'security@agenticops.io', role: 'auditor', status: 'active', lastLogin: '1h ago' },
  ],
  webhooks: [
    { id: 'wh-1', url: 'https://hooks.slack.com/services/T0X/B0X/xxx', events: ['deploy.success', 'deploy.failed'], active: true },
    { id: 'wh-2', url: 'https://api.pagerduty.com/webhooks/v3/xxx', events: ['incident.critical'], active: false },
  ],
  policies: { deployStrategy: 'rolling', autoRollback: true, rollbackThreshold: '5% error rate', approvalRequired: true, minApprovers: 1, deployWindow: '06:00 - 22:00 UTC', freezePeriod: false, maxConcurrent: 2, healthCheckTimeout: '60s', warmupPeriod: '30s' },
  security: { mfa: true, sso: true, ssoProvider: 'Okta', sessionTtl: '8h', ipWhitelist: '10.0.0.0/8, 172.16.0.0/12', auditLog: true, secretRotation: '90 days', rbac: true },
  alerts: [
    { id: 'a-1', name: 'Deploy Failed', channel: 'slack', target: '#deployments', severity: 'critical', enabled: true },
    { id: 'a-2', name: 'Error Rate > 5%', channel: 'pagerduty', target: 'ops-team', severity: 'critical', enabled: true },
    { id: 'a-3', name: 'Latency P99 > 500ms', channel: 'slack', target: '#monitoring', severity: 'warning', enabled: true },
    { id: 'a-4', name: 'Deploy Success', channel: 'slack', target: '#deployments', severity: 'info', enabled: false },
    { id: 'a-5', name: 'Secret Rotation Due', channel: 'email', target: 'v.kavali@agenticops.io', severity: 'warning', enabled: true },
  ],
  apiKeys: [
    { id: 'k-1', name: 'Production API Key', prefix: 'ak_prod_', key: 'ak_prod_sample123', created: '30d ago', lastUsed: '2m ago', scopes: ['read', 'deploy'] },
    { id: 'k-2', name: 'CI/CD Pipeline Key', prefix: 'ak_ci_', key: 'ak_ci_sample456', created: '60d ago', lastUsed: '8m ago', scopes: ['read', 'deploy', 'admin'] },
  ],
  general: { orgName: 'AgenticOps', timezone: 'UTC', syncInterval: '30s', dataRetention: '90 days' },
};

export async function seed() {
  // Check if already seeded
  const existing = await query('SELECT COUNT(*) as count FROM services');
  if (parseInt(existing[0].count) > 0) {
    console.log('✓ Database already seeded, skipping');
    return;
  }

  console.log('⏳ Seeding database...');

  // Services
  for (const s of SERVICES) {
    await execute('INSERT INTO services (id, name, status, version, instances, cpu, memory) VALUES ($1,$2,$3,$4,$5,$6,$7)', [s.id, s.name, s.status, s.version, s.instances, s.cpu, s.memory]);
  }

  // Nodes
  for (const n of NODES) {
    await execute('INSERT INTO nodes (id, type, name, x, y, status) VALUES ($1,$2,$3,$4,$5,$6)', [n.id, n.type, n.name, n.x, n.y, n.status]);
  }

  // Links
  for (const l of LINKS) {
    await execute('INSERT INTO links (source, target, speed, dashed, is_error, is_broken) VALUES ($1,$2,$3,$4,$5,$6)', [l.source, l.target, l.speed || null, l.dashed || false, l.is_error || false, l.is_broken || false]);
  }

  // Pipelines
  for (const p of PIPELINES) {
    await execute('INSERT INTO pipelines (id, name, branch, last_run, last_run_time, trigger_config, schedule, stages) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [p.id, p.name, p.branch, p.last_run, p.last_run_time, JSON.stringify(p.trigger_config), p.schedule, JSON.stringify(p.stages)]);
  }

  // Pipeline Runs
  for (const r of RUNS) {
    await execute('INSERT INTO pipeline_runs (id, pipeline_id, number, commit_hash, message, status, duration, time, run_timestamp, triggered_by, stage_results) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [r.id, r.pipeline_id, r.number, r.commit_hash, r.message, r.status, r.duration, r.time, r.run_timestamp, r.triggered_by, JSON.stringify(r.stage_results)]);
  }

  // Deployments
  for (const d of DEPLOYMENTS) {
    await execute('INSERT INTO deployments (id, service, version, commit_hash, message, deployed_by, deploy_timestamp, environments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [d.id, d.service, d.version, d.commit_hash, d.message, d.deployed_by, d.deploy_timestamp, JSON.stringify(d.environments)]);
  }

  // Incidents
  for (const i of INCIDENTS) {
    await execute('INSERT INTO incidents (id, title, service, severity, status, opened, incident_timestamp, resolved, assignee, description, timeline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [i.id, i.title, i.service, i.severity, i.status, i.opened, i.incident_timestamp, i.resolved || null, i.assignee, i.description, JSON.stringify(i.timeline)]);
  }

  // Activity
  for (const a of ACTIVITY) {
    await execute('INSERT INTO activity (event, type, activity_timestamp) VALUES ($1,$2,$3)', [a.event, a.type, a.activity_timestamp]);
  }

  // Settings
  for (const [key, value] of Object.entries(SETTINGS)) {
    await execute('INSERT INTO settings (key, value) VALUES ($1,$2)', [key, JSON.stringify(value)]);
  }

  // App state
  await execute('INSERT INTO app_state (key, value) VALUES ($1, $2)', ['remediated', JSON.stringify(false)]);

  console.log('✓ Database seeded successfully');
}
