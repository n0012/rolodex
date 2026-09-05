/** Reducing the index to what a given date window and type filter should show. */

import { todayIso } from './parse';
import type { EntityRecord, EntityTask, PortfolioRow, RolodexIndex } from './types';

export interface Window {
  from: string;
  to: string;
}

const inWindow = (date: string, w: Window) => !date || (date >= w.from && date <= w.to);

/**
 * Open work is deliberately NOT date-filtered. A commitment made four months
 * ago and never closed is the single most useful thing this tool can show; a
 * 30-day window would hide exactly the tasks worth chasing.
 */
export function openTasks(e: EntityRecord): EntityTask[] {
  return e.tasks.filter(t => t.status === 'open');
}

export function isOverdue(t: EntityTask, today = todayIso()): boolean {
  return t.status === 'open' && !!t.due && t.due < today;
}

/** Overdue first, then soonest due, then priority, then oldest. */
export function sortTasks(tasks: EntityTask[], today = todayIso()): EntityTask[] {
  return [...tasks].sort((a, b) => {
    const ao = isOverdue(a, today) ? 0 : 1;
    const bo = isOverdue(b, today) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    }
    const ap = a.priority ?? 9;
    const bp = b.priority ?? 9;
    if (ap !== bp) return ap - bp;
    return a.noteDate.localeCompare(b.noteDate);
  });
}

export function buildRows(index: RolodexIndex, w: Window, types: string[]): PortfolioRow[] {
  const today = todayIso();
  const allowed = types.length ? new Set(types) : null;
  const rows: PortfolioRow[] = [];

  for (const e of index.entities.values()) {
    if (allowed && !allowed.has(e.type)) continue;

    const open = openTasks(e);
    const done = e.tasks.filter(t => t.status === 'done' && inWindow(t.done ?? t.noteDate, w));
    const activities = e.activities.filter(a => inWindow(a.date, w));

    // An entity with no activity in the window still earns a row if it has open
    // work — silence on an account that owes you something is the signal, not a
    // reason to hide it.
    if (!activities.length && !open.length && !done.length) continue;

    rows.push({
      key: e.key, type: e.type, name: e.name,
      open: open.length,
      overdue: open.filter(t => isOverdue(t, today)).length,
      done: done.length,
      activities: activities.length,
      noteCount: e.noteCount,
      lastSeen: e.lastSeen,
      related: [...e.related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k),
      notePath: e.notePath,
    });
  }
  return rows;
}

export type SortKey = 'attention' | 'recent' | 'name' | 'open' | 'activity';

export function sortRows(rows: PortfolioRow[], key: SortKey): PortfolioRow[] {
  const out = [...rows];
  switch (key) {
    case 'recent':
      return out.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'open':
      return out.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
    case 'activity':
      return out.sort((a, b) => b.activities - a.activities || a.name.localeCompare(b.name));
    default:
      // "Attention": overdue outranks everything, then open work, then how long
      // it has been quiet. This is the default because it answers the question
      // the tool exists for — who am I dropping?
      return out.sort((a, b) =>
        b.overdue - a.overdue ||
        b.open - a.open ||
        (a.lastSeen || '').localeCompare(b.lastSeen || '') ||
        a.name.localeCompare(b.name));
  }
}

/** Warm / cooling / cold, from days since the last mention. */
export function heat(lastSeen: string, today = todayIso()): { icon: string; label: string } {
  if (!lastSeen) return { icon: '○', label: 'no dated activity' };
  const days = Math.round(
    (Date.parse(today) - Date.parse(lastSeen)) / 86_400_000);
  if (days <= 14) return { icon: '●', label: `${days}d ago` };
  if (days <= 45) return { icon: '◐', label: `${days}d ago` };
  return { icon: '○', label: `${days}d ago` };
}
