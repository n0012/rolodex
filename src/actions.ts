/**
 * Safe, atomic vault mutations for Rolodex.
 *
 * All operations use Obsidian's `app.vault.process()` to safely modify files
 * without race conditions or data loss.
 */

import { App, TFile } from 'obsidian';

export interface TagReclassifyResult {
  path: string;
  count: number;
}

export interface TaskUpdateProposal {
  path: string;
  line: number;
  currentText: string;
  newStatus: 'done' | 'cancelled' | 'open';
  reason?: string;
}

/**
 * Reclassifies a tag across all markdown files in the vault.
 * e.g., renames `#Project/IMTS` to `#Conference/IMTS`.
 */
export async function reclassifyTagInVault(
  app: App,
  oldType: string,
  oldName: string,
  newType: string,
  newName?: string,
): Promise<TagReclassifyResult[]> {
  const targetName = newName || oldName;
  const oldTagPattern = new RegExp(
    `#${escapeRegExp(oldType)}/${escapeRegExp(oldName)}(?=[\\s.,;:!?)\\]}]|$)`,
    'gi',
  );
  const replacement = `#${newType}/${targetName}`;

  const results: TagReclassifyResult[] = [];
  const files = app.vault.getMarkdownFiles();

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      if (!oldTagPattern.test(content)) continue;

      let fileChangeCount = 0;
      await app.vault.process(file, (data) => {
        const lines = data.split('\n');
        const updatedLines = lines.map((line) => {
          if (oldTagPattern.test(line)) {
            const matches = line.match(oldTagPattern);
            fileChangeCount += matches ? matches.length : 1;
            return line.replace(oldTagPattern, replacement);
          }
          return line;
        });
        return updatedLines.join('\n');
      });

      if (fileChangeCount > 0) {
        results.push({ path: file.path, count: fileChangeCount });
      }
    } catch (err) {
      console.error(`Rolodex: Error reclassifying tag in ${file.path}:`, err);
    }
  }

  return results;
}

/**
 * Applies a list of task updates (done, cancelled, open) to their respective files.
 */
export async function applyTaskUpdates(
  app: App,
  updates: TaskUpdateProposal[],
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const byPath = new Map<string, TaskUpdateProposal[]>();
  for (const u of updates) {
    const list = byPath.get(u.path) ?? [];
    list.push(u);
    byPath.set(u.path, list);
  }

  let totalUpdated = 0;

  for (const [path, fileUpdates] of byPath.entries()) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;

    try {
      await app.vault.process(file, (data) => {
        const lines = data.split('\n');
        for (const u of fileUpdates) {
          let lineIdx = u.line;
          // Verify line contains expected text or search for it if line numbers shifted
          if (u.currentText) {
            const currentAtOffset = (lineIdx >= 0 && lineIdx < lines.length) ? lines[lineIdx] : '';
            if (!currentAtOffset.includes(u.currentText)) {
              const found = lines.findIndex(l => l.includes(u.currentText));
              if (found >= 0) lineIdx = found;
            }
          }

          if (lineIdx >= 0 && lineIdx < lines.length) {
            const line = lines[lineIdx];
            const taskMatch = /^(\s*[-*+]\s+\[)(.)(\]\s+)(.*)$/.exec(line);
            if (taskMatch) {
              const indent = taskMatch[1];
              const rest = taskMatch[3];
              let body = taskMatch[4];

              let marker = ' ';
              if (u.newStatus === 'done') {
                marker = 'x';
                if (!body.includes('✅')) body += ` ✅ ${today}`;
              } else if (u.newStatus === 'cancelled') {
                marker = '-';
                if (!body.includes('❌')) body += ` ❌ ${today}`;
              }

              lines[lineIdx] = `${indent}${marker}${rest}${body}`;
              totalUpdated++;
            }
          }
        }
        return lines.join('\n');
      });
    } catch (err) {
      console.error(`Cockpit: Error updating tasks in ${path}:`, err);
    }
  }

  return totalUpdated;
}

/**
 * Appends a task to a note, optionally under a specific heading.
 */
export async function appendTaskToNote(
  app: App,
  path: string,
  taskLine: string,
  targetHeading = 'Tasks',
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;

  const formattedTask = taskLine.trim().startsWith('- [')
    ? taskLine.trim()
    : `- [ ] ${taskLine.trim()}`;

  try {
    await app.vault.process(file, (data) => {
      const lines = data.split('\n');
      let headingIndex = -1;

      if (targetHeading) {
        for (let i = 0; i < lines.length; i++) {
          const m = /^#{1,6}\s+(.*)$/.exec(lines[i]);
          if (m && m[1].toLowerCase().includes(targetHeading.toLowerCase())) {
            headingIndex = i;
            break;
          }
        }
      }

      if (headingIndex >= 0) {
        lines.splice(headingIndex + 1, 0, formattedTask);
      } else {
        if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
          lines.push('');
        }
        lines.push(`## ${targetHeading}`, formattedTask);
      }

      return lines.join('\n');
    });
    return true;
  } catch (err) {
    console.error(`Rolodex: Error appending task to ${path}:`, err);
    return false;
  }
}

/**
 * Appends an entire section (e.g., Executive Briefing) to a note.
 */
export async function appendSectionToNote(
  app: App,
  path: string,
  heading: string,
  content: string,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return false;

  try {
    await app.vault.process(file, (data) => {
      const trimmed = data.trimEnd();
      const section = `\n\n## ${heading}\n\n${content.trim()}\n`;
      return `${trimmed}${section}`;
    });
    return true;
  } catch (err) {
    console.error(`Rolodex: Error appending section to ${path}:`, err);
    return false;
  }
}

/**
 * Saves a 2x2 report to Reporting/2x2/<scope>/<filename>.md.
 * Overwrites if exists, or creates parent folders and new file.
 */
export async function saveTwoByTwoReport(
  app: App,
  scope: 'customer' | 'project' | 'weekly' | 'monthly',
  nameOrRange: string,
  content: string,
  from?: string,
  to?: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  let folder = `Reporting/2x2/${scope}`;
  let filename = '';

  if (scope === 'customer') {
    const safeName = nameOrRange.replace(/[\\/:*?"<>|]/g, '');
    const entityFolder = safeName.replace(/_Risk$/, '');
    folder = `Reporting/2x2/${scope}/${entityFolder}`;
    const dateRange = (from && to) ? `${from}_to_${to}` : today;
    filename = `2x2 - Customer_${safeName} - ${dateRange}.md`;
  } else if (scope === 'project') {
    const safeName = nameOrRange.replace(/[\\/:*?"<>|]/g, '');
    const entityFolder = safeName.replace(/_Risk$/, '');
    folder = `Reporting/2x2/${scope}/${entityFolder}`;
    const dateRange = (from && to) ? `${from}_to_${to}` : today;
    filename = `2x2 - Project_${safeName} - ${dateRange}.md`;
  } else if (scope === 'weekly') {
    const year = (to || today).slice(0, 4);
    const monthFolder = (to || today).slice(0, 7);
    folder = `Reporting/2x2/${scope}/${year}/${monthFolder}`;
    filename = `weekly_2x2_${from || today}_to_${to || today}.md`;
  } else if (scope === 'monthly') {
    const year = (to || today).slice(0, 4);
    const month = (to || today).slice(0, 7);
    folder = `Reporting/2x2/${scope}/${year}`;
    filename = `monthly_2x2_${month}.md`;
  }

  const targetPath = `${folder}/${filename}`;
  const adapter = app.vault.adapter;

  // Ensure folders exist
  const parts = folder.split('/');
  let current = '';
  for (const p of parts) {
    current = current ? `${current}/${p}` : p;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }

  // Prepend clean frontmatter if not present
  let fileContent = content.trim();
  if (!fileContent.startsWith('---')) {
    const timeStr = new Date().toTimeString().slice(0, 5);
    const frontmatter = [
      '---',
      `created: ${today}T${timeStr}`,
      `type: 2x2`,
      `scope: ${scope}`,
      `tags:`,
      `  - 2x2`,
      `  - 2x2/${scope}`,
      '---',
      '',
    ].join('\n');
    fileContent = `${frontmatter}\n${fileContent}\n`;
  } else {
    fileContent = `${fileContent}\n`;
  }

  const existing = app.vault.getAbstractFileByPath(targetPath);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, fileContent);
  } else {
    await app.vault.create(targetPath, fileContent);
  }

  return targetPath;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates or opens a dedicated Contact note for a stakeholder,
 * linking them to their customer/company in the Obsidian graph.
 */
export async function createOrOpenContactNote(
  app: App,
  name: string,
  company?: string,
  email?: string
): Promise<string> {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '').trim();
  const folder = 'Wiki/People';
  const targetPath = `${folder}/${safeName}.md`;
  const adapter = app.vault.adapter;

  // Check if note already exists anywhere in vault
  const existingFile = app.metadataCache.getFirstLinkpathDest(safeName, '');
  if (existingFile instanceof TFile) {
    return existingFile.path;
  }

  // Ensure directory exists
  const parts = folder.split('/');
  let current = '';
  for (const p of parts) {
    current = current ? `${current}/${p}` : p;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }

  const tags = ['Person'];
  if (company) tags.push(`Contact/${company.replace(/\s+/g, '_')}`);

  const frontmatter = [
    '---',
    `type: Contact`,
    `name: ${safeName}`,
    company ? `company: "[[${company}]]"` : null,
    email ? `email: ${email}` : null,
    `tags:`,
    ...tags.map((t) => `  - ${t}`),
    '---',
    '',
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  const body = [
    `# ${safeName}`,
    company ? `**Company:** [[${company}]]` : '',
    email ? `**Email:** \`${email}\`` : '',
    '',
    `## 📋 Open Tasks & Deliverables`,
    '```tasks',
    'not done',
    `description includes ${safeName}`,
    '```',
    '',
    `## 🤝 Recent Interactions`,
    '```dataview',
    'TABLE WITHOUT ID',
    '  file.link as "Meeting Note",',
    '  file.day as "Date"',
    'FROM "~Daily"',
    `WHERE contains(file.text, "${safeName}")`,
    'SORT file.day DESC',
    'LIMIT 10',
    '```',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const fileContent = `${frontmatter}\n${body}\n`;
  await app.vault.create(targetPath, fileContent);
  return targetPath;
}

/**
 * Builds a direct Gmail web draft compose URL.
 */
export function buildGmailDraftUrl(to: string, subject: string, body: string): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Builds a direct Google Calendar web event creation template URL.
 */
export function buildGoogleCalendarUrl(
  title: string,
  attendees: string,
  agenda: string,
  durationMinutes = 30,
): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const formatIsoUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dates = `${formatIsoUtc(start)}/${formatIsoUtc(end)}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(agenda)}&add=${encodeURIComponent(attendees)}`;
}

/**
 * Gets or creates today's daily note path: ~Daily/YYYY-MM-DD.md
 */
export function getTodayDailyNotePath(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `~Daily/${today}.md`;
}

/**
 * Appends a task to today's Daily note under ## 📥 Inbox (Tasks-plugin syntax).
 */
export async function appendTaskToDailyInbox(
  app: App,
  taskText: string,
  priority?: string,
  due?: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const todayPath = `~Daily/${today}.md`;
  let file = app.vault.getAbstractFileByPath(todayPath);

  if (!(file instanceof TFile)) {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists('~Daily'))) {
      await adapter.mkdir('~Daily');
    }
    await app.vault.create(todayPath, `# ${today}\n\n## 📥 Inbox\n\n`);
    file = app.vault.getAbstractFileByPath(todayPath);
  }

  const cleanText = taskText.trim().replace(/^-\s*\[\s*\]\s*/, '');
  const priPart = priority ? ` ${priority}` : '';
  const duePart = due ? ` 📅 ${due}` : '';
  const taskLine = `- [ ] ${cleanText} ➕ ${today}${duePart}${priPart}`;

  await appendTaskToNote(app, todayPath, taskLine, '📥 Inbox');
  void logCockpitAction(app, cleanText.split('#')[0].trim(), 'Task Inbox', cleanText, todayPath);
  return todayPath;
}

/**
 * Updates or sets the authoritative ## Next Step section on an entity note.
 */
export async function updateEntityNextStep(
  app: App,
  entityPath: string,
  nextStepText: string,
): Promise<boolean> {
  const file = app.vault.getAbstractFileByPath(entityPath);
  if (!(file instanceof TFile)) return false;

  try {
    await app.vault.process(file, (data) => {
      const trimmed = nextStepText.trim();
      const lines = data.split('\n');
      let start = -1;
      let end = lines.length;

      for (let i = 0; i < lines.length; i++) {
        if (/^##\s+Next Step\b/i.test(lines[i])) {
          start = i;
          for (let j = i + 1; j < lines.length; j++) {
            if (/^#{1,6}\s+/.test(lines[j])) {
              end = j;
              break;
            }
          }
          break;
        }
      }

      const replacementLines = ['## Next Step', trimmed, ''];
      if (start >= 0) {
        lines.splice(start, end - start, ...replacementLines);
        return lines.join('\n');
      } else {
        return `${data.trimEnd()}\n\n## Next Step\n${trimmed}\n`;
      }
    });
    void logCockpitAction(app, entityPath.split('/').pop()?.replace(/\.md$/, '') || '', 'Next Step', nextStepText, entityPath);
    return true;
  } catch (err) {
    console.error(`Error updating next step in ${entityPath}:`, err);
    return false;
  }
}

/**
 * Saves a structured Chief of Staff Q&A answer to ~Review/Answers/YYYY-MM-DD-<slug>.md.
 */
export async function saveAnswerNote(
  app: App,
  entityName: string,
  query: string,
  content: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const slug = query
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'answer';
  const folder = '~Review/Answers';
  const filename = `${today}-${entityName ? entityName.toLowerCase() + '-' : ''}${slug}.md`;
  const path = `${folder}/${filename}`;

  const adapter = app.vault.adapter;
  if (!(await adapter.exists(folder))) {
    const parts = folder.split('/');
    let cur = '';
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await adapter.exists(cur))) await adapter.mkdir(cur);
    }
  }

  const frontmatter = `---
type: answer
entity: "${entityName}"
query: "${query.replace(/"/g, '\\"')}"
created: ${today}
---

`;
  await adapter.write(path, frontmatter + content.trim() + '\n');
  void logCockpitAction(app, entityName, 'Saved Briefing', query, path);
  return path;
}

/**
 * Records an executed Cockpit action to the append-only audit trail: ~Review/Cockpit Log.md
 */
export async function logCockpitAction(
  app: App,
  entityName: string,
  actionType: string,
  summary: string,
  targetPath?: string,
): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const logDir = '~Review';
    const logPath = `${logDir}/Cockpit Log.md`;
    const adapter = app.vault.adapter;

    if (!(await adapter.exists(logDir))) {
      await adapter.mkdir(logDir);
    }

    const logLine = `- **${today} ${nowTime}** [${actionType}] \`[[${entityName || 'General'}]]\`: ${summary}${targetPath ? ` ➔ \`${targetPath}\`` : ''}\n`;

    let file = app.vault.getAbstractFileByPath(logPath);
    if (file instanceof TFile) {
      await app.vault.process(file, data => data + logLine);
    } else {
      const initialContent = `# 🎛️ Cockpit Action Audit Log\n\nAppend-only record of proactive actions, email drafts, task creations, and Next Step updates dispatched from Cockpit.\n\n## Actions\n\n${logLine}`;
      await adapter.write(logPath, initialContent);
    }
  } catch (err) {
    console.error('Cockpit: Error writing to Cockpit Log:', err);
  }
}

