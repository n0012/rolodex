import { describe, expect, it } from 'vitest';
import { isAggregateHeading, findEntitiesInHeading, extractEntityChunk, shouldScan, parseAttendeesFromSection } from '../src/scanner';

describe('isAggregateHeading', () => {
  it('detects generic workflow aggregate headings', () => {
    expect(isAggregateHeading('## 📥 Inbox')).toBe(true);
    expect(isAggregateHeading('## 🗂 Tasks')).toBe(true);
    expect(isAggregateHeading('### Scratch')).toBe(true);
    expect(isAggregateHeading('## Daily Log')).toBe(true);
    expect(isAggregateHeading('## 🧪 Proposed (review)')).toBe(true);
    expect(isAggregateHeading('## Daily Check List - Start of Day')).toBe(true);
    expect(isAggregateHeading('## 🎯 Start Here')).toBe(true);
    expect(isAggregateHeading('## ⏳ Aging')).toBe(true);
  });

  it('does NOT mark headings with entities as aggregate', () => {
    expect(isAggregateHeading('### Suki monthly GCP billing review #Customer/Suki', true)).toBe(false);
    expect(isAggregateHeading('### [[Agilent]] Prep (internal) #Customer/Agilent', true)).toBe(false);
    expect(isAggregateHeading('### meeting (Takeda+Gemini+Altimetrik)', true)).toBe(false);
    expect(isAggregateHeading('### Prep: Richard Seroter\'s Amgen Exec Briefing #Customer/Amgen', true)).toBe(false);
    expect(isAggregateHeading('### [Eli Lilly] GCC Daily Standup #Customer/Lilly', true)).toBe(false);
  });

  it('treats generic unassociated standup or prep as aggregate when hasEntity is false', () => {
    expect(isAggregateHeading('### Daily Standup', false)).toBe(true);
    expect(isAggregateHeading('### Prep', false)).toBe(true);
  });
});

describe('findEntitiesInHeading', () => {
  const known = new Map([
    ['takeda', { key: 'customer/takeda', type: 'Customer', name: 'Takeda', subs: [] }],
    ['agilent', { key: 'customer/agilent', type: 'Customer', name: 'Agilent', subs: [] }],
    ['amgen', { key: 'customer/amgen', type: 'Customer', name: 'Amgen', subs: [] }],
    ['suki', { key: 'customer/suki', type: 'Customer', name: 'Suki', subs: [] }],
    ['ge', { key: 'customer/ge', type: 'Customer', name: 'GE', subs: [] }],
    ['gehc', { key: 'customer/gehc', type: 'Customer', name: 'GEHC', subs: [] }],
  ]);

  it('matches entity names inside meeting titles with delimiters', () => {
    const hits = findEntitiesInHeading('### meeting (Takeda+Gemini+Altimetrik)', known);
    expect(hits.map(h => h.key)).toEqual(['customer/takeda']);
  });

  it('matches entity names with word boundaries without colliding (GE vs GEHC)', () => {
    const geHits = findEntitiesInHeading('### GE Strategy Discussion', known);
    expect(geHits.map(h => h.key)).toEqual(['customer/ge']);

    const gehcHits = findEntitiesInHeading('### GEHC Infrastructure Review', known);
    expect(gehcHits.map(h => h.key)).toEqual(['customer/gehc']);
  });

  it('matches wikilinks in headings', () => {
    const hits = findEntitiesInHeading('### [[Agilent]] / Google Connect', known);
    expect(hits.map(h => h.key)).toEqual(['customer/agilent']);
  });

  it('matches multiple entities in joint headings', () => {
    const hits = findEntitiesInHeading('### Nick / Amit - Connectors and Agents for Suki and Amgen', known);
    expect(hits.map(h => h.key).sort()).toEqual(['customer/amgen', 'customer/suki']);
  });
});

describe('extractEntityChunk', () => {
  it('isolates bullet block belonging to target entity', () => {
    const full = [
      '- **Bicycle Therapeutics**: Shared FoldRun with Amar Raol.',
      '- **Takeda Dynamic Pricing**: Received white paper from Altimetrik. #Customer/Takeda',
      '  - Detailed pricing model attached.',
      '- **Suki TPUv6e Stall**: Escalated in chat.',
    ].join('\n');

    const takedaChunk = extractEntityChunk(full, 'customer/takeda', 'Takeda');
    expect(takedaChunk).toContain('Takeda Dynamic Pricing');
    expect(takedaChunk).toContain('Detailed pricing model attached.');
    expect(takedaChunk).not.toContain('Bicycle Therapeutics');
    expect(takedaChunk).not.toContain('Suki TPUv6e Stall');
  });
});

describe('shouldScan', () => {
  const defaultSettings: any = {
    includeFolders: [],
    excludeFolders: ['Attachments', 'Template', 'Templates', '.trash', '~Archive', 'Reporting'],
  };

  it('scans files in ~Daily and its subfolders', () => {
    expect(shouldScan('~Daily/2026-09-01.md', defaultSettings, '.obsidian')).toBe(true);
    expect(shouldScan('~Daily/2026/2026-08/2026-08-03.md', defaultSettings, '.obsidian')).toBe(true);
  });

  it('strictly rejects files in Reporting/', () => {
    expect(shouldScan('Reporting/2x2/customer/Takeda/report.md', defaultSettings, '.obsidian')).toBe(false);
    expect(shouldScan('Reporting/Dashboards/Task Hub.md', defaultSettings, '.obsidian')).toBe(false);
  });

  it('rejects files outside ~Daily when includeFolders is default empty', () => {
    expect(shouldScan('Wiki/Skills.md', defaultSettings, '.obsidian')).toBe(false);
    expect(shouldScan('Attachments/image.png', defaultSettings, '.obsidian')).toBe(false);
  });
});

describe('parseAttendeesFromSection', () => {
  it('parses attendees and reorders Last, First format', () => {
    const text = `
### Takeda Strategy Sync #Customer/Takeda
**Attendees:** mpanchal@altimetrik.com, David Pichardo (davidpichardo@google.com), losiern@google.com, Meyer, Jan Felix (jan-felix.meyer@takeda.com), US-AUS-601W (resource@resource.calendar.google.com) (4 attendees)
    `;

    const attendees = parseAttendeesFromSection(text);
    const names = attendees.map(a => a.displayName);
    expect(names).toContain('David Pichardo');
    expect(names).toContain('Jan Felix Meyer');
    expect(names).toContain('Mpanchal');
    // Filters out self and resource room
    expect(names).not.toContain('Losiern');
    expect(names).not.toContain('US-AUS-601W');
  });

  it('resolves email-only attendees via emailToName dictionary', () => {
    const emailToName = new Map([
      ['davidpichardo@google.com', 'David Pichardo'],
      ['ravibaji@google.com', 'Ravi Baji'],
    ]);

    const text = `
### Amgen Security Review #Customer/Amgen
**Attendees:** davidpichardo@google.com, ravibaji@google.com, Praveen Seela (pseela@amgen.com)
    `;

    const attendees = parseAttendeesFromSection(text, emailToName);
    const names = attendees.map(a => a.displayName);
    expect(names).toEqual(['David Pichardo', 'Ravi Baji', 'Praveen Seela']);
  });
});
