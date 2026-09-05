import { describe, expect, it } from 'vitest';
import {
  computeGraphLayout,
  getConnectedNodes,
  isSystemOrNoiseLink,
  toTitleCase,
} from '../src/graph';
import type { EntityRecord, RolodexIndex } from '../src/types';

describe('isSystemOrNoiseLink', () => {
  it('identifies internal obsidian meta notes', () => {
    expect(isSystemOrNoiseLink('Task Hub')).toBe(true);
    expect(isSystemOrNoiseLink('Support Cases')).toBe(true);
    expect(isSystemOrNoiseLink('Thread Consolidation')).toBe(true);
    expect(isSystemOrNoiseLink('Daily Log')).toBe(true);
    expect(isSystemOrNoiseLink('Scratch')).toBe(true);
    expect(isSystemOrNoiseLink('Workloads')).toBe(true);
    expect(isSystemOrNoiseLink('1on1s')).toBe(true);
  });

  it('identifies attachments and pasted images', () => {
    expect(isSystemOrNoiseLink('Pasted image 20260825113408.png')).toBe(true);
    expect(isSystemOrNoiseLink('architecture.pdf')).toBe(true);
    expect(isSystemOrNoiseLink('demo.mov')).toBe(true);
  });

  it('identifies date notes', () => {
    expect(isSystemOrNoiseLink('2026-08-10')).toBe(true);
    expect(isSystemOrNoiseLink('2026-09-04')).toBe(true);
  });

  it('identifies meeting audio note link names ending in notes', () => {
    expect(isSystemOrNoiseLink('Commure Checkpoint with Eric — notes')).toBe(true);
    expect(isSystemOrNoiseLink('GE4HC Working Session - notes')).toBe(true);
  });

  it('allows real entities and stakeholders', () => {
    expect(isSystemOrNoiseLink('David Pichardo')).toBe(false);
    expect(isSystemOrNoiseLink('Jan Felix Meyer')).toBe(false);
    expect(isSystemOrNoiseLink('Altimetrik')).toBe(false);
    expect(isSystemOrNoiseLink('AlphaEvolve')).toBe(false);
    expect(isSystemOrNoiseLink('Suki')).toBe(false);
  });
});

describe('toTitleCase', () => {
  it('capitalizes words properly', () => {
    expect(toTitleCase('david pichardo')).toBe('David Pichardo');
    expect(toTitleCase('jan felix meyer')).toBe('Jan Felix Meyer');
  });
});

describe('getConnectedNodes', () => {
  const dummyEntity: EntityRecord = {
    key: 'customer/amgen',
    type: 'Customer',
    name: 'Amgen',
    subs: new Set(),
    tasks: [],
    activities: [],
    related: new Map([
      ['partner/altimetrik', 12],
      ['project/alphaevolve', 7],
      ['link/david pichardo', 10],
      ['link/task hub', 25], // System noise - should be filtered
      ['link/pasted image 123.png', 4], // Image attachment - should be filtered
      ['link/2026-08-12', 3], // Date - should be filtered
      ['link/amgen', 5], // Self link - should be filtered
      ['customer/suki', 2], // Related customer
    ]),
    noteCount: 15,
    lastSeen: '2026-09-04',
    firstSeen: '2026-08-01',
  };

  const dummyIndex: RolodexIndex = {
    entities: new Map([
      [
        'partner/altimetrik',
        {
          key: 'partner/altimetrik',
          type: 'Partner',
          name: 'Altimetrik',
          subs: new Set(),
          tasks: [],
          activities: [],
          related: new Map(),
          noteCount: 8,
          lastSeen: '2026-09-02',
          firstSeen: '2026-08-01',
        },
      ],
      [
        'project/alphaevolve',
        {
          key: 'project/alphaevolve',
          type: 'Project',
          name: 'AlphaEvolve',
          subs: new Set(),
          tasks: [],
          activities: [],
          related: new Map(),
          noteCount: 5,
          lastSeen: '2026-09-01',
          firstSeen: '2026-08-01',
        },
      ],
      [
        'customer/suki',
        {
          key: 'customer/suki',
          type: 'Customer',
          name: 'Suki',
          subs: new Set(),
          tasks: [],
          activities: [],
          related: new Map(),
          noteCount: 20,
          lastSeen: '2026-09-04',
          firstSeen: '2026-08-01',
        },
      ],
    ]),
    typesSeen: new Map([['customer', 2], ['partner', 1], ['project', 1]]),
    scannedFiles: 25,
    builtAt: Date.now(),
  };

  it('filters out system noise and returns ordered connected nodes', () => {
    const nodes = getConnectedNodes(dummyEntity, dummyIndex);
    expect(nodes.map(n => n.name)).toEqual([
      'Altimetrik',
      'David Pichardo',
      'AlphaEvolve',
      'Suki',
    ]);
    expect(nodes.find(n => n.name === 'David Pichardo')?.type).toBe('Stakeholder');
    expect(nodes.find(n => n.name === 'Altimetrik')?.type).toBe('Partner');
    expect(nodes.find(n => n.name === 'AlphaEvolve')?.type).toBe('Project');
    expect(nodes.find(n => n.name === 'Suki')?.type).toBe('Customer');
  });

  it('merges wikilinks pointing to known entities', () => {
    const entityWithWikilinkPartner: EntityRecord = {
      ...dummyEntity,
      related: new Map([
        ['partner/altimetrik', 5],
        ['link/altimetrik', 3], // Wikilink pointing to Altimetrik
      ]),
    };
    const nodes = getConnectedNodes(entityWithWikilinkPartner, dummyIndex);
    expect(nodes.length).toBe(1);
    expect(nodes[0].name).toBe('Altimetrik');
    expect(nodes[0].count).toBe(8); // Merged 5 + 3
    expect(nodes[0].isEntity).toBe(true);
  });

  it('merges attendees (person/...) and wikilinks (link/...) for the same stakeholder', () => {
    const entityWithPersonAndLink: EntityRecord = {
      ...dummyEntity,
      related: new Map([
        ['link/david pichardo', 5],
        ['person/david pichardo', 7],
      ]),
    };
    const nodes = getConnectedNodes(entityWithPersonAndLink, dummyIndex);
    expect(nodes.length).toBe(1);
    expect(nodes[0].name).toBe('David Pichardo');
    expect(nodes[0].count).toBe(12); // Merged 5 + 7
    expect(nodes[0].type).toBe('Stakeholder');
  });
});

describe('computeGraphLayout', () => {
  it('calculates node positions within viewport boundaries', () => {
    const sampleNodes = [
      { key: 'partner/1', name: 'Partner 1', type: 'Partner' as const, count: 10, isEntity: true },
      { key: 'project/1', name: 'Project 1', type: 'Project' as const, count: 6, isEntity: true },
      { key: 'link/david', name: 'David Pichardo', type: 'Stakeholder' as const, count: 12, isEntity: false },
      { key: 'customer/suki', name: 'Suki', type: 'Customer' as const, count: 4, isEntity: true },
    ];

    const layout = computeGraphLayout(sampleNodes, 600, 270);
    expect(layout.center.x).toBe(300);
    expect(layout.center.y).toBe(135);
    expect(layout.nodes.length).toBe(4);

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThan(40);
      expect(node.x).toBeLessThan(560);
      expect(node.y).toBeGreaterThan(20);
      expect(node.y).toBeLessThan(250);
      expect(node.radius).toBeGreaterThanOrEqual(8);
      expect(node.radius).toBeLessThanOrEqual(15);
    }
  });
});
