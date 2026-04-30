import { describe, it, expect } from 'vitest';
import { parseCatalogInfo } from '../catalog-import.js';

describe('parseCatalogInfo', () => {
  it('rejects non-Component kinds', () => {
    expect(parseCatalogInfo({ kind: 'API', metadata: { name: 'x' } })).toBe(null);
    expect(parseCatalogInfo({ kind: 'System', metadata: { name: 'x' } })).toBe(null);
    expect(parseCatalogInfo(null)).toBe(null);
  });

  it('rejects missing metadata.name', () => {
    expect(parseCatalogInfo({ kind: 'Component', spec: { owner: 'x' } })).toBe(null);
  });

  it('extracts standard Backstage fields', () => {
    const result = parseCatalogInfo({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'api-service',
        description: 'The main API',
        tags: ['rust', 'production'],
        links: [{ url: 'https://docs', title: 'Docs' }],
        annotations: { 'github.com/project-slug': 'org/api-service' },
      },
      spec: {
        type: 'service',
        lifecycle: 'production',
        owner: 'platform-team',
        system: 'core',
        domain: 'infrastructure',
        dependsOn: ['component:db', 'component:cache'],
        providesApis: ['user-api'],
      },
    });

    expect(result.name).toBe('api-service');
    expect(result.updates.owner).toBe('platform-team');
    expect(result.updates.tier).toBe('production');
    expect(result.updates.metadata.backstage.type).toBe('service');
    expect(result.updates.metadata.backstage.system).toBe('core');
    expect(result.updates.metadata.backstage.domain).toBe('infrastructure');
    expect(result.updates.metadata.backstage.tags).toEqual(['rust', 'production']);
    expect(result.updates.metadata.backstage.depends_on).toEqual(['component:db', 'component:cache']);
    expect(result.updates.metadata.backstage.provides_apis).toEqual(['user-api']);
    expect(result.updates.metadata.annotations['github.com/project-slug']).toBe('org/api-service');
  });

  it('handles minimal documents (only kind + name)', () => {
    const result = parseCatalogInfo({
      kind: 'Component',
      metadata: { name: 'minimal' },
    });
    expect(result.name).toBe('minimal');
    expect(result.updates.owner).toBe(null);
    expect(result.updates.tier).toBe(null);
    expect(result.updates.metadata.backstage.tags).toEqual([]);
  });
});
