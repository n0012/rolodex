import { App, requestUrl } from 'obsidian';
import { isOverdue, openTasks, sortTasks } from './select';
import { todayIso, tryDeterministicCommand } from './parse';
import { DEFAULT_PROMPT, PROMPT_DEFINITIONS } from './types';
import type { AiCommandResult, EntityRecord, EntityTask, ReportType } from './types';
import type { Window } from './select';
import type { TaskUpdateProposal } from './actions';

export function getPromptsDir(app: App, pluginId = 'rolodex'): string {
  return `${app.vault.configDir}/plugins/${pluginId}/prompts`;
}

/**
 * Ensures that the prompts directory and default prompt markdown files exist on disk.
 */
export async function ensurePromptFiles(app: App, pluginId = 'rolodex'): Promise<void> {
  const dir = getPromptsDir(app, pluginId);
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }
  for (const def of Object.values(PROMPT_DEFINITIONS)) {
    const p = `${dir}/${def.filename}`;
    if (!(await adapter.exists(p))) {
      await adapter.write(p, def.defaultText);
    }
  }
}

/**
 * Loads a prompt from disk (allowing user edits) or falls back to built-in default.
 */
export async function loadPrompt(
  app: App,
  reportType: ReportType,
  variables: Record<string, string> = {},
  pluginId = 'rolodex',
): Promise<string> {
  const def = PROMPT_DEFINITIONS[reportType];
  let text = def ? def.defaultText : DEFAULT_PROMPT;
  const p = `${getPromptsDir(app, pluginId)}/${def?.filename || 'briefing.md'}`;

  try {
    if (await app.vault.adapter.exists(p)) {
      const diskText = await app.vault.adapter.read(p);
      if (diskText.trim()) text = diskText;
    }
  } catch (err) {
    console.warn(`Rolodex: unable to read prompt file ${p}`, err);
  }

  // Interpolate template variables: {EntityName}, {StartDate}, {EndDate}
  for (const [k, v] of Object.entries(variables)) {
    const re = new RegExp(`\\{${k}\\}`, 'g');
    text = text.replace(re, v);
  }

  return text;
}

export async function summarize(
  apiKey: string,
  model: string,
  prompt: string,
  context: string,
): Promise<string> {
  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({ contents: [{ parts: [{ text: `${prompt}\n\n---\n\n${context}` }] }] }),
    throw: false,
  });

  if (resp.status >= 400) {
    const detail = (resp.json as { error?: { message?: string } })?.error?.message;
    throw new Error(detail ?? `Gemini returned ${resp.status}`);
  }

  const data = resp.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('');
  if (!text) {
    const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'empty response';
    throw new Error(`No summary returned (${why})`);
  }
  return text;
}

/**
 * Executes a natural language command via Gemini or deterministic parser.
 */
export async function executeAiCommand(
  apiKey: string,
  model: string,
  command: string,
  currentEntity: EntityRecord | null,
  allEntities: Map<string, EntityRecord>,
): Promise<AiCommandResult> {
  // Try instant deterministic parsing first
  const fast = tryDeterministicCommand(command, allEntities, currentEntity);
  if (fast) return fast;

  if (!apiKey) {
    throw new Error('Please configure a Gemini API key in Rolodex settings for natural language AI actions.');
  }

  // Build context for AI execution
  const today = todayIso();
  let contextBrief = `Today's Date: ${today}\n`;
  if (currentEntity) {
    contextBrief += `Active Entity: ${currentEntity.type}/${currentEntity.name}\n`;
    contextBrief += `Open Tasks:\n${currentEntity.tasks.filter(t => t.status === 'open').map(t => `- [line ${t.line} in ${t.path}] ${t.text} (${t.due ? `due ${t.due}` : ''})`).join('\n')}\n`;
  }

  const systemInstruction = `You are the executive AI assistant inside an Obsidian CRM plugin for a Google Cloud Customer Engineer.
The user gave this command: "${command}"

Analyze the intent and return ONLY a valid JSON object matching one of these forms:

1. If the user wants to reclassify an entity tag (e.g. from Project to Conference):
{
  "type": "reclassify",
  "title": "Reclassify description",
  "reclassify": {
    "oldType": "Project",
    "oldName": "EntityName",
    "newType": "Conference"
  }
}

2. If the user wants to clean up, cancel, or mark tasks done:
{
  "type": "task_updates",
  "title": "Task cleanup proposal description",
  "taskUpdates": [
    {
      "path": "path/to/file.md",
      "line": 123,
      "currentText": "exact line text",
      "newStatus": "cancelled", // or "done"
      "reason": "older than 30d"
    }
  ]
}

3. If the user wants to draft an email, brief, or note:
{
  "type": "draft",
  "title": "Subject or Heading",
  "draft": {
    "heading": "Briefing / Subject",
    "content": "Full markdown content"
  }
}

4. If general query or clarification:
{
  "type": "message",
  "title": "AI Response",
  "message": "Answer or clarification"
}

Return ONLY raw JSON, no markdown codeblocks, no formatting.`;

  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemInstruction}\n\nContext:\n${contextBrief}` }] }],
    }),
    throw: false,
  });

  if (resp.status >= 400) {
    const detail = (resp.json as { error?: { message?: string } })?.error?.message;
    throw new Error(detail ?? `Gemini returned ${resp.status}`);
  }

  const data = resp.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
  if (!rawText) throw new Error('No response from AI.');

  const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleanJson) as AiCommandResult;
  } catch (err) {
    return {
      type: 'draft',
      title: 'AI Output',
      draft: { content: rawText },
    };
  }
}

export function buildContext(
  e: EntityRecord,
  w: Window,
  all: Map<string, EntityRecord>,
  charBudget = 60_000,
): string {
  const nameOf = (key: string) => {
    if (key.startsWith('link/')) return `[[${key.slice(5)}]]`;
    const other = all.get(key);
    return other ? `${other.type}/${other.name}` : key;
  };
  const today = todayIso();
  const parts: string[] = [];

  parts.push(`Entity: ${e.type} / ${e.name}`);
  if (e.subs.size) parts.push(`Sub-areas: ${[...e.subs].join(', ')}`);
  parts.push(`Window shown: ${w.from} to ${w.to} (today is ${today})`);
  parts.push(`First seen ${e.firstSeen || 'unknown'}, last seen ${e.lastSeen || 'unknown'}, tagged in ${e.noteCount} notes.`);

  // Filter out same-type connections
  const related = [...e.related.entries()]
    .filter(([k]) => {
      const other = all.get(k);
      return !other || other.type.toLowerCase() !== e.type.toLowerCase();
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (related.length) {
    parts.push(`Connected stakeholders, partners & projects: ${related.map(([k, n]) => `${nameOf(k)} (${n})`).join(', ')}`);
  }

  const open = sortTasks(openTasks(e), today);
  if (open.length) {
    parts.push('\n## Open tasks (all time, not just the window)');
    for (const t of open) {
      const bits = [t.due ? `due ${t.due}` : '', isOverdue(t, today) ? 'OVERDUE' : '', t.priority ? `p${t.priority}` : '']
        .filter(Boolean).join(', ');
      parts.push(`- [ ] ${t.text}${bits ? ` (${bits})` : ''} — noted ${t.noteDate}`);
    }
  }

  const recentlyDone = e.tasks
    .filter(t => t.status === 'done' && (t.done ?? t.noteDate) >= w.from)
    .sort((a, b) => (b.done ?? b.noteDate).localeCompare(a.done ?? a.noteDate));
  if (recentlyDone.length) {
    parts.push('\n## Completed in the window');
    for (const t of recentlyDone.slice(0, 40)) {
      parts.push(`- [x] ${t.text} (${t.done ?? t.noteDate})`);
    }
  }

  parts.push('\n## Notes, newest first');
  let used = parts.join('\n').length;

  for (const a of e.activities) {
    if (a.date && a.date < w.from) continue;
    const block = [
      `\n### ${a.date || 'Undated'} — ${a.file}${a.heading ? ` > ${a.heading}` : ''}`,
      a.text,
    ].join('\n');
    if (used + block.length > charBudget) {
      parts.push('\n… (older notes in window omitted for length)');
      break;
    }
    parts.push(block);
    used += block.length;
  }

  return parts.join('\n');
}

/**
 * Builds rich portfolio context across all active entities in a time window
 * for Weekly and Monthly 2x2 synthesis.
 */
export function buildPortfolioContext(
  w: Window,
  all: Map<string, EntityRecord>,
  charBudget = 80_000,
): string {
  const today = todayIso();
  const parts: string[] = [];

  parts.push(`Portfolio Overview — Window: ${w.from} to ${w.to} (Today is ${today})`);

  // Active entities in this window
  const activeEntities = [...all.values()]
    .filter((e) => e.activities.some((a) => !a.date || a.date >= w.from) || e.tasks.some((t) => t.status === 'open'))
    .sort((a, b) => b.activities.length - a.activities.length);

  parts.push(`Total Active Accounts & Projects: ${activeEntities.length}`);

  // Summary of completions across portfolio
  const allRecentlyDone = activeEntities.flatMap((e) =>
    e.tasks
      .filter((t) => t.status === 'done' && (t.done ?? t.noteDate) >= w.from)
      .map((t) => ({ entity: e.name, type: e.type, text: t.text, date: t.done ?? t.noteDate }))
  ).sort((a, b) => b.date.localeCompare(a.date));

  if (allRecentlyDone.length) {
    parts.push(`\n## Completed Deliverables & Tasks (${allRecentlyDone.length})`);
    for (const t of allRecentlyDone.slice(0, 50)) {
      parts.push(`- [x] [${t.type}/${t.entity}] ${t.text} (${t.date})`);
    }
  }

  // Active open blockers (#waiting / overdue)
  const openBlockers = activeEntities.flatMap((e) =>
    openTasks(e)
      .filter((t) => t.text.includes('#waiting') || isOverdue(t, today))
      .map((t) => ({ entity: e.name, type: e.type, text: t.text, due: t.due }))
  );
  if (openBlockers.length) {
    parts.push(`\n## Active Blockers & Overdue Priorities (${openBlockers.length})`);
    for (const t of openBlockers.slice(0, 30)) {
      parts.push(`- [ ] [${t.type}/${t.entity}] ${t.text}${t.due ? ` (due ${t.due})` : ''}`);
    }
  }

  // Per-entity activities in the window
  parts.push('\n## Notes & Meeting Highlights by Entity (Newest First)');
  let used = parts.join('\n').length;

  for (const e of activeEntities) {
    const recentActs = e.activities.filter((a) => !a.date || a.date >= w.from);
    if (!recentActs.length) continue;

    parts.push(`\n### ${e.type}: ${e.name} (${recentActs.length} notes)`);
    for (const a of recentActs) {
      const block = `[${a.date || 'Undated'}] ${a.heading ? `${a.heading}: ` : ''}${a.text}`;
      if (used + block.length > charBudget) {
        parts.push('\n… (additional historical notes omitted for length)');
        return parts.join('\n');
      }
      parts.push(block);
      used += block.length;
    }
  }

  return parts.join('\n');
}
