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

describe('createOrOpenContactNote', () => {
  it('creates contact note with frontmatter, tags, company, and query blocks', async () => {
    const { createOrOpenContactNote } = await import('../src/actions');
    const createdFiles: Record<string, string> = {};
    const createdDirs: string[] = [];

    const mockApp: any = {
      metadataCache: {
        getFirstLinkpathDest: (path: string) => null,
      },
      vault: {
        adapter: {
          exists: async (p: string) => createdDirs.includes(p),
          mkdir: async (p: string) => { createdDirs.push(p); },
        },
        create: async (p: string, content: string) => {
          createdFiles[p] = content;
          return { path: p };
        },
      },
    };

    const targetPath = await createOrOpenContactNote(mockApp, 'David Pichardo', 'Amgen', 'dpichardo@google.com');
    expect(targetPath).toBe('Wiki/People/David Pichardo.md');
    expect(createdDirs).toEqual(['Wiki', 'Wiki/People']);
    expect(createdFiles[targetPath]).toBeDefined();
    const content = createdFiles[targetPath];
    expect(content).toContain('type: Contact');
    expect(content).toContain('name: David Pichardo');
    expect(content).toContain('company: "[[Amgen]]"');
    expect(content).toContain('email: dpichardo@google.com');
    expect(content).toContain('- Person');
    expect(content).toContain('- Contact/Amgen');
    expect(content).toContain('# David Pichardo');
    expect(content).toContain('**Company:** [[Amgen]]');
    expect(content).toContain('description includes David Pichardo');
    expect(content).toContain('WHERE contains(file.text, "David Pichardo")');
  });

  it('returns existing file path if note already exists in vault', async () => {
    const { createOrOpenContactNote } = await import('../src/actions');
    const { TFile } = await import('obsidian');

    const fakeExistingFile = Object.create(TFile.prototype);
    fakeExistingFile.path = 'Wiki/People/Existing Person.md';

    const mockApp: any = {
      metadataCache: {
        getFirstLinkpathDest: (path: string) => {
          if (path === 'Existing Person') return fakeExistingFile;
          return null;
        },
      },
      vault: {
        adapter: {},
        create: async () => {},
      },
    };

    const targetPath = await createOrOpenContactNote(mockApp, 'Existing Person', 'Amgen');
    expect(targetPath).toBe('Wiki/People/Existing Person.md');
  });
});
