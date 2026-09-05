import { describe, expect, it } from 'vitest';
import { noteDate, parseTags, parseTaskLine, parseTaskMeta, tagKey } from '../src/parse';

describe('parseTags', () => {
  const keys = (text: string) => parseTags(text).map(t => tagKey(t.type, t.name));

  it('matches whole segments, so GE does not also mean GEHC', () => {
    expect(keys('#Customer/GEHC met today')).toEqual(['customer/gehc']);
    expect(keys('#Customer/GE met today')).toEqual(['customer/ge']);
  });

  it('stops at a period, which is not part of an Obsidian tag', () => {
    expect(keys('spoke to #Customer/Suki.')).toEqual(['customer/suki']);
  });

  it('folds case, matching how Obsidian itself treats tags', () => {
    expect(keys('#customer/amgen and #Customer/Amgen')).toEqual(['customer/amgen']);
  });

  it('keeps hyphens inside a name instead of truncating', () => {
    const [t] = parseTags('#Customer/Pharma-ISV');
    expect(t.name).toBe('Pharma-ISV');
  });

  it('reads a third level as a sub-area of the same entity', () => {
    const [t] = parseTags('#Customer/Pharma/ISV');
    expect(tagKey(t.type, t.name)).toBe('customer/pharma');
    expect(t.subs).toEqual(['ISV']);
  });

  it('ignores a bare single-level tag', () => {
    expect(parseTags('#todo #inbox')).toEqual([]);
  });

  it('finds every entity on a line', () => {
    expect(keys('#Project/FoldRun for #Customer/Amgen'))
      .toEqual(['project/foldrun', 'customer/amgen']);
  });
});

describe('parseTaskLine', () => {
  it('reads the four markers this vault uses', () => {
    expect(parseTaskLine('- [ ] a')?.status).toBe('open');
    expect(parseTaskLine('- [x] a')?.status).toBe('done');
    expect(parseTaskLine('- [X] a')?.status).toBe('done');
    expect(parseTaskLine('- [-] a')?.status).toBe('cancelled');
    expect(parseTaskLine('- [/] a')?.status).toBe('open');
  });

  it('is not fooled by a bullet that only looks like one', () => {
    expect(parseTaskLine('- [link](x)')).toBeNull();
    expect(parseTaskLine('a - [ ] not at line start')).toBeNull();
  });

  it('keeps indentation for nested tasks', () => {
    expect(parseTaskLine('    - [ ] sub')?.indent).toBe(4);
  });
});

describe('parseTaskMeta', () => {
  it('pulls dates and priority off and leaves a clean sentence', () => {
    const { meta, text } = parseTaskMeta('Send the GSU ladder ⏫ ➕ 2026-08-01 📅 2026-09-10 #Customer/Suki');
    expect(meta.due).toBe('2026-09-10');
    expect(meta.created).toBe('2026-08-01');
    expect(meta.priority).toBe(2);
    expect(text).toBe('Send the GSU ladder');
  });

  it('reads a completion date', () => {
    const { meta } = parseTaskMeta('Ship it ✅ 2026-09-01');
    expect(meta.done).toBe('2026-09-01');
  });

  it('takes the highest priority marker only', () => {
    expect(parseTaskMeta('x 🔺').meta.priority).toBe(1);
    expect(parseTaskMeta('x 🔽').meta.priority).toBe(4);
  });

  it('leaves an unadorned task untouched', () => {
    const { meta, text } = parseTaskMeta('Call them back');
    expect(meta).toEqual({});
    expect(text).toBe('Call them back');
  });
});

describe('noteDate', () => {
  it('prefers the filename, which survives a later edit', () => {
    expect(noteDate('2026-09-05', undefined, Date.parse('2020-01-01'))).toBe('2026-09-05');
  });

  it('falls back to frontmatter, then to ctime', () => {
    expect(noteDate('Amgen', '2026-01-02T10:00:00Z')).toBe('2026-01-02');
    expect(noteDate('Amgen', undefined, Date.parse('2026-03-04T12:00:00Z'))).toBe('2026-03-04');
    expect(noteDate('Amgen')).toBe('');
  });
});
