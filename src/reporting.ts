/**
 * Vault-native Reporting & Intelligence Integrations for Rolodex.
 *
 * Discovers:
 * 1. Existing 2x2 reports under Reporting/2x2/
 * 2. Active Support Cases from Reporting/Dashboards/Support Cases.md
 * 3. Opportunities & Pipeline from Reporting/Dashboards/Workloads.md
 */

import { App, TFile } from 'obsidian';
import type { EntityRecord } from './types';

export interface ExistingReport {
  path: string;
  label: string;
  dateRange: string;
  fromDate: string;
  toDate: string;
}

export interface SupportCaseItem {
  caseNumber: string;
  url: string;
  priority: 'P0' | 'P1' | 'P2';
  product: string;
  status: string;
  owner: string;
  age: string;
}

export interface WorkloadOpportunity {
  name: string;
  url: string;
  amount: number;
  amountFormatted: string;
  closeDate: string;
  stage: string;
  type: string;
  isMissingWorkload: boolean;
}

export interface AccountPipeline {
  totalPipeline: number;
  totalPipelineFormatted: string;
  opps: WorkloadOpportunity[];
  missingWorkloadCount: number;
}

/**
 * Normalizes company and account names for fuzzy matching.
 * e.g., "Amgen, Inc." -> "amgen", "Suki AI" -> "suki", "[[Commure]]" -> "commure"
 */
export function normalizeAccountName(raw: string): string {
  return raw
    .replace(/\[\[|\]\]/g, '')
    .replace(/[,.]/g, ' ')
    .replace(/\b(inc|corp|corporation|ai|technologies|tech|llc|ltd|holdings)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function accountsMatch(a: string, b: string): boolean {
  const normA = normalizeAccountName(a);
  const normB = normalizeAccountName(b);
  if (!normA || !normB) return false;
  return normA === normB || normA.includes(normB) || normB.includes(normA);
}

/**
 * Formats ISO date range (YYYY-MM-DD to YYYY-MM-DD) to friendly short string.
 * e.g. "2026-08-29" to "2026-09-05" -> "Aug 29 – Sep 5"
 * e.g. "2026-08-01" to "2026-08-31" -> "Aug 2026"
 */
export function formatFriendlyDateRange(from: string, to: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fromParts = from.split('-').map(Number);
  const toParts = to.split('-').map(Number);

  if (fromParts.length === 3 && toParts.length === 3) {
    const fromM = months[fromParts[1] - 1] || '';
    const toM = months[toParts[1] - 1] || '';
    const fromD = fromParts[2];
    const toD = toParts[2];

    if (fromParts[0] === toParts[0] && fromParts[1] === toParts[1]) {
      // Same month
      if (fromD === 1 && toD >= 28) {
        return `${fromM} ${fromParts[0]}`;
      }
      return `${fromM} ${fromD} – ${toD}`;
    }
    return `${fromM} ${fromD} – ${toM} ${toD}`;
  }
  return `${from} – ${to}`;
}

/**
 * Finds all pre-existing 2x2 markdown reports for the entity.
 */
export function findExistingReports(app: App, entity: EntityRecord): ExistingReport[] {
  const reports: ExistingReport[] = [];
  const typeLower = entity.type.toLowerCase();
  const nameNorm = normalizeAccountName(entity.name);

  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const p = file.path;
    // Check if path is under Reporting/2x2/(customer|project)/...
    if (!p.startsWith('Reporting/2x2/')) continue;

    const pathParts = p.split('/');
    if (pathParts.length < 4) continue;

    const folderType = pathParts[2].toLowerCase(); // e.g. "customer" or "project"
    const folderAccount = normalizeAccountName(pathParts[3]); // e.g. "amgen"

    if (folderType === typeLower && (folderAccount === nameNorm || folderAccount.includes(nameNorm))) {
      // Parse dates from filename
      // e.g. 2x2 - Customer_Amgen - 2026-08-29_to_2026-09-05.md
      const m = file.basename.match(/(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})/);
      if (m) {
        const fromDate = m[1];
        const toDate = m[2];
        const dateRange = `${fromDate} to ${toDate}`;
        const label = formatFriendlyDateRange(fromDate, toDate);
        reports.push({
          path: file.path,
          label,
          dateRange,
          fromDate,
          toDate,
        });
      } else {
        reports.push({
          path: file.path,
          label: file.basename.replace(/^2x2\s*-\s*/i, ''),
          dateRange: file.basename,
          fromDate: '',
          toDate: '',
        });
      }
    }
  }

  // Sort newest to oldest
  reports.sort((a, b) => b.toDate.localeCompare(a.toDate) || b.fromDate.localeCompare(a.fromDate));
  return reports;
}

/**
 * Parses active support cases for an account from Reporting/Dashboards/Support Cases.md
 */
export async function parseAccountSupportCases(app: App, accountName: string): Promise<SupportCaseItem[]> {
  const casesFile = app.vault.getAbstractFileByPath('Reporting/Dashboards/Support Cases.md');
  if (!(casesFile instanceof TFile)) return [];

  const content = await app.vault.cachedRead(casesFile);
  const cases: SupportCaseItem[] = [];

  let currentPriority: 'P0' | 'P1' | 'P2' = 'P2';
  const lines = content.split('\n');

  for (const line of lines) {
    if (line.includes('### 🔴 P0')) {
      currentPriority = 'P0';
      continue;
    } else if (line.includes('### 🟠 P1')) {
      currentPriority = 'P1';
      continue;
    } else if (line.includes('### 🟡 P2')) {
      currentPriority = 'P2';
      continue;
    }

    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map(c => c.trim()).slice(1, -1);
    if (cols.length < 6) continue;

    // Header check
    if (cols[0].toLowerCase() === 'case' || cols[1].toLowerCase() === 'account') continue;

    const caseCol = cols[0];
    const accountCol = cols[1];
    const product = cols[2];
    const status = cols[3];
    const owner = cols[4];
    const age = cols[5];

    if (!accountsMatch(accountCol, accountName)) continue;

    // Extract link & case number: [74204836](url)
    const linkMatch = caseCol.match(/\[(\d+)\]\(([^)]+)\)/);
    const caseNumber = linkMatch ? linkMatch[1] : caseCol;
    const url = linkMatch ? linkMatch[2] : '';

    cases.push({
      caseNumber,
      url,
      priority: currentPriority,
      product,
      status,
      owner,
      age,
    });
  }

  return cases;
}

/**
 * Parses opportunity pipeline and missing workload alerts from Reporting/Dashboards/Workloads.md
 */
export async function parseAccountWorkloads(app: App, accountName: string): Promise<AccountPipeline | null> {
  const workloadsFile = app.vault.getAbstractFileByPath('Reporting/Dashboards/Workloads.md');
  if (!(workloadsFile instanceof TFile)) return null;

  const content = await app.vault.cachedRead(workloadsFile);
  const oppMap = new Map<string, WorkloadOpportunity>();
  let isMissingWorkloadSection = false;

  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('## 🚨 URGENT') || line.startsWith('## 🔴 Priority 1')) {
      isMissingWorkloadSection = true;
    } else if (line.startsWith('## 🟡 Priority 2') || line.startsWith('## 🟢') || line.startsWith('## Summary')) {
      isMissingWorkloadSection = false;
    }

    if (!line.startsWith('|')) continue;
    const cols = line.split('|').map(c => c.trim()).slice(1, -1);
    if (cols.length < 5) continue;

    // Header row skip
    if (cols.some(c => c.toLowerCase() === 'customer' || c.toLowerCase() === 'opportunity')) continue;

    // Col offsets vary slightly if there is an index column "#"
    let customerCol = '';
    let oppCol = '';
    let amountCol = '';
    let closeCol = '';
    let stageCol = '';
    let typeCol = '';

    if (cols[0].match(/^\d+$/)) {
      // Col 0 is #
      customerCol = cols[1];
      oppCol = cols[2];
      amountCol = cols[3];
      closeCol = cols[4];
      stageCol = cols[5] || '';
      typeCol = cols[7] || cols[6] || '';
    } else {
      customerCol = cols[0];
      oppCol = cols[1];
      amountCol = cols[2];
      closeCol = cols[3];
      stageCol = cols[4] || '';
      typeCol = cols[5] || '';
    }

    if (!accountsMatch(customerCol, accountName)) continue;

    // Parse opp link and name
    const linkMatch = oppCol.match(/\[([^\]]+)\]\(([^)]+)\)/);
    const oppName = linkMatch ? linkMatch[1] : oppCol;
    const oppUrl = linkMatch ? linkMatch[2] : '';

    // Parse amount
    const numClean = amountCol.replace(/[$,]/g, '').trim();
    const amount = parseFloat(numClean) || 0;

    const key = oppName.toLowerCase();
    const existing = oppMap.get(key);
    if (existing) {
      if (isMissingWorkloadSection) existing.isMissingWorkload = true;
    } else {
      oppMap.set(key, {
        name: oppName,
        url: oppUrl,
        amount,
        amountFormatted: amountCol,
        closeDate: closeCol.replace(/\*\*/g, ''),
        stage: stageCol,
        type: typeCol,
        isMissingWorkload: isMissingWorkloadSection,
      });
    }
  }

  const opps = Array.from(oppMap.values());
  if (opps.length === 0) return null;

  const totalPipeline = opps.reduce((sum, o) => sum + o.amount, 0);
  const totalPipelineFormatted = `$${(totalPipeline / 1_000_000).toFixed(2)}M`;
  const missingWorkloadCount = opps.filter(o => o.isMissingWorkload).length;

  return {
    totalPipeline,
    totalPipelineFormatted,
    opps,
    missingWorkloadCount,
  };
}
