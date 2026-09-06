import { describe, expect, it } from 'vitest';
import {
  normalizeAccountName,
  accountsMatch,
  formatFriendlyDateRange,
  findExistingReports,
  parseAccountSupportCases,
  parseAccountWorkloads,
} from '../src/reporting';
import type { EntityRecord } from '../src/types';
import { TFile } from 'obsidian';

describe('normalizeAccountName and accountsMatch', () => {
  it('normalizes corporate suffixes and bracket links', () => {
    expect(normalizeAccountName('[[Commure]]')).toBe('commure');
    expect(normalizeAccountName('Amgen, Inc.')).toBe('amgen');
    expect(normalizeAccountName('Suki AI')).toBe('suki');
    expect(normalizeAccountName('Agilent Technologies, Inc.')).toBe('agilent');
  });

  it('matches accounts accurately', () => {
    expect(accountsMatch('Amgen, Inc.', 'Amgen')).toBe(true);
    expect(accountsMatch('[[Commure]]', 'Commure')).toBe(true);
    expect(accountsMatch('Suki AI', 'Suki')).toBe(true);
    expect(accountsMatch('Agilent Technologies, Inc.', 'Agilent')).toBe(true);
    expect(accountsMatch('Amgen', 'Suki')).toBe(false);
  });
});

describe('formatFriendlyDateRange', () => {
  it('formats full month ranges', () => {
    expect(formatFriendlyDateRange('2026-08-01', '2026-08-31')).toBe('Aug 2026');
  });

  it('formats partial month ranges', () => {
    expect(formatFriendlyDateRange('2026-08-29', '2026-09-05')).toBe('Aug 29 – Sep 5');
    expect(formatFriendlyDateRange('2026-08-06', '2026-08-20')).toBe('Aug 6 – 20');
  });
});

describe('findExistingReports', () => {
  const dummyEntity: EntityRecord = {
    key: 'customer/amgen',
    type: 'Customer',
    name: 'Amgen',
    subs: new Set(),
    tasks: [],
    activities: [],
    related: new Map(),
    noteCount: 10,
  };

  it('finds and sorts existing 2x2 markdown reports', () => {
    const mockFiles: any[] = [
      {
        path: 'Reporting/2x2/customer/Amgen/2x2 - Customer_Amgen - 2026-08-01_to_2026-08-31.md',
        basename: '2x2 - Customer_Amgen - 2026-08-01_to_2026-08-31',
      },
      {
        path: 'Reporting/2x2/customer/Amgen/2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05.md',
        basename: '2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05',
      },
      {
        path: 'Reporting/2x2/customer/Suki/2x2 - Customer_Suki - 2026-08-01_to_2026-08-31.md',
        basename: '2x2 - Customer_Suki - 2026-08-01_to_2026-08-31',
      },
    ];

    const mockApp: any = {
      vault: {
        getMarkdownFiles: () => mockFiles,
      },
    };

    const reports = findExistingReports(mockApp, dummyEntity);
    expect(reports.length).toBe(2);
    expect(reports[0].label).toBe('Aug 29 – Sep 5');
    expect(reports[0].path).toContain('2026-08-29_to_2026-09-05');
    expect(reports[1].label).toBe('Aug 2026');
  });

  it('strictly excludes weekly and monthly portfolio 2x2 reports', () => {
    const mockFiles: any[] = [
      {
        path: 'Reporting/2x2/weekly/2026/2026-09/weekly_2x2_2026-08-29_to_2026-09-05.md',
        basename: 'weekly_2x2_2026-08-29_to_2026-09-05',
      },
      {
        path: 'Reporting/2x2/monthly/2026/monthly_2x2_2026-08.md',
        basename: 'monthly_2x2_2026-08',
      },
      {
        path: 'Reporting/2x2/customer/Amgen/2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05.md',
        basename: '2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05',
      },
      {
        path: 'Reporting/2x2/customer/Amgen/2x2 - Customer_Amgen_Risk - 2026-09-01.md',
        basename: '2x2 - Customer_Amgen_Risk - 2026-09-01',
      },
    ];

    const mockApp: any = {
      vault: {
        getMarkdownFiles: () => mockFiles,
      },
    };

    const reports = findExistingReports(mockApp, dummyEntity);
    // Should ONLY return the 2 Amgen reports, completely ignoring weekly and monthly
    expect(reports.length).toBe(2);
    expect(reports[0].path).toContain('2026-08-29_to_2026-09-05');
    expect(reports[0].isRisk).toBe(false);
    expect(reports[1].path).toContain('Customer_Amgen_Risk');
    expect(reports[1].isRisk).toBe(true);
  });

  it('returns empty list for non-customer and non-project entities', () => {
    const personEntity: EntityRecord = {
      key: 'person/harry',
      type: 'Person',
      name: 'Harry',
      subs: new Set(),
      tasks: [],
      activities: [],
      related: new Map(),
      noteCount: 1,
    };

    const mockFiles: any[] = [
      {
        path: 'Reporting/2x2/customer/Amgen/2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05.md',
        basename: '2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05',
      },
    ];

    const mockApp: any = {
      vault: {
        getMarkdownFiles: () => mockFiles,
      },
    };

    expect(findExistingReports(mockApp, personEntity)).toEqual([]);
  });
});

describe('parseAccountSupportCases', () => {
  const sampleContent = `
# Support Cases

<!-- CASES:AUTO -->
### 🔴 P0
_None open._

### 🟠 P1
_None open._

### 🟡 P2
| Case | Account | Product | Status | Owner | Age |
|---|---|---|---|---|---|
| [74204836](https://goto.corp.google.com/vgo/74204836) | [[Commure]] | Cloud SQL for PostgreSQL | IPCO - In Progress Consult Owner | pallavidani | 26d |
| [74500000](https://goto.corp.google.com/vgo/74500000) | [[Amgen]] | Vertex AI | ASSIGNED | jsmith | 2d |
<!-- /CASES:AUTO -->
`;

  it('parses open support cases matching account name', async () => {
    const mockFile = Object.create(TFile.prototype);
    mockFile.path = 'Reporting/Dashboards/Support Cases.md';

    const mockApp: any = {
      vault: {
        getAbstractFileByPath: (p: string) => (p === mockFile.path ? mockFile : null),
        cachedRead: async () => sampleContent,
      },
    };

    const commureCases = await parseAccountSupportCases(mockApp, 'Commure');
    expect(commureCases.length).toBe(1);
    expect(commureCases[0].caseNumber).toBe('74204836');
    expect(commureCases[0].priority).toBe('P2');
    expect(commureCases[0].product).toBe('Cloud SQL for PostgreSQL');
    expect(commureCases[0].age).toBe('26d');

    const amgenCases = await parseAccountSupportCases(mockApp, 'Amgen');
    expect(amgenCases.length).toBe(1);
    expect(amgenCases[0].caseNumber).toBe('74500000');

    const sukiCases = await parseAccountSupportCases(mockApp, 'Suki');
    expect(sukiCases.length).toBe(0);
  });

  it('prioritizes dedicated customer extract file over dashboard', async () => {
    const custFile = Object.create(TFile.prototype);
    custFile.path = 'Reporting/Support Cases/customer/Commure.md';
    custFile.basename = 'Commure';

    const custContent = `---
type: support-cases-extract
customer: Commure
open_cases: 1
---
# Support Cases — Commure

## 🚨 Active Support Cases

| Case | Priority | Product | Status | Owner | Age | Last Modified |
|---|---|---|---|---|---|---|
| [74204836](https://goto.corp.google.com/vgo/74204836) | 🟡 P2 | Cloud SQL for PostgreSQL | IPCO - In Progress Consult Owner | pallavidani | 26d | 2026-09-05 18:22 UTC |
`;

    const mockApp: any = {
      vault: {
        getMarkdownFiles: () => [custFile],
        getAbstractFileByPath: () => null,
        cachedRead: async (f: any) => (f === custFile ? custContent : ''),
      },
    };

    const commureCases = await parseAccountSupportCases(mockApp, 'Commure');
    expect(commureCases.length).toBe(1);
    expect(commureCases[0].caseNumber).toBe('74204836');
    expect(commureCases[0].priority).toBe('P2');
    expect(commureCases[0].product).toBe('Cloud SQL for PostgreSQL');
    expect(commureCases[0].filePath).toBe('Reporting/Support Cases/customer/Commure.md');
  });
});

describe('parseAccountWorkloads', () => {
  const sampleContent = `
## 🚨 URGENT — Close within 60 days (by 2026-09-04), missing workload

| Customer | Opportunity | Amount | Close | Stage | Type |
|---|---|---|---|---|---|
| Amgen, Inc. | [Amgen- Wiz (Cloud/Code)- $510k iACV](https://vector.lightning.force.com/opp1) | $510,000 | 2026-07-31 | 02 - Tech Eval/Solution Dev | Security |
| Suki AI | [SUKI Managed Threat Defense](https://vector.lightning.force.com/opp2) | $150,000 | 2026-07-31 | 02 - Tech Eval/Solution Dev | Security |

## 🔴 Priority 1 — CRITICAL: Missing Workloads (14)

| # | Customer | Opportunity | Amount | Close | Stage | Opp Owner | Type |
|---|---|---|---|---|---|---|---|
| 1 | Amgen, Inc. | [Amgen- Wiz (Cloud/Code)- $510k iACV](https://vector.lightning.force.com/opp1) | $510,000 | 2026-07-31 | 02 - Tech Eval/Solution Dev | davidpichardo | Security |
| 2 | Amgen, Inc. | [Amgen - Gemini Enterprise Upsell for R&D](https://vector.lightning.force.com/opp3) | $510,000 | 2026-12-31 | 03 - Proposal/Negotiation | ravibaji | AI/ML |
| 3 | Amgen, Inc. | [Amgen - FoldRun- HPC/AI](https://vector.lightning.force.com/opp4) | $400,000 | 2026-12-31 | 02 - Tech Eval/Solution Dev | davidpichardo | Infrastructure |
`;

  it('parses account pipeline totals, opps and missing workload flags', async () => {
    const mockFile = Object.create(TFile.prototype);
    mockFile.path = 'Reporting/Dashboards/Workloads.md';

    const mockApp: any = {
      vault: {
        getAbstractFileByPath: (p: string) => (p === mockFile.path ? mockFile : null),
        cachedRead: async () => sampleContent,
      },
    };

    const pipeline = await parseAccountWorkloads(mockApp, 'Amgen');
    expect(pipeline).not.toBeNull();
    expect(pipeline?.totalPipeline).toBe(1420000);
    expect(pipeline?.totalPipelineFormatted).toBe('$1.42M');
    expect(pipeline?.opps.length).toBe(3);
    expect(pipeline?.missingWorkloadCount).toBe(3); // All 3 appear under missing workload sections
    expect(pipeline?.opps[0].name).toBe('Amgen- Wiz (Cloud/Code)- $510k iACV');
    expect(pipeline?.opps[0].amount).toBe(510000);
    expect(pipeline?.opps[0].isMissingWorkload).toBe(true);

    const sukiPipeline = await parseAccountWorkloads(mockApp, 'Suki');
    expect(sukiPipeline?.totalPipeline).toBe(150000);
    expect(sukiPipeline?.opps.length).toBe(1);

    const nonExistent = await parseAccountWorkloads(mockApp, 'NonExistent');
    expect(nonExistent).toBeNull();
  });

  it('prioritizes dedicated customer extract file over dashboard', async () => {
    const custFile = Object.create(TFile.prototype);
    custFile.path = 'Reporting/Workloads/customer/Amgen.md';
    custFile.basename = 'Amgen';

    const custContent = `---
type: workload-extract
customer: Amgen
total_pipeline: 910000
total_pipeline_formatted: "$910K"
---
# Workloads & Pipeline — Amgen

## 💼 Active Opportunities

| Opportunity | Amount | Stage | Close Date | Owner | Workload Status |
|---|---|---|---|---|---|
| [Amgen- Wiz (Cloud/Code)- $510k iACV](https://vector.lightning.force.com/opp1) | $510K | 02 - Tech Eval | 2026-07-31 | Security | 🔴 Missing Workload |
| [Amgen - FoldRun- HPC/AI](https://vector.lightning.force.com/opp4) | $400K | 02 - Tech Eval | 2026-12-31 | davidpichardo | 🟢 Attached |
`;

    const mockApp: any = {
      vault: {
        getMarkdownFiles: () => [custFile],
        getAbstractFileByPath: () => null,
        cachedRead: async (f: any) => (f === custFile ? custContent : ''),
      },
    };

    const pipeline = await parseAccountWorkloads(mockApp, 'Amgen');
    expect(pipeline).not.toBeNull();
    expect(pipeline?.totalPipeline).toBe(910000);
    expect(pipeline?.totalPipelineFormatted).toBe('$910K');
    expect(pipeline?.opps.length).toBe(2);
    expect(pipeline?.missingWorkloadCount).toBe(1);
    expect(pipeline?.filePath).toBe('Reporting/Workloads/customer/Amgen.md');
    expect(pipeline?.opps[0].isMissingWorkload).toBe(true);
    expect(pipeline?.opps[1].isMissingWorkload).toBe(false);
  });
});
