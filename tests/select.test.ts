import { describe, expect, it } from 'vitest';
import { buildRows, heat, isOverdue, openTasks, sortRows, sortTasks } from '../src/select';
import type { EntityRecord, EntityTask, RolodexIndex } from '../src/types';

const TODAY = '2026-09-05';

function task(p: Partial<EntityTask>): EntityTask {
  return {
    text: 'x', raw: '- [ ] x', status: 'open', path: 'a.md', line: 0,
    noteDate: '2026-01-01', heading: '', ...p,
  };
}

function entity(p: Partial<EntityRecord> & { key: string }): EntityRecord {
  const [type, name] = p.key.split('/');
  return {
    type, name, subs: new Set(), tasks: [], activities: [], related: new Map(),
    noteCount: 0, lastSeen: '', firstSeen: '', ...p,
  };
}

describe('openTasks', () => {
  it('is not date filtered — a stale commitment is the point', () => {
    const e = entity({
      key: 'Customer/Amgen',
      tasks: [task({ noteDate: '2024-01-01' }), task({ status: 'done' })],
    });
    expect(openTasks(e)).toHaveLength(1);
  });
});

describe('sortTasks', () => {
  it('puts overdue first, then soonest due, then priority', () => {
    const late = task({ text: 'late', due: '2026-08-01' });
    const soon = task({ text: 'soon', due: '2026-09-20' });
    const later = task({ text: 'later', due: '2026-12-01' });
    const undated = task({ text: 'undated' });
    const urgent = task({ text: 'urgent', priority: 1 });

    const order = sortTasks([later, undated, soon, urgent, late], TODAY).map(t => t.text);
    expect(order[0]).toBe('late');
    expect(order.slice(1, 3)).toEqual(['soon', 'later']);
    expect(order.indexOf('urgent')).toBeLessThan(order.indexOf('undated'));
  });

  it('does not call a done task overdue', () => {
    expect(isOverdue(task({ due: '2020-01-01', status: 'done' }), TODAY)).toBe(false);
  });
});

describe('buildRows', () => {
  const win = { from: '2026-08-01', to: TODAY };

  const index = (...es: EntityRecord[]): RolodexIndex => ({
    entities: new Map(es.map(e => [e.key, e])),
    typesSeen: new Map(),
    scannedFiles: 0,
    builtAt: 0,
  });

  it('keeps a silent entity that still owes you something', () => {
    const quiet = entity({
      key: 'Customer/BMS',
      lastSeen: '2025-01-01',
      tasks: [task({ due: '2025-02-01' })],
    });
    const rows = buildRows(index(quiet), win, []);
    expect(rows).toHaveLength(1);
    expect(rows[0].overdue).toBe(1);
  });

  it('drops an entity with nothing in the window and nothing open', () => {
    const dormant = entity({
      key: 'Customer/Old',
      activities: [{ date: '2024-01-01', heading: '', text: 'x', path: 'a.md', file: 'a', alsoHere: [] }],
    });
    expect(buildRows(index(dormant), win, [])).toHaveLength(0);
  });

  it('honours the type filter', () => {
    const a = entity({ key: 'Customer/A', tasks: [task({})] });
    const b = entity({ key: 'Project/B', tasks: [task({})] });
    expect(buildRows(index(a, b), win, ['Project']).map(r => r.key)).toEqual(['Project/B']);
  });

  it('surfaces the top three connections', () => {
    const e = entity({
      key: 'Project/FoldRun',
      tasks: [task({})],
      related: new Map([
        ['Customer/Amgen', 29], ['Customer/Suki', 23],
        ['Customer/Commure', 16], ['Customer/Illumina', 12],
      ]),
    });
    expect(buildRows(index(e), win, [])[0].related)
      .toEqual(['Customer/Amgen', 'Customer/Suki', 'Customer/Commure']);
  });
});

describe('sortRows', () => {
  const row = (p: Partial<ReturnType<typeof base>>) => ({ ...base(), ...p });
  function base() {
    return {
      key: 'Customer/X', type: 'Customer', name: 'X', open: 0, overdue: 0,
      done: 0, activities: 0, noteCount: 0, lastSeen: '2026-09-01', related: [] as string[],
    };
  }

  it('ranks overdue above open, and quiet above loud', () => {
    const late = row({ name: 'late', overdue: 1, open: 1 });
    const busy = row({ name: 'busy', open: 9 });
    const quiet = row({ name: 'quiet', open: 1, lastSeen: '2025-01-01' });
    const loud = row({ name: 'loud', open: 1, lastSeen: '2026-09-04' });

    expect(sortRows([busy, loud, quiet, late], 'attention').map(r => r.name))
      .toEqual(['late', 'busy', 'quiet', 'loud']);
  });
});

describe('heat', () => {
  it('cools with silence', () => {
    expect(heat('2026-09-01', TODAY).icon).toBe('●');
    expect(heat('2026-08-05', TODAY).icon).toBe('◐');
    expect(heat('2026-01-01', TODAY).icon).toBe('○');
    expect(heat('', TODAY).icon).toBe('○');
  });
});
