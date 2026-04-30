// Shared API mock fixture for Playwright. Stubs the auth + hydration calls
// the frontend issues at boot so each test can layer on its own scenario.
//
// Usage:
//   import { installApiMocks } from './fixtures.js';
//   await installApiMocks(page);

export async function installApiMocks(page, overrides = {}) {
  const json = (data, status = 200) => ({
    status, contentType: 'application/json', body: JSON.stringify(data),
  });

  // Auth — the TokenGate checks /api/auth/me.
  await page.route('**/api/auth/me', route => route.fulfill(json({
    role: 'admin', label: 'e2e-admin', tokenId: 1,
  })));

  // Hydration calls — return empty arrays so the UI renders without crashing.
  const empty = { ...overrides };
  const stubs = {
    '/api/services':                       empty.services ?? [],
    '/api/pipelines':                      empty.pipelines ?? [],
    '/api/deployments':                    empty.deployments ?? [],
    '/api/incidents':                      empty.incidents ?? [],
    '/api/activity':                       empty.activity ?? [],
    '/api/infrastructure/nodes':           empty.nodes ?? [],
    '/api/infrastructure/links':           empty.links ?? [],
    '/api/infrastructure/state':           { remediated: false, ...(empty.infState || {}) },
    '/api/settings/envs':                  empty.envs ?? [],
    '/api/settings/integrations':          empty.integrations ?? [],
    '/api/settings/secrets':               empty.secrets ?? [],
    '/api/settings/team':                  empty.team ?? [],
    '/api/settings/webhooks':              empty.webhooks ?? [],
    '/api/settings/policies':              empty.policies ?? {},
    '/api/settings/security':              empty.security ?? {},
    '/api/settings/alerts':                empty.alerts ?? [],
    '/api/settings/apiKeys':               empty.apiKeys ?? [],
    '/api/settings/general':               empty.general ?? {},
    '/api/gates':                          empty.gates ?? [],
    '/api/templates':                      empty.templates ?? [],
    '/api/artifacts':                      empty.artifacts ?? [],
    '/api/slos':                           empty.slos ?? [],
    '/api/flags':                          empty.flags ?? [],
    '/api/cost/anomalies':                 empty.costAnomalies ?? [],
    '/api/cost/recommendations':           empty.costRecommendations ?? [],
    '/api/chaos/experiments':              empty.chaosExperiments ?? [],
    '/api/idp/services':                   empty.catalogServices ?? [],
    '/api/security/scans':                 empty.securityScans ?? [],
    '/api/gitops/apps':                    empty.gitopsApps ?? [],
    '/api/dbops/migrations':               empty.dbMigrations ?? [],
    '/api/cloud':                          empty.cloudConnectors ?? [],
  };

  for (const [path, payload] of Object.entries(stubs)) {
    await page.route(`**${path}*`, route => route.fulfill(json(payload)));
  }

  // SSE — return an empty stream so the EventSource opens without erroring.
  await page.route('**/api/events*', route => route.fulfill({
    status: 200, contentType: 'text/event-stream',
    body: 'data: {"type":"connected"}\n\n',
  }));
}

export const ADMIN_TOKEN = 'aops_e2e_admin_token_xxxxxxxxxxxxxxxx';
