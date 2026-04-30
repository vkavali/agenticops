// Chaos Mesh CRD generator.
//
// Maps our fault_type taxonomy to Chaos Mesh resources. Each generator returns
// a {apiVersion, kind, metadata, spec} object suitable for `kubectl apply -f`.
// Pure functions — exported separately so they can be unit-tested without a
// cluster.
//
// Reference: https://chaos-mesh.org/docs/define-chaos-experiment-scope/
//
// All generators take:
//   exp: { id, name, target_service, fault_config, blast_radius_pct, duration_ms }
//   namespace: K8s namespace where the chaos resource lands

function durationStr(ms) {
  if (!ms) return '60s';
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function selector(exp) {
  // We map target_service → labelSelectors[app=<service>] by convention.
  // Real deployments will want richer selectors; expose via fault_config.selector.
  const override = exp.fault_config?.selector;
  if (override) return override;
  return { labelSelectors: { app: exp.target_service } };
}

function modeFromBlast(pct) {
  // Chaos Mesh modes: one | all | fixed | fixed-percent | random-max-percent
  const n = Number(pct ?? 100);
  if (n >= 100) return { mode: 'all' };
  if (n <= 1) return { mode: 'one' };
  return { mode: 'fixed-percent', value: String(Math.round(n)) };
}

const META_BASE = (exp, namespace) => ({
  name: `aops-${exp.id}`.toLowerCase().slice(0, 63),
  namespace: namespace || exp.fault_config?.namespace || 'default',
  labels: {
    'app.kubernetes.io/managed-by': 'agenticops',
    'agenticops.io/experiment': exp.id,
  },
});

export function podKillCrd(exp, namespace) {
  return {
    apiVersion: 'chaos-mesh.org/v1alpha1',
    kind: 'PodChaos',
    metadata: META_BASE(exp, namespace),
    spec: {
      action: 'pod-kill',
      ...modeFromBlast(exp.blast_radius_pct),
      selector: selector(exp),
      duration: durationStr(exp.duration_ms),
    },
  };
}

export function latencyCrd(exp, namespace) {
  const ms = exp.fault_config?.latency_ms ?? 250;
  const jitter = exp.fault_config?.jitter_ms ?? 50;
  return {
    apiVersion: 'chaos-mesh.org/v1alpha1',
    kind: 'NetworkChaos',
    metadata: META_BASE(exp, namespace),
    spec: {
      action: 'delay',
      ...modeFromBlast(exp.blast_radius_pct),
      selector: selector(exp),
      delay: { latency: `${ms}ms`, jitter: `${jitter}ms`, correlation: '0' },
      duration: durationStr(exp.duration_ms),
    },
  };
}

export function networkLossCrd(exp, namespace) {
  const lossPct = exp.fault_config?.loss_pct ?? 25;
  return {
    apiVersion: 'chaos-mesh.org/v1alpha1',
    kind: 'NetworkChaos',
    metadata: META_BASE(exp, namespace),
    spec: {
      action: 'loss',
      ...modeFromBlast(exp.blast_radius_pct),
      selector: selector(exp),
      loss: { loss: String(lossPct), correlation: '0' },
      duration: durationStr(exp.duration_ms),
    },
  };
}

export function cpuStressCrd(exp, namespace) {
  const workers = exp.fault_config?.workers ?? 2;
  const load = exp.fault_config?.load_pct ?? 80;
  return {
    apiVersion: 'chaos-mesh.org/v1alpha1',
    kind: 'StressChaos',
    metadata: META_BASE(exp, namespace),
    spec: {
      ...modeFromBlast(exp.blast_radius_pct),
      selector: selector(exp),
      stressors: { cpu: { workers, load } },
      duration: durationStr(exp.duration_ms),
    },
  };
}

export function errorRateCrd(exp, namespace) {
  // No native "error rate" — closest fit is HTTPChaos returning a 5xx for
  // a fraction of the duration window. For real % fault injection use Istio.
  const port = exp.fault_config?.port ?? 80;
  const code = exp.fault_config?.status_code ?? 500;
  const pct = exp.blast_radius_pct ?? 25;
  return {
    apiVersion: 'chaos-mesh.org/v1alpha1',
    kind: 'HTTPChaos',
    metadata: META_BASE(exp, namespace),
    spec: {
      mode: 'all',
      selector: selector(exp),
      target: 'Request',
      port,
      method: 'GET',
      path: '/*',
      abort: false,
      replace: { code },
      duration: durationStr(Number(exp.duration_ms) * (pct / 100)),
    },
  };
}

const GENERATORS = {
  'pod-kill': podKillCrd,
  'latency': latencyCrd,
  'network-loss': networkLossCrd,
  'cpu-stress': cpuStressCrd,
  'error-rate': errorRateCrd,
};

export function generateCrd(exp, namespace = 'default') {
  const gen = GENERATORS[exp.fault_type];
  if (!gen) throw new Error(`Unsupported fault_type: ${exp.fault_type}`);
  return gen(exp, namespace);
}

export function crdResourceRef(crd) {
  return { kind: crd.kind, name: crd.metadata.name, namespace: crd.metadata.namespace };
}
