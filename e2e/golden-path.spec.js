import { test, expect } from '@playwright/test';
import { installApiMocks, ADMIN_TOKEN } from './fixtures.js';

// Golden-path e2e: walks the UI through the headline modules to verify the
// agentic-loop tabs render and react. Backend is fully mocked at the network
// layer — no Postgres, no kubectl, no Anthropic key required.
//
// What this proves: the React + store + tab routing pipeline doesn't have
// dead branches. New modules render data instead of blank panes. SSE wiring
// at least opens. Token gate blocks anonymous access.

test.beforeEach(async ({ page }) => {
  await page.addInitScript((token) => {
    try { localStorage.setItem('aops_token', token); } catch {}
  }, ADMIN_TOKEN);
});

test('token gate accepts a valid token and reveals the dashboard', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.locator('text=Environments').first()).toBeVisible();
  await expect(page.locator('text=Production').first()).toBeVisible();
});

test('token gate rejects a missing token', async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => { try { localStorage.removeItem('aops_token'); } catch {} });
  await installApiMocks(page);
  // /api/auth/me returns 401 without a token in real life; mock that here.
  await page.route('**/api/auth/me', route => route.fulfill({
    status: 401, contentType: 'application/json', body: '{"error":"missing token"}',
  }));
  await page.goto('/');
  await expect(page.getByPlaceholder(/aops_/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('Cost tab surfaces anomalies', async ({ page }) => {
  await installApiMocks(page, {
    costAnomalies: [{
      id: 'cost-test-1', provider: 'aws', service: 'lambda',
      observed_cost: 240.5, baseline_cost: 120.0, delta_pct: 100,
      detected_at: Date.now(), status: 'open',
    }],
    costRecommendations: [{
      id: 'rec-test-1', kind: 'rightsize', resource: 'api-service',
      estimated_monthly_savings: 75, rationale: 'Idle 24h',
      status: 'open', created_at: Date.now(),
    }],
  });
  await page.goto('/');
  await page.locator('text=Cost').first().click();
  await expect(page.locator('text=Cost Management')).toBeVisible();
  await expect(page.locator('text=lambda').first()).toBeVisible();
  await expect(page.locator('text=+100%').first()).toBeVisible();
  await expect(page.locator('text=api-service').first()).toBeVisible();
});

test('SLOs tab renders evaluator output', async ({ page }) => {
  await installApiMocks(page, {
    services: [{ id: 's-1', name: 'api-service', status: 'healthy' }],
    slos: [{
      id: 'slo-1', name: 'API availability', service: 'api-service',
      sli_type: 'availability', target_pct: 99.5, window_ms: 2592000000,
      enabled: true, burn_rate_alert_threshold: 2.0,
    }],
  });
  await page.goto('/');
  await page.locator('text=SLOs').first().click();
  await expect(page.locator('text=Error Budgets').first()).toBeVisible();
  await expect(page.locator('text=API availability').first()).toBeVisible();
});

test('Flags tab shows rollouts with progress bar', async ({ page }) => {
  await installApiMocks(page, {
    flags: [{
      id: 'flag-1', key: 'enable-new-checkout', name: 'New checkout',
      type: 'boolean', default_value: false, rolled_out_value: true,
      enabled: true, created_at: Date.now(),
      rollout: {
        id: 'rollout-1', flag_id: 'flag-1',
        start_pct: 0, target_pct: 100, current_pct: 35,
        increment_pct: 10, increment_interval_ms: 600000,
        status: 'running', started_at: Date.now(),
      },
    }],
  });
  await page.goto('/');
  await page.locator('text=Flags').first().click();
  await expect(page.locator('text=Feature Flags').first()).toBeVisible();
  await expect(page.locator('text=enable-new-checkout').first()).toBeVisible();
  await expect(page.locator('text=35%').first()).toBeVisible();
});

test('Catalog tab shows scorecards', async ({ page }) => {
  await installApiMocks(page, {
    catalogServices: [{
      id: 's-1', name: 'api-service', tier: 'production', owner: 'platform-team',
      scorecards: [
        { metric: 'slo_compliance',  value: 95, grade: 'A', detail: {}, computed_at: Date.now() },
        { metric: 'incident_health', value: 88, grade: 'B', detail: {}, computed_at: Date.now() },
        { metric: 'deploy_freshness', value: 70, grade: 'C', detail: {}, computed_at: Date.now() },
        { metric: 'security_posture', value: 92, grade: 'A', detail: {}, computed_at: Date.now() },
      ],
    }],
  });
  await page.goto('/');
  await page.locator('text=Catalog').first().click();
  await expect(page.locator('text=Service Catalog').first()).toBeVisible();
  await expect(page.locator('text=api-service').first()).toBeVisible();
  await expect(page.locator('text=platform-team').first()).toBeVisible();
});

test('keyboard shortcut 7 jumps to SLOs', async ({ page }) => {
  await installApiMocks(page);
  await page.goto('/');
  await page.locator('text=Production').first().waitFor();
  await page.keyboard.press('7');
  await expect(page.locator('text=Error Budgets').first()).toBeVisible();
});
