import { describe, it, expect } from 'vitest';
import { generateCrd, podKillCrd, latencyCrd, networkLossCrd, cpuStressCrd, errorRateCrd } from '../chaos-mesh.js';

const baseExp = (overrides = {}) => ({
  id: 'exp-test-001',
  name: 'test',
  target_service: 'api',
  fault_type: 'latency',
  fault_config: {},
  blast_radius_pct: 25,
  duration_ms: 60000,
  ...overrides,
});

describe('chaos-mesh CRD generator', () => {
  it('podKill maps to PodChaos with action=pod-kill', () => {
    const crd = podKillCrd(baseExp({ fault_type: 'pod-kill' }), 'staging');
    expect(crd.kind).toBe('PodChaos');
    expect(crd.spec.action).toBe('pod-kill');
    expect(crd.spec.duration).toBe('60s');
    expect(crd.metadata.namespace).toBe('staging');
  });

  it('latency builds NetworkChaos delay with config overrides', () => {
    const crd = latencyCrd(baseExp({
      fault_type: 'latency',
      fault_config: { latency_ms: 750, jitter_ms: 100 },
    }));
    expect(crd.kind).toBe('NetworkChaos');
    expect(crd.spec.action).toBe('delay');
    expect(crd.spec.delay).toEqual({ latency: '750ms', jitter: '100ms', correlation: '0' });
  });

  it('networkLoss uses default 25% loss', () => {
    const crd = networkLossCrd(baseExp({ fault_type: 'network-loss' }));
    expect(crd.kind).toBe('NetworkChaos');
    expect(crd.spec.action).toBe('loss');
    expect(crd.spec.loss).toEqual({ loss: '25', correlation: '0' });
  });

  it('cpuStress builds StressChaos with worker count', () => {
    const crd = cpuStressCrd(baseExp({
      fault_type: 'cpu-stress',
      fault_config: { workers: 4, load_pct: 90 },
    }));
    expect(crd.kind).toBe('StressChaos');
    expect(crd.spec.stressors.cpu).toEqual({ workers: 4, load: 90 });
  });

  it('errorRate builds HTTPChaos returning 5xx', () => {
    const crd = errorRateCrd(baseExp({
      fault_type: 'error-rate',
      fault_config: { port: 8080, status_code: 503 },
    }));
    expect(crd.kind).toBe('HTTPChaos');
    expect(crd.spec.port).toBe(8080);
    expect(crd.spec.replace.code).toBe(503);
  });

  it('blast radius maps to mode: 100→all, 1→one, mid→fixed-percent', () => {
    expect(podKillCrd(baseExp({ fault_type: 'pod-kill', blast_radius_pct: 100 })).spec.mode).toBe('all');
    expect(podKillCrd(baseExp({ fault_type: 'pod-kill', blast_radius_pct: 1 })).spec.mode).toBe('one');
    const mid = podKillCrd(baseExp({ fault_type: 'pod-kill', blast_radius_pct: 33 }));
    expect(mid.spec.mode).toBe('fixed-percent');
    expect(mid.spec.value).toBe('33');
  });

  it('selector defaults to labelSelectors[app=<service>]', () => {
    const crd = podKillCrd(baseExp({ fault_type: 'pod-kill', target_service: 'checkout' }));
    expect(crd.spec.selector).toEqual({ labelSelectors: { app: 'checkout' } });
  });

  it('selector override is honored', () => {
    const crd = podKillCrd(baseExp({
      fault_type: 'pod-kill',
      fault_config: { selector: { namespaces: ['prod'], labelSelectors: { tier: 'web' } } },
    }));
    expect(crd.spec.selector.namespaces).toEqual(['prod']);
    expect(crd.spec.selector.labelSelectors).toEqual({ tier: 'web' });
  });

  it('metadata includes managed-by + experiment label', () => {
    const crd = podKillCrd(baseExp({ fault_type: 'pod-kill' }));
    expect(crd.metadata.labels['app.kubernetes.io/managed-by']).toBe('agenticops');
    expect(crd.metadata.labels['agenticops.io/experiment']).toBe(baseExp().id);
  });

  it('generateCrd dispatches by fault_type', () => {
    expect(generateCrd(baseExp({ fault_type: 'pod-kill' })).kind).toBe('PodChaos');
    expect(generateCrd(baseExp({ fault_type: 'latency' })).kind).toBe('NetworkChaos');
    expect(generateCrd(baseExp({ fault_type: 'network-loss' })).kind).toBe('NetworkChaos');
    expect(generateCrd(baseExp({ fault_type: 'cpu-stress' })).kind).toBe('StressChaos');
    expect(generateCrd(baseExp({ fault_type: 'error-rate' })).kind).toBe('HTTPChaos');
  });

  it('generateCrd throws for unknown fault_type', () => {
    expect(() => generateCrd(baseExp({ fault_type: 'mystery' }))).toThrow(/Unsupported/);
  });
});
