import { describe, it, expect } from 'vitest';
import { parseRolloutStatus } from '../argo.js';

describe('parseRolloutStatus', () => {
  it('returns null for null/undefined input', () => {
    expect(parseRolloutStatus(null)).toBe(null);
    expect(parseRolloutStatus(undefined)).toBe(null);
  });

  it('detects canary strategy + weight + step progress', () => {
    const payload = {
      spec: {
        strategy: { canary: { steps: [{ setWeight: 25 }, { pause: {} }, { setWeight: 75 }, { pause: {} }] } },
      },
      status: {
        phase: 'Progressing',
        currentStepIndex: 1,
        canary: { weights: { canary: { weight: 25 } } },
      },
    };
    const r = parseRolloutStatus(payload);
    expect(r.strategy).toBe('canary');
    expect(r.phase).toBe('Progressing');
    expect(r.currentStep).toBe(1);
    expect(r.totalSteps).toBe(4);
    expect(r.weight).toBe(25);
    expect(r.activeSelector).toBe(null);
  });

  it('detects blue-green strategy + active selector', () => {
    const payload = {
      spec: { strategy: { blueGreen: { activeService: 'svc-active', previewService: 'svc-preview' } } },
      status: { phase: 'Healthy', blueGreen: { activeSelector: 'rev-7d8a4c' } },
    };
    const r = parseRolloutStatus(payload);
    expect(r.strategy).toBe('blue-green');
    expect(r.activeSelector).toBe('rev-7d8a4c');
    expect(r.weight).toBe(null);
  });

  it('exposes pause conditions when paused awaiting promote', () => {
    const payload = {
      spec: { strategy: { canary: { steps: [{ setWeight: 50 }, { pause: {} }] } } },
      status: {
        phase: 'Paused',
        currentStepIndex: 1,
        pauseConditions: [{ reason: 'CanaryPauseStep', startTime: '2026-04-29T12:00:00Z' }],
        canary: { weights: { canary: { weight: 50 } } },
      },
    };
    const r = parseRolloutStatus(payload);
    expect(r.phase).toBe('Paused');
    expect(r.pauseConditions).toHaveLength(1);
    expect(r.weight).toBe(50);
  });

  it('handles minimal degraded payload', () => {
    const payload = {
      spec: { strategy: { canary: { steps: [] } } },
      status: { phase: 'Degraded', message: 'progress deadline exceeded' },
    };
    const r = parseRolloutStatus(payload);
    expect(r.phase).toBe('Degraded');
    expect(r.message).toBe('progress deadline exceeded');
  });

  it('marks unknown strategy when neither canary nor blueGreen', () => {
    const r = parseRolloutStatus({ spec: { strategy: {} }, status: { phase: 'Progressing' } });
    expect(r.strategy).toBe('unknown');
  });
});
