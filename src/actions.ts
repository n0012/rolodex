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
          if (u.line >= 0 && u.line < lines.length) {
            const line = lines[u.line];
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

              lines[u.line] = `${indent}${marker}${rest}${body}`;
              totalUpdated++;
            }
          }
        }
        return lines.join('\n');
      });
    } catch (err) {
      console.error(`Rolodex: Error updating tasks in ${path}:`, err);
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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
