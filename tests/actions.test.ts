import { describe, expect, it } from 'vitest';
import { tryDeterministicCommand } from '../src/parse';
import type { EntityRecord } from '../src/types';

describe('tryDeterministicCommand', () => {
  const entities = new Map<string, EntityRecord>();
  entities.set('project/imts', {
    key: 'project/imts',
    type: 'Project',
    name: 'IMTS',
    subs: new Set(),
    tasks: [],
    activities: [],
    related: new Map(),
    noteCount: 3,
    lastSeen: '2026-06-03',
    firstSeen: '2026-06-02',
  });

  it('parses "Change IMTS from Project to Conference"', () => {
    const res = tryDeterministicCommand('Change IMTS from Project to Conference', entities);
    expect(res).not.toBeNull();
    expect(res?.type).toBe('reclassify');
    expect(res?.reclassify?.oldType).toBe('Project');
    expect(res?.reclassify?.oldName).toBe('IMTS');
    expect(res?.reclassify?.newType).toBe('Conference');
  });

  it('parses "Reclassify IMTS as Conference" using entity index lookup', () => {
    const res = tryDeterministicCommand('Reclassify IMTS as Conference', entities);
    expect(res).not.toBeNull();
    expect(res?.type).toBe('reclassify');
    expect(res?.reclassify?.oldType).toBe('Project');
    expect(res?.reclassify?.oldName).toBe('IMTS');
    expect(res?.reclassify?.newType).toBe('Conference');
  });

  it('parses "Change #Project/IMTS to #Conference/IMTS"', () => {
    const res = tryDeterministicCommand('Change #Project/IMTS to #Conference/IMTS', entities);
    expect(res).not.toBeNull();
    expect(res?.type).toBe('reclassify');
    expect(res?.reclassify?.oldType).toBe('Project');
    expect(res?.reclassify?.oldName).toBe('IMTS');
    expect(res?.reclassify?.newType).toBe('Conference');
  });
});
