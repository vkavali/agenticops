import crypto from 'crypto';
import { query, queryOne, execute } from './db.js';
import { broadcast } from './sse.js';

// Security Testing Orchestration.
//
// We track scan runs (sast/dast/sca/secrets/iac) and individual findings.
// Real scanner integration belongs in pipeline step types — Trivy / Semgrep /
// Snyk wrappers run inside the pipeline executor and POST results here. For
// now we expose:
//   - scan creation + finding ingestion (generic — accepts findings from any scanner)
//   - severity rollup on the scan row
//   - blocker check: returns whether a target has open critical findings (used by
//     deployment gates as a pre-flight check)

export async function createScan({ scanType, target, pipelineRunId, findings = [] }) {
  const id = `scan-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (counts[f.severity] !== undefined) counts[f.severity]++;
  }
  const status = counts.critical > 0 ? 'failed' : (counts.high > 0 ? 'warning' : 'passed');

  await execute(
    `INSERT INTO security_scans (id, scan_type, target, pipeline_run_id, status,
       findings_critical, findings_high, findings_medium, findings_low, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [id, scanType, target, pipelineRunId || null, status,
     counts.critical, counts.high, counts.medium, counts.low, now]
  );

  for (const f of findings) {
    const fid = `find-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await execute(
      `INSERT INTO security_findings (id, scan_id, severity, rule_id, title, description, file_path, line, cve)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fid, id, f.severity, f.rule_id || null, f.title || 'unnamed finding',
       f.description || null, f.file_path || null, f.line || null, f.cve || null]
    );
  }

  broadcast('security:scan-completed', {
    id, scan_type: scanType, target, status, ...counts,
  });
  if (status === 'failed') {
    await execute('INSERT INTO activity (event,type,activity_timestamp) VALUES ($1,$2,$3)',
      [`Security scan ${id} (${scanType}) found ${counts.critical} critical issue(s) in ${target}`, 'security', now]);
  }
  return { id, status, counts };
}

// Used by deployment / IaC gates as a pre-flight: refuse if there are open
// critical findings against the target.
export async function hasOpenCriticalFindings(target) {
  const r = await queryOne(
    `SELECT COUNT(*)::INT AS n FROM security_findings f
     JOIN security_scans s ON f.scan_id=s.id
     WHERE s.target=$1 AND f.severity='critical' AND f.status='open'`,
    [target]
  );
  return Number(r.n) > 0;
}
