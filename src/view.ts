import {
  ButtonComponent, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf,
} from 'obsidian';
import { buildContext, summarize } from './ai';
import { daysAgoIso, todayIso } from './parse';
import { buildRows, heat, isOverdue, openTasks, sortRows, sortTasks } from './select';
import type { SortKey, Window } from './select';
import type { EntityRecord, EntityTask, PortfolioRow } from './types';
import type RolodexPlugin from './main';

export const VIEW_TYPE_ROLODEX = 'rolodex-view';

const PRESETS: Array<[string, number]> = [
  ['Last 7 days', 7], ['Last 30 days', 30], ['Last 90 days', 90],
  ['Last year', 365], ['All time', 0],
];

export class RolodexView extends ItemView {
  private plugin: RolodexPlugin;
  private win: Window;
  private types: string[] = [];
  private sort: SortKey = 'attention';
  private query = '';
  private selected: string | null = null;
  private summary: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RolodexPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.win = { from: daysAgoIso(plugin.settings.defaultDays), to: todayIso() };
  }

  getViewType() { return VIEW_TYPE_ROLODEX; }
  getDisplayText() { return 'Rolodex'; }
  getIcon() { return 'contact'; }

  async onOpen() {
    await this.plugin.ensureIndex();
    this.render();
  }

  /** Called by the plugin after a rescan so an open pane never shows stale counts. */
  refresh() {
    if (this.containerEl.isShown()) this.render();
  }

  private body(): HTMLElement {
    return this.containerEl.children[1] as HTMLElement;
  }

  render() {
    const root = this.body();
    root.empty();
    root.addClass('rolodex');

    this.renderControls(root);
    if (this.selected) this.renderEntity(root, this.selected);
    else this.renderPortfolio(root);
  }

  // ── Controls ─────────────────────────────────────────────────

  private renderControls(root: HTMLElement) {
    const bar = root.createDiv({ cls: 'rolodex-bar' });

    const title = bar.createDiv({ cls: 'rolodex-title' });
    title.createSpan({ text: '🗂 Rolodex' });
    const idx = this.plugin.index;
    if (idx) {
      title.createEl('small', {
        text: `${idx.entities.size} entities · ${idx.scannedFiles} notes`,
        cls: 'rolodex-muted',
      });
    }

    const actions = bar.createDiv({ cls: 'rolodex-bar-actions' });
    new ButtonComponent(actions)
      .setIcon('refresh-cw')
      .setTooltip('Rescan the vault')
      .onClick(async () => {
        await this.plugin.rescan();
        new Notice('Rolodex rescanned');
        this.render();
      });

    // Window
    const winRow = root.createDiv({ cls: 'rolodex-row' });
    const preset = winRow.createEl('select', { cls: 'dropdown' });
    for (const [label, days] of PRESETS) {
      const opt = preset.createEl('option', { text: label, value: String(days) });
      const from = days ? daysAgoIso(days) : '';
      if ((days === 0 && !this.win.from) || (days !== 0 && this.win.from === from)) opt.selected = true;
    }
    preset.addEventListener('change', () => {
      const days = Number(preset.value);
      this.win = { from: days ? daysAgoIso(days) : '0000-01-01', to: todayIso() };
      this.summary = null;
      this.render();
    });

    const from = winRow.createEl('input', { type: 'date' });
    from.value = this.win.from === '0000-01-01' ? '' : this.win.from;
    from.addEventListener('change', () => {
      this.win = { ...this.win, from: from.value || '0000-01-01' };
      this.render();
    });
    const to = winRow.createEl('input', { type: 'date' });
    to.value = this.win.to;
    to.addEventListener('change', () => {
      this.win = { ...this.win, to: to.value || todayIso() };
      this.render();
    });

    // Type chips, ordered by how much they are actually used.
    const typeRow = root.createDiv({ cls: 'rolodex-chips' });
    const available = this.availableTypes();
    for (const t of available) {
      const on = this.types.includes(t);
      const chip = typeRow.createEl('button', {
        text: t,
        cls: on ? 'rolodex-chip is-on' : 'rolodex-chip',
      });
      chip.addEventListener('click', () => {
        this.types = on ? this.types.filter(x => x !== t) : [...this.types, t];
        this.selected = null;
        this.render();
      });
    }
    if (this.types.length) {
      const clear = typeRow.createEl('button', { text: '✕ all types', cls: 'rolodex-chip is-clear' });
      clear.addEventListener('click', () => { this.types = []; this.render(); });
    }
  }

  /** Entity keys are case-folded, so a display name always comes from the record. */
  private nameOf(key: string): string {
    return this.plugin.index?.entities.get(key)?.name ?? key;
  }

  private availableTypes(): string[] {
    const idx = this.plugin.index;
    if (!idx) return [];
    const configured = this.plugin.settings.entityTypes;
    const seen = [...idx.typesSeen.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    if (!configured.length) return seen;
    // Configured order first, then anything else the vault actually contains,
    // so a new namespace shows up without needing a settings edit.
    return [...configured.filter(t => seen.includes(t)), ...seen.filter(t => !configured.includes(t))];
  }

  // ── Portfolio ────────────────────────────────────────────────

  private renderPortfolio(root: HTMLElement) {
    const idx = this.plugin.index;
    if (!idx) { root.createDiv({ text: 'Scanning…', cls: 'rolodex-muted' }); return; }

    const tools = root.createDiv({ cls: 'rolodex-row' });
    const search = tools.createEl('input', { type: 'search', placeholder: 'Filter by name…' });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderTableOnly(root);
    });

    const sort = tools.createEl('select', { cls: 'dropdown' });
    const opts: Array<[SortKey, string]> = [
      ['attention', 'Needs attention'], ['recent', 'Most recent'],
      ['open', 'Most open tasks'], ['activity', 'Most activity'], ['name', 'Name'],
    ];
    for (const [k, label] of opts) {
      const o = sort.createEl('option', { text: label, value: k });
      if (k === this.sort) o.selected = true;
    }
    sort.addEventListener('change', () => {
      this.sort = sort.value as SortKey;
      this.renderTableOnly(root);
    });

    root.createDiv({ cls: 'rolodex-table-host' });
    this.renderTableOnly(root);
  }

  private renderTableOnly(root: HTMLElement) {
    const host = root.querySelector('.rolodex-table-host') as HTMLElement | null;
    if (!host) return;
    host.empty();

    const idx = this.plugin.index!;
    let rows = sortRows(buildRows(idx, this.win, this.types), this.sort);
    const q = this.query.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));

    if (!rows.length) {
      host.createDiv({ text: 'Nothing in this window.', cls: 'rolodex-muted' });
      return;
    }

    const totals = rows.reduce((a, r) => ({
      open: a.open + r.open, overdue: a.overdue + r.overdue,
    }), { open: 0, overdue: 0 });
    const cap = host.createDiv({ cls: 'rolodex-totals' });
    cap.createSpan({ text: `${rows.length} entities` });
    cap.createSpan({ text: `${totals.open} open` });
    if (totals.overdue) cap.createSpan({ text: `${totals.overdue} overdue`, cls: 'rolodex-overdue' });

    const table = host.createEl('table', { cls: 'rolodex-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const h of ['', 'Entity', 'Last', 'Open', 'Late', 'Notes', 'Connected']) {
      head.createEl('th', { text: h });
    }

    const tbody = table.createEl('tbody');
    for (const r of rows) this.renderRow(tbody, r);
  }

  private renderRow(tbody: HTMLElement, r: PortfolioRow) {
    const tr = tbody.createEl('tr');
    const h = heat(r.lastSeen);

    tr.createEl('td', { text: h.icon, cls: 'rolodex-heat', attr: { title: h.label } });

    const nameCell = tr.createEl('td');
    const link = nameCell.createEl('a', { text: r.name, cls: 'rolodex-link' });
    link.addEventListener('click', e => {
      e.preventDefault();
      this.selected = r.key;
      this.summary = null;
      this.render();
    });
    nameCell.createEl('small', { text: ` ${r.type}`, cls: 'rolodex-muted' });

    tr.createEl('td', { text: r.lastSeen || '—', cls: 'rolodex-muted' });
    tr.createEl('td', { text: String(r.open), cls: 'rolodex-num' });
    tr.createEl('td', {
      text: r.overdue ? String(r.overdue) : '',
      cls: r.overdue ? 'rolodex-num rolodex-overdue' : 'rolodex-num',
    });
    tr.createEl('td', { text: String(r.activities), cls: 'rolodex-num' });

    const rel = tr.createEl('td', { cls: 'rolodex-rel' });
    for (const key of r.related) {
      const b = rel.createEl('button', { text: this.nameOf(key), cls: 'rolodex-chip is-mini' });
      b.setAttr('title', key);
      b.addEventListener('click', () => { this.selected = key; this.summary = null; this.render(); });
    }
  }

  // ── One entity ───────────────────────────────────────────────

  private renderEntity(root: HTMLElement, key: string) {
    const e = this.plugin.index?.entities.get(key);
    if (!e) {
      root.createDiv({ text: `${key} is no longer in the index.`, cls: 'rolodex-muted' });
      this.selected = null;
      return;
    }

    const head = root.createDiv({ cls: 'rolodex-entity-head' });
    const back = head.createEl('button', { text: '← All', cls: 'rolodex-chip' });
    back.addEventListener('click', () => { this.selected = null; this.summary = null; this.render(); });
    head.createEl('h3', { text: e.name });
    head.createEl('small', { text: e.type, cls: 'rolodex-muted' });

    if (e.notePath) {
      const open = head.createEl('button', { text: '📄 Note', cls: 'rolodex-chip' });
      open.addEventListener('click', () => void this.app.workspace.openLinkText(e.notePath!, '', false));
    }

    const stats = root.createDiv({ cls: 'rolodex-totals' });
    const open = openTasks(e);
    const late = open.filter(t => isOverdue(t)).length;
    stats.createSpan({ text: `${open.length} open` });
    if (late) stats.createSpan({ text: `${late} overdue`, cls: 'rolodex-overdue' });
    stats.createSpan({ text: `in ${e.noteCount} notes` });
    stats.createSpan({ text: `${e.firstSeen || '?'} → ${e.lastSeen || '?'}` });

    const related = [...e.related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (related.length) {
      const relRow = root.createDiv({ cls: 'rolodex-chips' });
      relRow.createSpan({ text: 'Connected: ', cls: 'rolodex-muted' });
      for (const [k, n] of related) {
        const b = relRow.createEl('button', { text: `${this.nameOf(k)} ${n}`, cls: 'rolodex-chip is-mini' });
        b.setAttr('title', k);
        b.addEventListener('click', () => { this.selected = k; this.summary = null; this.render(); });
      }
    }

    this.renderAiControls(root, e);
    this.renderTasks(root, e);
    this.renderActivity(root, e);
  }

  private renderAiControls(root: HTMLElement, e: EntityRecord) {
    const row = root.createDiv({ cls: 'rolodex-row' });

    new ButtonComponent(row)
      .setButtonText('🧠 Brief me')
      .setCta()
      .onClick(async () => {
        if (!this.plugin.settings.geminiApiKey) {
          new Notice('Add a Gemini API key in Rolodex settings first');
          return;
        }
        const host = root.querySelector('.rolodex-summary') as HTMLElement;
        host.empty();
        host.createDiv({ text: '🧠 Thinking…', cls: 'rolodex-muted' });
        try {
          this.summary = await summarize(
            this.plugin.settings.geminiApiKey,
            this.plugin.settings.geminiModel,
            this.plugin.settings.defaultPrompt,
            buildContext(e, this.win, this.plugin.index!.entities),
          );
          this.renderSummary(host, e);
        } catch (err) {
          host.empty();
          host.createDiv({
            text: `❌ ${err instanceof Error ? err.message : String(err)}`,
            cls: 'rolodex-error',
          });
        }
      });

    // Works with no API key at all: paste the assembled context wherever you
    // like. The value here is the gathering, not the model.
    new ButtonComponent(row)
      .setButtonText('📋 Copy context')
      .setTooltip('Copy the assembled notes, no API call')
      .onClick(async () => {
        await navigator.clipboard.writeText(buildContext(e, this.win, this.plugin.index!.entities));
        new Notice('Context copied');
      });

    const host = root.createDiv({ cls: 'rolodex-summary' });
    if (this.summary) this.renderSummary(host, e);
  }

  private renderSummary(host: HTMLElement, e: EntityRecord) {
    host.empty();
    if (!this.summary) return;
    const card = host.createDiv({ cls: 'rolodex-card' });
    const bar = card.createDiv({ cls: 'rolodex-card-head' });
    bar.createSpan({ text: '🧠 Brief' });
    const copy = bar.createEl('button', { text: '📋', cls: 'rolodex-chip is-mini' });
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.summary ?? '');
      new Notice('Copied');
    });
    const bodyEl = card.createDiv();
    void MarkdownRenderer.render(this.app, this.summary, bodyEl, e.notePath ?? '', this);
  }

  private renderTasks(root: HTMLElement, e: EntityRecord) {
    const open = sortTasks(openTasks(e));
    const sec = root.createDiv({ cls: 'rolodex-section' });
    sec.createEl('h4', { text: `Open work (${open.length})` });
    if (!open.length) {
      sec.createDiv({ text: 'Nothing outstanding.', cls: 'rolodex-muted' });
      return;
    }
    const list = sec.createEl('ul', { cls: 'rolodex-tasks' });
    for (const t of open) this.renderTask(list, t);
  }

  private renderTask(list: HTMLElement, t: EntityTask) {
    const li = list.createEl('li', { cls: isOverdue(t) ? 'rolodex-task is-late' : 'rolodex-task' });

    const box = li.createEl('input', { type: 'checkbox' });
    box.addEventListener('change', async () => {
      box.disabled = true;
      const ok = await this.plugin.completeTask(t);
      if (!ok) { box.checked = false; box.disabled = false; return; }
      li.addClass('is-done');
    });

    const text = li.createSpan({ cls: 'rolodex-task-text', text: t.text });
    text.addEventListener('click', () => void this.jumpTo(t));

    const meta = li.createDiv({ cls: 'rolodex-task-meta' });
    if (t.priority && t.priority <= 2) meta.createSpan({ text: t.priority === 1 ? '🔺' : '⏫' });
    if (t.due) {
      meta.createSpan({
        text: isOverdue(t) ? `due ${t.due}` : `due ${t.due}`,
        cls: isOverdue(t) ? 'rolodex-overdue' : '',
      });
    }
    meta.createSpan({ text: t.noteDate, cls: 'rolodex-muted' });
  }

  private async jumpTo(t: EntityTask) {
    const file = this.app.vault.getAbstractFileByPath(t.path);
    if (!(file instanceof TFile)) { new Notice(`${t.path} is gone`); return; }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file, { eState: { line: t.line } });
  }

  private renderActivity(root: HTMLElement, e: EntityRecord) {
    const acts = e.activities.filter(a => !a.date || (a.date >= this.win.from && a.date <= this.win.to));
    const sec = root.createDiv({ cls: 'rolodex-section' });
    sec.createEl('h4', { text: `Notes in window (${acts.length})` });
    if (!acts.length) {
      sec.createDiv({ text: 'Nothing in this window. Widen it above.', cls: 'rolodex-muted' });
      return;
    }
    // Rendering every section of a 3,500-mention account would lock the pane;
    // the rest stay one click away in the source notes.
    for (const a of acts.slice(0, 40)) {
      const card = sec.createDiv({ cls: 'rolodex-card' });
      const bar = card.createDiv({ cls: 'rolodex-card-head' });
      bar.createEl('strong', { text: a.date || '—' });
      bar.createSpan({ text: a.heading, cls: 'rolodex-muted' });
      const bodyEl = card.createDiv();
      void MarkdownRenderer.render(this.app, a.text, bodyEl, a.path, this);
      const foot = card.createDiv({ cls: 'rolodex-card-foot' });
      const link = foot.createEl('a', { text: `📄 ${a.file}`, cls: 'rolodex-link' });
      link.addEventListener('click', ev => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(a.path, '', false);
      });
      for (const other of a.alsoHere.slice(0, 4)) {
        const b = foot.createEl('button', { text: this.nameOf(other), cls: 'rolodex-chip is-mini' });
        b.addEventListener('click', () => { this.selected = other; this.summary = null; this.render(); });
      }
    }
    if (acts.length > 40) {
      sec.createDiv({ text: `+${acts.length - 40} more — narrow the window to see them.`, cls: 'rolodex-muted' });
    }
  }

  /** Focus an entity from a command or another view. */
  show(key: string) {
    this.selected = key;
    this.summary = null;
    this.render();
  }
}
