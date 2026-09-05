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
 * case-insensitive, so #customer/acmecorp and #Customer/AcmeCorp are one tag there
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

import type { AiCommandResult, EntityRecord } from './types';

export function tryDeterministicCommand(
  cmd: string,
  entities: Map<string, EntityRecord>,
  contextEntity?: EntityRecord | null,
): AiCommandResult | null {
  const trimmed = cmd.trim().replace(/[.!]+$/, '');

  const formatTypeName = (t: string) => {
    const clean = t.replace(/^#/, '').trim();
    if (!clean) return 'Project';
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  };

  const resolveEntity = (nameCandidate?: string): { name: string; type: string } | null => {
    if (nameCandidate) {
      const cleanName = nameCandidate.replace(/^#/, '').trim();
      for (const e of entities.values()) {
        if (e.name.toLowerCase() === cleanName.toLowerCase()) {
          return { name: e.name, type: e.type };
        }
      }
      return { name: cleanName, type: 'Project' };
    }
    if (contextEntity) {
      return { name: contextEntity.name, type: contextEntity.type };
    }
    return null;
  };

  // Pattern 1: "tag is wrong" / "wrong tag"
  // e.g. "imts project tag is wrong, it's a conference"
  //      "imts tag is wrong, it's a conference"
  //      "tag is wrong, it's a conference"
  //      "tag is wrong, change to conference"
  //      "tag is wrong, make it a conference"
  //      "tag is wrong, conference"
  //      "wrong tag, it's a conference"
  const tagWrongMatch = /^(?:(?:the\s+)?([a-zA-Z0-9_-]+)(?:\s+([a-zA-Z0-9_-]+))?\s+)?(?:(?:tag|type)\s+is\s+(?:wrong|incorrect)|wrong\s+(?:tag|type))[:,\s]+(?:it(?:'s|\s+is)\s+(?:a\s+|an\s+)?|change\s+to\s+|make\s+it\s+(?:a\s+|an\s+)?|reclassify\s+as\s+|to\s+)?#?([a-zA-Z0-9_-]+)$/i.exec(trimmed);
  if (tagWrongMatch) {
    const rawWord1 = tagWrongMatch[1];
    const rawWord2 = tagWrongMatch[2];
    const newTypeRaw = tagWrongMatch[3];

    let targetName = '';
    let oldType = '';

    if (rawWord1 && rawWord2) {
      targetName = rawWord1;
      oldType = rawWord2;
    } else if (rawWord1) {
      let isEntityName = false;
      for (const e of entities.values()) {
        if (e.name.toLowerCase() === rawWord1.toLowerCase()) {
          isEntityName = true;
          targetName = e.name;
          oldType = e.type;
          break;
        }
      }
      if (!isEntityName) {
        if (contextEntity) {
          targetName = contextEntity.name;
          oldType = rawWord1;
        } else {
          targetName = rawWord1;
          oldType = 'Project';
        }
      }
    } else if (contextEntity) {
      targetName = contextEntity.name;
      oldType = contextEntity.type;
    }

    if (targetName && newTypeRaw) {
      const resolved = resolveEntity(targetName);
      const finalName = resolved ? resolved.name : targetName;
      const finalOldType = formatTypeName(oldType || (resolved ? resolved.type : 'Project'));
      const finalNewType = formatTypeName(newTypeRaw);

      return {
        type: 'reclassify',
        title: `Reclassify #${finalOldType}/${finalName} ➔ #${finalNewType}/${finalName}`,
        reclassify: {
          oldType: finalOldType,
          oldName: finalName,
          newType: finalNewType,
          newName: finalName,
        },
      };
    }
  }

  // Pattern 2: "X is a Y not a Z" / "is a Y not a Z"
  // e.g. "imts is a conference not a project"
  //      "this is a conference not a project"
  //      "is a conference not a project"
  const notAMatch = /^(?:([a-zA-Z0-9_-]+)\s+)?(?:is\s+(?:a\s+|an\s+)?|should\s+be\s+(?:a\s+|an\s+)?)(#?[a-zA-Z0-9_-]+)[,\s]+(?:and\s+)?not\s+(?:a\s+|an\s+)?(#?[a-zA-Z0-9_-]+)$/i.exec(trimmed);
  if (notAMatch) {
    const rawSubject = notAMatch[1];
    const newTypeRaw = notAMatch[2];
    const oldTypeRaw = notAMatch[3];

    let targetName = '';
    if (rawSubject && rawSubject.toLowerCase() !== 'this' && rawSubject.toLowerCase() !== 'it') {
      targetName = rawSubject;
    } else if (contextEntity) {
      targetName = contextEntity.name;
    }

    if (targetName) {
      const resolved = resolveEntity(targetName);
      const finalName = resolved ? resolved.name : targetName;
      const finalOldType = formatTypeName(oldTypeRaw || (resolved ? resolved.type : 'Project'));
      const finalNewType = formatTypeName(newTypeRaw);

      return {
        type: 'reclassify',
        title: `Reclassify #${finalOldType}/${finalName} ➔ #${finalNewType}/${finalName}`,
        reclassify: {
          oldType: finalOldType,
          oldName: finalName,
          newType: finalNewType,
          newName: finalName,
        },
      };
    }
  }

  // Pattern 3: Context-aware change / switch / reclassify
  // e.g. "change to conference"
  //      "make it a conference"
  //      "reclassify as conference"
  if (contextEntity) {
    const contextChange = /^(?:change|switch|make\s+it|reclassify|mark\s+it)(?:\s+(?:to|as))?\s+(?:a\s+|an\s+)?#?([a-zA-Z0-9_-]+)$/i.exec(trimmed);
    if (contextChange) {
      const newTypeRaw = contextChange[1];
      const finalNewType = formatTypeName(newTypeRaw);
      return {
        type: 'reclassify',
        title: `Reclassify #${contextEntity.type}/${contextEntity.name} ➔ #${finalNewType}/${contextEntity.name}`,
        reclassify: {
          oldType: contextEntity.type,
          oldName: contextEntity.name,
          newType: finalNewType,
          newName: contextEntity.name,
        },
      };
    }
  }

  // Pattern 4: "Change <Entity> from <OldType> to <NewType>" or "Change <Entity> to <NewType>"
  const changeMatch1 = /^(?:change|reclassify|rename|move|switch)\s+(?:#?([a-zA-Z0-9_-]+)\/)?([a-zA-Z0-9_-]+)\s+(?:from\s+([a-zA-Z0-9_-]+)\s+)?to\s+#?([a-zA-Z0-9_-]+)(?:\/([a-zA-Z0-9_-]+))?$/i.exec(trimmed);
  if (changeMatch1) {
    const targetName = changeMatch1[2];
    const explicitOldType = changeMatch1[1] || changeMatch1[3];
    const targetNewType = formatTypeName(changeMatch1[4]);
    const targetNewName = changeMatch1[5] || targetName;

    let oldType = explicitOldType;
    if (!oldType) {
      for (const e of entities.values()) {
        if (e.name.toLowerCase() === targetName.toLowerCase()) {
          oldType = e.type;
          break;
        }
      }
    }
    oldType = formatTypeName(oldType || (contextEntity?.name.toLowerCase() === targetName.toLowerCase() ? contextEntity.type : 'Project'));

    const resolved = resolveEntity(targetName);
    const finalName = resolved ? resolved.name : targetName;

    return {
      type: 'reclassify',
      title: `Reclassify #${oldType}/${finalName} ➔ #${targetNewType}/${targetNewName}`,
      reclassify: {
        oldType,
        oldName: finalName,
        newType: targetNewType,
        newName: targetNewName,
      },
    };
  }

  // Pattern 5: "Reclassify <Entity> as <NewType>"
  const changeMatch2 = /^(?:reclassify|classify|mark)\s+([a-zA-Z0-9_-]+)\s+as\s+(?:a\s+|an\s+)?([a-zA-Z0-9_-]+)$/i.exec(trimmed);
  if (changeMatch2) {
    const targetName = changeMatch2[1];
    const targetNewType = formatTypeName(changeMatch2[2]);
    let oldType = 'Project';
    for (const e of entities.values()) {
      if (e.name.toLowerCase() === targetName.toLowerCase()) {
        oldType = e.type;
        break;
      }
    }
    oldType = formatTypeName(oldType);
    const resolved = resolveEntity(targetName);
    const finalName = resolved ? resolved.name : targetName;
    return {
      type: 'reclassify',
      title: `Reclassify #${oldType}/${finalName} ➔ #${targetNewType}/${finalName}`,
      reclassify: {
        oldType,
        oldName: finalName,
        newType: targetNewType,
        newName: finalName,
      },
    };
  }

  return null;
}

