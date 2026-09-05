/**
 * Builds the whole index in ONE pass over the vault.
 *
 * The plugin this replaces called a per-entity fetch that re-read every file,
 * so opening the overview cost entities x files reads — about 117,000 on this
 * vault, every time. Here each file is read once, and every entity it mentions
 * is credited from that single read.
 */

import { App, TFile } from 'obsidian';
import { parseTags, parseTaskLine, parseTaskMeta, noteDate, tagKey } from './parse';
import type {
  EntityActivity, EntityRecord, EntityTask, RolodexIndex, RolodexSettings,
} from './types';

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function inFolder(path: string, folder: string): boolean {
  const f = folder.replace(/^\/+|\/+$/g, '');
  if (!f) return false;
  // Prefix match on a path BOUNDARY. Plain includes() is what made a
  // sourceFolder of "~Daily" also swallow all 441 notes in ~DailyMeetings.
  return path === f || path.startsWith(`${f}/`);
}

function shouldScan(path: string, s: RolodexSettings, configDir: string): boolean {
  if (path.startsWith(`${configDir}/`)) return false;
  if (s.excludeFolders.some(f => inFolder(path, f))) return false;
  if (s.includeFolders.length && !s.includeFolders.some(f => inFolder(path, f))) return false;
  return true;
}

function blank(key: string, type: string, name: string): EntityRecord {
  return {
    key, type, name,
    subs: new Set(), tasks: [], activities: [], related: new Map(),
    noteCount: 0, lastSeen: '', firstSeen: '',
  };
}

/** Resolved tag, after alias folding, with the key everything else indexes on. */
interface Tagged { key: string; type: string; name: string; subs: string[] }

export async function buildIndex(app: App, s: RolodexSettings): Promise<RolodexIndex> {
  const entities = new Map<string, EntityRecord>();
  // Counted case-folded, then relabelled with the winning spelling, so the
  // type filter offers "Customer" once rather than Customer/customer/Customers.
  const typeCounts = new Map<string, number>();
  const files = app.vault.getMarkdownFiles().filter(f => shouldScan(f.path, s, app.vault.configDir));

  const ignored = new Set(s.ignoredTypes.map(t => t.toLowerCase()));
  const aliases = new Map(
    s.typeAliases.map(pair => pair.split('=').map(x => x.trim()))
      .filter(p => p.length === 2 && p[0] && p[1])
      .map(([from, to]) => [from.toLowerCase(), to]),
  );

  // Which spelling of a name to display. Tags are case-folded for identity, so
  // some vote is needed; the most-used spelling beats first-seen, which would
  // let one stray "#customer/acmecorp" name the account forever.
  const nameVotes = new Map<string, Map<string, number>>();
  const typeVotes = new Map<string, Map<string, number>>();
  const vote = (into: Map<string, Map<string, number>>, key: string, display: string) => {
    let m = into.get(key);
    if (!m) { m = new Map(); into.set(key, m); }
    m.set(display, (m.get(display) ?? 0) + 1);
  };
  const winner = (m: Map<string, number> | undefined, fallback: string) =>
    m ? [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0] : fallback;

  const resolve = (t: { type: string; name: string; subs: string[] }): Tagged | null => {
    if (ignored.has(t.type.toLowerCase())) return null;
    const type = aliases.get(t.type.toLowerCase()) ?? t.type;
    const key = tagKey(type, t.name);
    vote(nameVotes, key, t.name);
    vote(typeVotes, type.toLowerCase(), type);
    return { key, type, name: t.name, subs: t.subs };
  };

  const get = (key: string, type: string, name: string) => {
    let e = entities.get(key);
    if (!e) { e = blank(key, type, name); entities.set(key, e); }
    return e;
  };

  for (const file of files) {
    let content: string;
    try {
      // cachedRead, not read: this is a scan, and we never write what we read.
      content = await app.vault.cachedRead(file);
    } catch {
      continue;
    }

    const fm = app.metadataCache.getFileCache(file)?.frontmatter as
      | Record<string, unknown> | undefined;
    const date = noteDate(file.basename, typeof fm?.created === 'string' ? fm.created : undefined, file.stat.ctime);

    const lines = content.split('\n');

    // A "section" is a heading plus everything under it until the next heading.
    // Entity attribution happens per section, because that is the unit that
    // actually reads as one interaction in a daily note.
    let heading = '';
    let sectionStart = 0;
    let sectionTags = new Map<string, Tagged>();
    const pendingTasks: Array<{ task: EntityTask; own: Tagged[] }> = [];

    const flush = (endLine: number) => {
      const keys = [...sectionTags.keys()];
      if (keys.length) {
        const text = lines.slice(sectionStart, endLine).join('\n').trim();
        for (const key of keys) {
          const t = sectionTags.get(key)!;
          const e = get(key, t.type, t.name);
          for (const sub of t.subs) e.subs.add(sub);
          if (text) {
            e.activities.push({
              date, heading, text, path: file.path, file: file.basename,
              alsoHere: keys.filter(k => k !== key),
            });
          }
          // Relate only across different types (never Customer <-> Customer)
          for (const other of keys) {
            if (other === key) continue;
            const otherTag = sectionTags.get(other);
            if (otherTag && otherTag.type.toLowerCase() === t.type.toLowerCase()) continue;
            e.related.set(other, (e.related.get(other) ?? 0) + 1);
          }

          // Extract [[wikilinks]] in the section (stakeholders, partners, projects)
          if (text) {
            const WIKILINK_RE = /\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g;
            let wMatch: RegExpExecArray | null;
            while ((wMatch = WIKILINK_RE.exec(text)) !== null) {
              const target = wMatch[1].trim();
              if (target && !/^\d{4}-\d{2}/.test(target) && target.toLowerCase() !== t.name.toLowerCase()) {
                const wlKey = `link/${target.toLowerCase()}`;
                vote(nameVotes, wlKey, target);
                e.related.set(wlKey, (e.related.get(wlKey) ?? 0) + 1);
              }
            }
          }
        }
      }
      // A task inherits its section's entities only when it names none itself,
      // so a task tagged #Customer/Globex under an Acme heading stays Globex's.
      for (const { task, own } of pendingTasks) {
        const targets = own.length ? own : keys.map(k => sectionTags.get(k)!);
        for (const t of targets) get(t.key, t.type, t.name).tasks.push(task);
      }
      pendingTasks.length = 0;
      sectionTags = new Map();
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const h = HEADING_RE.exec(line);
      if (h) {
        flush(i);
        heading = h[2].trim();
        sectionStart = i;
        for (const raw of parseTags(heading)) {
          const t = resolve(raw);
          if (!t) continue;
          typeCounts.set(t.type.toLowerCase(), (typeCounts.get(t.type.toLowerCase()) ?? 0) + 1);
          sectionTags.set(t.key, t);
        }
        continue;
      }

      const lineTags = parseTags(line).map(resolve).filter((t): t is Tagged => t !== null);
      for (const t of lineTags) {
        typeCounts.set(t.type.toLowerCase(), (typeCounts.get(t.type.toLowerCase()) ?? 0) + 1);
        if (!sectionTags.has(t.key)) sectionTags.set(t.key, t);
      }

      const parsed = parseTaskLine(line);
      if (parsed) {
        const { meta, text } = parseTaskMeta(parsed.body);
        pendingTasks.push({
          task: {
            ...meta, text, raw: line, status: parsed.status,
            path: file.path, line: i, noteDate: date, heading,
          },
          own: lineTags,
        });
      }
    }
    flush(lines.length);

    // Counted once per file, not once per tag: "how many notes is this account
    // in" is the number that reflects real contact. A name repeated ten times
    // in one meeting note is still one meeting.
    const inThisFile = new Set<string>();
    for (const raw of parseTags(content)) {
      const t = resolve(raw);
      if (!t || inThisFile.has(t.key)) continue;
      inThisFile.add(t.key);
      const e = entities.get(t.key);
      if (!e) continue;
      e.noteCount++;
      if (date) {
        if (!e.lastSeen || date > e.lastSeen) e.lastSeen = date;
        if (!e.firstSeen || date < e.firstSeen) e.firstSeen = date;
      }
    }
  }

  // Settle on one spelling each now that every occurrence has voted.
  for (const e of entities.values()) {
    e.name = winner(nameVotes.get(e.key), e.name);
    e.type = winner(typeVotes.get(e.type.toLowerCase()), e.type);
  }

  const typesSeen = new Map<string, number>();
  for (const [lower, n] of typeCounts) {
    const label = winner(typeVotes.get(lower), lower);
    typesSeen.set(label, (typesSeen.get(label) ?? 0) + n);
  }

  attachEntityNotes(app, entities, s);

  for (const e of entities.values()) {
    e.activities.sort((a, b) => b.date.localeCompare(a.date));
  }

  return { entities, typesSeen, scannedFiles: files.length, builtAt: Date.now() };
}

/**
 * Link each entity to its own note when one exists — Customers/BMS.md,
 * Projects/FoldRun.md and so on — so the browser can hand off to the page
 * where the durable account context actually lives.
 */
function attachEntityNotes(app: App, entities: Map<string, EntityRecord>, s: RolodexSettings) {
  if (!s.entityNoteFolders.length) return;
  const byName = new Map<string, TFile[]>();
  for (const f of app.vault.getMarkdownFiles()) {
    if (!s.entityNoteFolders.some(folder => inFolder(f.path, folder))) continue;
    const k = f.basename.toLowerCase();
    const list = byName.get(k);
    if (list) list.push(f); else byName.set(k, [f]);
  }
  for (const e of entities.values()) {
    const hits = byName.get(e.name.toLowerCase());
    if (!hits?.length) continue;
    // Prefer a note in a folder named after the type (Customers/ for Customer),
    // otherwise take the only candidate. Ambiguity is left unlinked rather than
    // guessed at.
    const typed = hits.find(f => f.path.toLowerCase().startsWith(`${e.type.toLowerCase()}`));
    e.notePath = typed?.path ?? (hits.length === 1 ? hits[0].path : undefined);
  }
}
