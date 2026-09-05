/** Line-level parsing: entity tags, task status, Tasks-plugin metadata. */

import type { TaskMeta, TaskStatus } from './types';

// Obsidian tag charset: letters, digits, _, -, / . A period is NOT part of a
// tag, so "#Customer/Suki." is the tag Customer/Suki followed by punctuation —
// matching that here is what keeps a stray full stop from minting a second,
// near-identical entity.
const TAG_RE = /#([A-Za-z][A-Za-z0-9_-]*)((?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+)/g;

export interface ParsedTag {
  type: string;
  name: string;
  /** Third level and deeper: #Customer/Pharma/ISV -> ['ISV']. */
  subs: string[];
}

/**
 * The identity of an entity, case-folded. Obsidian's own tag handling is
 * case-insensitive, so #customer/amgen and #Customer/Amgen are one tag there
 * and must be one entity here. This vault has both, plus a stray #Customers.
 * Never render a key — look the record up and use its display name.
 */
export function tagKey(type: string, name: string): string {
  return `${type.toLowerCase()}/${name.toLowerCase()}`;
}

/**
 * Every entity tag on a line. Deliberately returns whole-segment matches only:
 * the old plugin tested `line.includes('#Customer/GE')`, which also fired on
 * #Customer/GEHC. This vault has six such colliding pairs.
 */
export function parseTags(text: string): ParsedTag[] {
  const out: ParsedTag[] = [];
  const seen = new Set<string>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    const type = m[1];
    const parts = m[2].split('/').filter(Boolean);
    const name = parts[0];
    const dedupe = `${tagKey(type, name)}/${parts.slice(1).join('/').toLowerCase()}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ type, name, subs: parts.slice(1) });
  }
  return out;
}

const TASK_RE = /^(\s*)[-*+]\s+\[([ xX\-/])\]\s+(.*)$/;

export interface ParsedTask {
  indent: number;
  status: TaskStatus;
  body: string;
}

export function parseTaskLine(line: string): ParsedTask | null {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const marker = m[2].toLowerCase();
  // '-' is the Tasks plugin's cancelled marker; '/' is "in progress", which is
  // still open work and is counted as such.
  const status: TaskStatus = marker === 'x' ? 'done' : marker === '-' ? 'cancelled' : 'open';
  return { indent: m[1].length, status, body: m[3] };
}

const DATE = '(\\d{4}-\\d{2}-\\d{2})';
const FIELDS: Array<[keyof TaskMeta, RegExp]> = [
  ['due', new RegExp(`📅\\s*${DATE}`)],
  ['scheduled', new RegExp(`⏳\\s*${DATE}`)],
  ['start', new RegExp(`🛫\\s*${DATE}`)],
  ['created', new RegExp(`➕\\s*${DATE}`)],
  ['done', new RegExp(`✅\\s*${DATE}`)],
  ['cancelled', new RegExp(`❌\\s*${DATE}`)],
];

const PRIORITY: Array<[string, number]> = [
  ['🔺', 1], ['⏫', 2], ['🔼', 3], ['🔽', 4], ['⏬', 5],
];

/** Pull Tasks-plugin metadata off a task body and return it stripped for display. */
export function parseTaskMeta(body: string): { meta: TaskMeta; text: string } {
  const meta: TaskMeta = {};
  let text = body;

  for (const [field, re] of FIELDS) {
    const m = re.exec(text);
    if (m) {
      (meta[field] as string) = m[1];
      text = text.replace(m[0], ' ');
    }
  }

  const rec = /🔁\s*([^📅⏳🛫➕✅❌🔺⏫🔼🔽⏬#]+)/.exec(text);
  if (rec) {
    meta.recurrence = rec[1].trim();
    text = text.replace(rec[0], ' ');
  }

  for (const [emoji, level] of PRIORITY) {
    if (text.includes(emoji)) {
      meta.priority = level;
      text = text.split(emoji).join(' ');
      break;
    }
  }

  // Tags are shown as separate chips, so drop them from the sentence. Block
  // references and trailing whitespace go too.
  text = text
    .replace(TAG_RE, ' ')
    .replace(/\^[A-Za-z0-9-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { meta, text };
}

const ISO = /(\d{4}-\d{2}-\d{2})/;

/**
 * The date a note speaks for. Daily notes carry it in the filename, which is
 * the only source that survives the file being edited later — mtime would
 * re-date two years of history the moment a bulk rewrite touched it.
 */
export function noteDate(basename: string, frontmatterCreated?: string, fallbackMs?: number): string {
  const fromName = ISO.exec(basename);
  if (fromName) return fromName[1];
  if (frontmatterCreated) {
    const fromFm = ISO.exec(frontmatterCreated);
    if (fromFm) return fromFm[1];
  }
  if (fallbackMs) return new Date(fallbackMs).toISOString().slice(0, 10);
  return '';
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
