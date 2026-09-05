/** Gemini summaries. Uses Obsidian's requestUrl so this works on mobile. */

import { requestUrl } from 'obsidian';
import { isOverdue, openTasks, sortTasks } from './select';
import { todayIso } from './parse';
import type { EntityRecord } from './types';
import type { Window } from './select';

/**
 * The plugin this replaces used Node's `https` module, which does not exist on
 * iOS or Android — so AI summaries threw on the phone while the manifest
 * advertised isDesktopOnly: false. requestUrl is the cross-platform path and
 * also sidesteps CORS.
 */
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
      // Header, not ?key= in the query string: a URL travels into logs and
      // error messages far more readily than a header does.
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
 * The note text handed to the model. Budgeted rather than truncated at a fixed
 * count: the old version always sent exactly 20 sections, which overflowed on
 * chatty accounts and wasted the window on quiet ones.
 */
export function buildContext(
  e: EntityRecord,
  w: Window,
  all: Map<string, EntityRecord>,
  charBudget = 60_000,
): string {
  const nameOf = (key: string) => {
    const other = all.get(key);
    return other ? `${other.type}/${other.name}` : key;
  };
  const today = todayIso();
  const parts: string[] = [];

  parts.push(`Entity: ${e.type} / ${e.name}`);
  if (e.subs.size) parts.push(`Sub-areas: ${[...e.subs].join(', ')}`);
  parts.push(`Window shown: ${w.from} to ${w.to} (today is ${today})`);
  parts.push(`First seen ${e.firstSeen || 'unknown'}, last seen ${e.lastSeen || 'unknown'}, tagged in ${e.noteCount} notes.`);

  const related = [...e.related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (related.length) {
    parts.push(`Frequently co-occurs with: ${related.map(([k, n]) => `${nameOf(k)} (${n})`).join(', ')}`);
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
  let included = 0;
  for (const a of e.activities.filter(x => !x.date || (x.date >= w.from && x.date <= w.to))) {
    const block = `\n### ${a.date} — ${a.heading}\n${a.text}`;
    if (used + block.length > charBudget) break;
    parts.push(block);
    used += block.length;
    included++;
  }
  if (!included) parts.push('_No notes in this window._');

  return parts.join('\n');
}
