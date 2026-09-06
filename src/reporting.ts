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
  isRisk?: boolean;
}

export interface SupportCaseItem {
  caseNumber: string;
  url: string;
  priority: 'P0' | 'P1' | 'P2';
  product: string;
  status: string;
  owner: string;
  age: string;
  filePath?: string;
  isResolved?: boolean;
  resolvedDate?: string;
  notes?: string;
}

export interface AccountSupportCases {
  openCases: SupportCaseItem[];
  resolvedCases: SupportCaseItem[];
  filePath?: string;
}

export interface WorkloadOpportunity {
  id?: string;
  name: string;
  url: string;
  amount: number;
  amountFormatted: string;
  closeDate: string;
  stage: string;
  type: string;
  isMissingWorkload: boolean;
  suggestedFix?: string;
  fixCommand?: string;
}

export interface AccountPipeline {
  totalPipeline: number;
  totalPipelineFormatted: string;
  opps: WorkloadOpportunity[];
  missingWorkloadCount: number;
  filePath?: string;
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
 * Only returns dedicated customer or project reports; strictly ignores weekly or monthly portfolio summaries.
 */
export function findExistingReports(app: App, entity: EntityRecord): ExistingReport[] {
  const reports: ExistingReport[] = [];
  const typeLower = entity.type.toLowerCase();

  // Only Customer and Project entities have dedicated 2x2 report archives
  if (typeLower !== 'customer' && typeLower !== 'project') {
    return reports;
  }

  const nameNorm = normalizeAccountName(entity.name);
  const expectedPrefix = `Reporting/2x2/${typeLower}/`;

  const files = app.vault.getMarkdownFiles();
  for (const file of files) {
    const p = file.path;

    // Reject weekly and monthly reports outright
    if (p.includes('/weekly/') || p.includes('/monthly/')) continue;
    const baseLower = file.basename.toLowerCase();
    if (baseLower.startsWith('weekly') || baseLower.startsWith('monthly')) continue;

    // Must strictly be under Reporting/2x2/<customer|project>/
    if (!p.startsWith(expectedPrefix)) continue;

    const pathParts = p.split('/');
    if (pathParts.length < 4) continue;

    const folderType = pathParts[2].toLowerCase(); // e.g. "customer" or "project"
    if (folderType !== typeLower) continue;

    const folderAccount = normalizeAccountName(pathParts[3]); // e.g. "amgen"
    if (!accountsMatch(folderAccount, nameNorm)) continue;

    // Check frontmatter scope if metadataCache is available
    if (app.metadataCache) {
      const cache = app.metadataCache.getFileCache(file);
      const scope = cache?.frontmatter?.scope;
      if (scope && typeof scope === 'string' && scope.toLowerCase() !== typeLower) {
        continue;
      }
    }

    // Must be a dedicated 2x2 report file
    const isDedicated = baseLower.startsWith(`2x2 - ${typeLower}_`) || baseLower.startsWith('2x2');
    if (!isDedicated) continue;

    const isRisk = file.basename.includes('_Risk');

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
        isRisk,
      });
    } else {
      const singleDateMatch = file.basename.match(/(\d{4}-\d{2}-\d{2})/);
      const fromDate = singleDateMatch ? singleDateMatch[1] : '';
      const cleanBase = file.basename
        .replace(/^2x2\s*-\s*(Customer|Project)_[^\s-]+\s*-\s*/i, '')
        .replace(/^2x2\s*-\s*/i, '');
      reports.push({
        path: file.path,
        label: cleanBase || file.basename,
        dateRange: file.basename,
        fromDate,
        toDate: fromDate,
        isRisk,
      });
    }
  }

  // Sort newest to oldest
  reports.sort((a, b) => b.toDate.localeCompare(a.toDate) || b.fromDate.localeCompare(a.fromDate));
  return reports;
}

/**
 * Parses active and historical resolved support cases for an account from Reporting/Support Cases/customer/<Account>.md
 * with fallback to Reporting/Dashboards/Support Cases.md
 */
export async function parseAccountSupportCases(app: App, accountName: string): Promise<AccountSupportCases> {
  const normTarget = normalizeAccountName(accountName);

  // 1. Try dedicated customer extract first: Reporting/Support Cases/customer/<Account>.md
  const allFiles = typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
  const customerFile = allFiles.find(f => 
    f.path.startsWith('Reporting/Support Cases/customer/') &&
    accountsMatch(f.basename, normTarget)
  );

  if (customerFile instanceof TFile) {
    const content = await app.vault.cachedRead(customerFile);
    const openCases: SupportCaseItem[] = [];
    const resolvedCases: SupportCaseItem[] = [];
    const lines = content.split('\n');

    let section: 'active' | 'resolved' | null = null;
    for (const line of lines) {
      if (line.startsWith('## 🚨 Active Support Cases')) {
        section = 'active';
        continue;
      } else if (line.startsWith('## 📜')) {
        section = 'resolved';
        continue;
      } else if (line.startsWith('## ')) {
        section = null;
      }

      if (!section || !line.startsWith('|')) continue;
      const cols = line.split('|').map(c => c.trim()).slice(1, -1);
      if (cols.length < 5 || cols[0].toLowerCase().startsWith('case') || cols[0].startsWith('---') || cols[0].startsWith(':--')) continue;

      const caseCol = cols[0];
      const priCol = cols[1];
      const product = cols[2];

      const linkMatch = caseCol.match(/\[(\d+)\]\(([^)]+)\)/);
      const caseNumber = linkMatch ? linkMatch[1] : caseCol;
      const url = linkMatch ? linkMatch[2] : (caseNumber.match(/^\d+$/) ? `https://goto.corp.google.com/vgo/${caseNumber}` : '');

      let priority: 'P0' | 'P1' | 'P2' = 'P2';
      if (priCol.includes('P0')) priority = 'P0';
      else if (priCol.includes('P1')) priority = 'P1';

      if (section === 'active') {
        const status = cols[3];
        const owner = cols[4] || '';
        const age = cols[5] || '';
        openCases.push({
          caseNumber,
          url,
          priority,
          product,
          status,
          owner,
          age,
          filePath: customerFile.path,
          isResolved: false,
        });
      } else if (section === 'resolved') {
        const resolvedDate = cols[3];
        const owner = cols[4] || '';
        const notes = cols[5] || '';
        resolvedCases.push({
          caseNumber,
          url,
          priority,
          product,
          status: 'Resolved',
          owner,
          age: '',
          resolvedDate,
          notes,
          filePath: customerFile.path,
          isResolved: true,
        });
      }
    }

    return {
      openCases,
      resolvedCases,
      filePath: customerFile.path,
    };
  }

  // 2. Fallback to master dashboard: Reporting/Dashboards/Support Cases.md
  const casesFile = app.vault.getAbstractFileByPath('Reporting/Dashboards/Support Cases.md');
  if (!(casesFile instanceof TFile)) {
    return {
      openCases: [],
      resolvedCases: [],
    };
  }

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
      filePath: casesFile.path,
      isResolved: false,
    });
  }

  return {
    openCases: cases,
    resolvedCases: [],
    filePath: casesFile.path,
  };
}

/**
 * Parses opportunity pipeline and missing workload alerts from Reporting/Workloads/customer/<Account>.md
 * with fallback to Reporting/Dashboards/Workloads.md
 */
export async function parseAccountWorkloads(app: App, accountName: string): Promise<AccountPipeline | null> {
  const normTarget = normalizeAccountName(accountName);

  // 1. Try dedicated customer extract first: Reporting/Workloads/customer/<Account>.md
  const allFiles = typeof app.vault.getMarkdownFiles === 'function' ? app.vault.getMarkdownFiles() : [];
  const customerFile = allFiles.find(f => 
    f.path.startsWith('Reporting/Workloads/customer/') &&
    accountsMatch(f.basename, normTarget)
  );

  if (customerFile instanceof TFile) {
    const content = await app.vault.cachedRead(customerFile);
    const opps: WorkloadOpportunity[] = [];
    const lines = content.split('\n');

    let inActiveOpps = false;
    let inFixesSection = false;
    const fixMap = new Map<string, { fix: string; cmd: string }>();

    for (const line of lines) {
      if (line.startsWith('## 🛠️ Suggested Vector Fixes') || line.includes('Suggested Vector Fixes')) {
        inFixesSection = true;
        inActiveOpps = false;
        continue;
      } else if (line.startsWith('## 💼 Active Opportunities') || line.includes('Active Opportunities')) {
        inActiveOpps = true;
        inFixesSection = false;
        continue;
      } else if (line.startsWith('## ')) {
        inActiveOpps = false;
        inFixesSection = false;
      }

      if (inFixesSection && line.startsWith('|')) {
        const cols = line.split('|').map(c => c.trim()).slice(1, -1);
        if (cols.length >= 4 && cols[0].toLowerCase() !== 'opportunity' && !cols[0].startsWith('---') && !cols[0].startsWith(':--')) {
          const oppCol = cols[0];
          const linkMatch = oppCol.match(/\[([^\]]+)\]\(([^)]+)\)/);
          const oppName = (linkMatch ? linkMatch[1] : oppCol).toLowerCase();
          const fixText = cols[2];
          const cmdRaw = cols[3].replace(/^`|`$/g, '').trim();
          fixMap.set(oppName, { fix: fixText, cmd: cmdRaw });
        }
        continue;
      }

      if (!inActiveOpps || !line.startsWith('|')) continue;
      const cols = line.split('|').map(c => c.trim()).slice(1, -1);
      if (cols.length < 5 || cols[0].toLowerCase() === 'opportunity' || cols[0].startsWith('---') || cols[0].startsWith(':--')) continue;

      const oppCol = cols[0];
      const amountCol = cols[1];
      const stageCol = cols[2];
      const closeCol = cols[3];
      const statusCol = cols[5] || '';
      const suggestedFixCol = cols[6] || '';

      const linkMatch = oppCol.match(/\[([^\]]+)\]\(([^)]+)\)/);
      const oppName = linkMatch ? linkMatch[1] : oppCol;
      const oppUrl = linkMatch ? linkMatch[2] : '';
      const oppId = oppUrl.match(/\/Opportunity\/([A-Za-z0-9]+)/)?.[1];

      const isMissing = statusCol.includes('Missing Workload') || statusCol.includes('No WL');

      let amount = 0;
      const cleanNum = amountCol.replace(/[$,]/g, '').trim();
      if (cleanNum.endsWith('M')) {
        amount = parseFloat(cleanNum.slice(0, -1)) * 1_000_000;
      } else if (cleanNum.endsWith('K')) {
        amount = parseFloat(cleanNum.slice(0, -1)) * 1_000;
      } else {
        amount = parseFloat(cleanNum) || 0;
      }

      opps.push({
        id: oppId,
        name: oppName,
        url: oppUrl,
        amount,
        amountFormatted: amountCol,
        closeDate: closeCol.replace(/\*\*/g, ''),
        stage: stageCol,
        type: '',
        isMissingWorkload: isMissing,
        suggestedFix: suggestedFixCol && suggestedFixCol !== '-' ? suggestedFixCol : undefined,
      });
    }

    if (opps.length > 0) {
      // Reconcile fixMap commands and fallback defaults
      for (const opp of opps) {
        const fixInfo = fixMap.get(opp.name.toLowerCase());
        if (fixInfo) {
          if (!opp.suggestedFix) opp.suggestedFix = fixInfo.fix;
          if (!opp.fixCommand) opp.fixCommand = fixInfo.cmd;
        }
        if (!opp.suggestedFix && opp.isMissingWorkload) {
          opp.suggestedFix = `Create Workload (${opp.amountFormatted} ARR · Stage: 0-2)`;
        }
        if (!opp.fixCommand && opp.id && opp.isMissingWorkload) {
          opp.fixCommand = `python3 ~/.gemini/skills/ce-workload-advisor/scripts/workload_hygiene.py --id ${opp.id} --arr ${Math.round(opp.amount)} --stage "0-2: Tech Eval/Solution Dev" --production-date ${opp.closeDate} --next-steps "Initial technical evaluation and architecture kickoff"`;
        }
      }

      const totalPipeline = opps.reduce((sum, o) => sum + o.amount, 0);
      const totalPipelineFormatted = totalPipeline >= 1_000_000
        ? `$${(totalPipeline / 1_000_000).toFixed(2)}M`
        : `$${(totalPipeline / 1_000).toFixed(0)}K`;
      const missingWorkloadCount = opps.filter(o => o.isMissingWorkload).length;

      return {
        totalPipeline,
        totalPipelineFormatted,
        opps,
        missingWorkloadCount,
        filePath: customerFile.path,
      };
    }
  }

  // 2. Fallback to master dashboard: Reporting/Dashboards/Workloads.md
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
    const oppId = oppUrl.match(/\/Opportunity\/([A-Za-z0-9]+)/)?.[1];
    const existing = oppMap.get(key);
    if (existing) {
      if (isMissingWorkloadSection) {
        existing.isMissingWorkload = true;
        if (!existing.suggestedFix) {
          existing.suggestedFix = `Create Workload (${existing.amountFormatted} ARR · Stage: 0-2)`;
        }
        if (!existing.fixCommand && existing.id) {
          existing.fixCommand = `python3 ~/.gemini/skills/ce-workload-advisor/scripts/workload_hygiene.py --id ${existing.id} --arr ${Math.round(existing.amount)} --stage "0-2: Tech Eval/Solution Dev" --production-date ${existing.closeDate} --next-steps "Initial technical evaluation and architecture kickoff"`;
        }
      }
    } else {
      const suggestedFix = isMissingWorkloadSection ? `Create Workload (${amountCol} ARR · Stage: 0-2)` : undefined;
      const fixCommand = (isMissingWorkloadSection && oppId)
        ? `python3 ~/.gemini/skills/ce-workload-advisor/scripts/workload_hygiene.py --id ${oppId} --arr ${Math.round(amount)} --stage "0-2: Tech Eval/Solution Dev" --production-date ${closeCol.replace(/\*\*/g, '')} --next-steps "Initial technical evaluation and architecture kickoff"`
        : undefined;

      oppMap.set(key, {
        id: oppId,
        name: oppName,
        url: oppUrl,
        amount,
        amountFormatted: amountCol,
        closeDate: closeCol.replace(/\*\*/g, ''),
        stage: stageCol,
        type: typeCol,
        isMissingWorkload: isMissingWorkloadSection,
        suggestedFix,
        fixCommand,
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
    filePath: workloadsFile.path,
  };
}

export interface EntityShelves {
  nextStep: string | null;
  docs: Array<{ title: string; url: string; tldr?: string }>;
}

/**
 * Extracts authoritative ## Next Step and canonical ## Docs from an entity note.
 */
export async function extractEntityNoteShelves(
  app: App,
  notePath: string,
): Promise<EntityShelves> {
  const result: EntityShelves = { nextStep: null, docs: [] };
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(notePath))) return result;

  try {
    const content = await adapter.read(notePath);

    // Extract Next Step
    const nextStepMatch = content.match(/##\s+Next Step[\r\n]+([\s\S]*?)(?=\n#{1,6}\s+|\Z)/i);
    if (nextStepMatch && nextStepMatch[1].trim()) {
      result.nextStep = nextStepMatch[1].trim();
    }

    // Extract Docs
    const docsMatch = content.match(/##\s+Docs[\r\n]+([\s\S]*?)(?=\n#{1,6}\s+|\Z)/i);
    if (docsMatch && docsMatch[1].trim()) {
      const lines = docsMatch[1].trim().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('-')) continue;
        const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(trimmed);
        const wikiMatch = /\[\[([^\]]+)\]\]/.exec(trimmed);
        const parts = trimmed.split(/—| - /);
        const tldr = parts.length > 1 ? parts.slice(1).join('—').trim() : undefined;

        if (linkMatch) {
          result.docs.push({ title: linkMatch[1], url: linkMatch[2], tldr });
        } else if (wikiMatch) {
          result.docs.push({ title: wikiMatch[1], url: wikiMatch[1], tldr });
        }
      }
    }
  } catch (err) {
    console.warn(`Cockpit: Error extracting shelves from ${notePath}:`, err);
  }

  return result;
}
