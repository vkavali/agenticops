// Database DevOps — migration safety analyzer.
//
// Heuristic SQL analysis that flags migrations likely to lock big tables,
// drop data, or otherwise cause outages. Real production tooling does this
// against actual table sizes via INFORMATION_SCHEMA; this is a pure-text pass
// suitable for pre-merge review and policy gates.
//
// Returns { score, warnings: [{level, code, message}] }.
// Scores: 100 = safe; subtract per warning weight. Score < 50 = block.

const RULES = [
  {
    code: 'destructive-drop',
    level: 'critical',
    weight: 50,
    pattern: /\b(DROP\s+TABLE|TRUNCATE)\b/i,
    message: 'DROP TABLE / TRUNCATE — irreversible data loss',
  },
  {
    code: 'unrestricted-delete',
    level: 'critical',
    weight: 40,
    test: (sql) => /\bDELETE\s+FROM\b/i.test(sql) && !/\bWHERE\b/i.test(sql),
    message: 'DELETE without WHERE — will delete all rows',
  },
  {
    code: 'unrestricted-update',
    level: 'high',
    weight: 25,
    test: (sql) => /\bUPDATE\s+\w+\s+SET\b/i.test(sql) && !/\bWHERE\b/i.test(sql),
    message: 'UPDATE without WHERE — will rewrite all rows',
  },
  {
    code: 'add-column-not-null-no-default',
    level: 'high',
    weight: 20,
    test: (sql) => /ADD\s+COLUMN[^,;]*NOT\s+NULL/i.test(sql) && !/DEFAULT/i.test(sql),
    message: 'ADD COLUMN NOT NULL without DEFAULT — table rewrite + lock on large tables',
  },
  {
    code: 'alter-column-type',
    level: 'high',
    weight: 15,
    pattern: /\bALTER\s+COLUMN[^;]*TYPE\b/i,
    message: 'ALTER COLUMN TYPE — table rewrite, often blocking',
  },
  {
    code: 'drop-column',
    level: 'high',
    weight: 20,
    pattern: /\bDROP\s+COLUMN\b/i,
    message: 'DROP COLUMN — irreversible, also breaks rolling deploys mid-rollout',
  },
  {
    code: 'create-index-no-concurrent',
    level: 'medium',
    weight: 8,
    test: (sql) => /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i.test(sql) && !/\bCONCURRENTLY\b/i.test(sql),
    message: 'CREATE INDEX without CONCURRENTLY — locks writes during build (Postgres)',
  },
  {
    code: 'no-transaction',
    level: 'low',
    weight: 3,
    test: (sql) => !/BEGIN\b|START\s+TRANSACTION/i.test(sql) &&
                   /\b(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT)\b/i.test(sql),
    message: 'Migration not wrapped in a transaction — partial application risk',
  },
  {
    code: 'rename-column',
    level: 'medium',
    weight: 10,
    pattern: /\bRENAME\s+(COLUMN|TO)\b/i,
    message: 'RENAME — breaks any clients still on the old schema. Coordinate with deploys.',
  },
];

export function analyzeSql(sqlText) {
  if (!sqlText) return { score: 100, warnings: [] };
  const warnings = [];
  let penalty = 0;
  for (const r of RULES) {
    const hit = r.pattern ? r.pattern.test(sqlText) : (r.test ? r.test(sqlText) : false);
    if (hit) {
      warnings.push({ code: r.code, level: r.level, message: r.message });
      penalty += r.weight;
    }
  }
  const score = Math.max(0, 100 - penalty);
  return { score, warnings };
}
