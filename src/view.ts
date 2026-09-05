import {
  ButtonComponent,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import {
  buildContext,
  buildPortfolioContext,
  executeAiCommand,
  loadPrompt,
  summarize,
} from './ai';
import {
  applyTaskUpdates,
  appendSectionToNote,
  appendTaskToNote,
  reclassifyTagInVault,
  saveTwoByTwoReport,
} from './actions';
import type { TaskUpdateProposal } from './actions';
import { daysAgoIso, todayIso } from './parse';
import { buildRows, heat, isOverdue, openTasks, sortRows, sortTasks } from './select';
import type { SortKey, Window } from './select';
import type { EntityRecord, EntityTask, PortfolioRow, ReportType } from './types';
import type RolodexPlugin from './main';

export const VIEW_TYPE_ROLODEX = 'rolodex-view';

const PRESETS: Array<[string, number]> = [
  ['Last 7 days', 7],
  ['Last 30 days', 30],
  ['Last 90 days', 90],
  ['Last year', 365],
  ['All time', 0],
];

export class RolodexView extends ItemView {
  private plugin: RolodexPlugin;
  private win: Window;
  private types: string[] = [];
  private sort: SortKey = 'attention';
  private query = '';
  private openOnly = true;
  private selected: string | null = null;
  private summary: string | null = null;
  private entityReportPath: string | null = null;
  private entityReportTitle: string | null = null;
  private portfolioReport: {
    title: string;
    content: string;
    savedPath: string;
  } | null = null;
  private actionLoading = false;

  constructor(leaf: WorkspaceLeaf, plugin: RolodexPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.win = { from: daysAgoIso(plugin.settings.defaultDays), to: todayIso() };
  }

  getViewType() {
    return VIEW_TYPE_ROLODEX;
  }
  getDisplayText() {
    return 'Rolodex: Executive Cockpit';
  }
  getIcon() {
    return 'contact';
  }

  async onOpen() {
    await this.plugin.ensureIndex();
    this.render();
  }

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

  // ── Controls & AI Action Bar ─────────────────────────────────

  private renderControls(root: HTMLElement) {
    const bar = root.createDiv({ cls: 'rolodex-bar' });

    const title = bar.createDiv({ cls: 'rolodex-title' });
    title.createSpan({ text: '🗂 Rolodex: Executive Cockpit' });
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

    // Central AI Action Command Bar
    const actionWrap = root.createDiv({ cls: 'rolodex-action-wrap' });
    const actionRow = actionWrap.createDiv({ cls: 'rolodex-action-row' });

    const actionInput = actionRow.createEl('input', {
      type: 'text',
      cls: 'rolodex-action-input',
      placeholder:
        '💬 Ask AI: e.g. "Change IMTS to Conference", "Clean up stale tasks for Amgen"...',
    });

    const actionBtn = actionRow.createEl('button', {
      text: '⚡ Execute',
      cls: 'rolodex-chip is-cta rolodex-action-btn',
    });

    const proposalHost = actionWrap.createDiv({ cls: 'rolodex-proposal-host' });

    const runAction = async () => {
      const val = actionInput.value.trim();
      if (!val) return;
      proposalHost.empty();
      actionBtn.disabled = true;
      actionBtn.setText('⏳ Running…');

      try {
        const currentEntity = this.selected && idx ? idx.entities.get(this.selected) ?? null : null;
        const res = await executeAiCommand(
          this.plugin.settings.geminiApiKey,
          this.plugin.settings.geminiModel,
          val,
          currentEntity,
          idx ? idx.entities : new Map(),
        );

        this.renderActionProposal(proposalHost, res, () => {
          actionInput.value = '';
          proposalHost.empty();
        });
      } catch (err: any) {
        proposalHost.createDiv({
          text: `⚠️ Error: ${err.message || String(err)}`,
          cls: 'rolodex-error',
        });
      } finally {
        actionBtn.disabled = false;
        actionBtn.setText('⚡ Execute');
      }
    };

    actionBtn.addEventListener('click', runAction);
    actionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runAction();
    });

    // Time window preset dropdown
    const winRow = root.createDiv({ cls: 'rolodex-row' });
    const preset = winRow.createEl('select', { cls: 'dropdown' });
    for (const [label, days] of PRESETS) {
      const opt = preset.createEl('option', { text: label, value: String(days) });
      const from = days ? daysAgoIso(days) : '';
      if ((days === 0 && !this.win.from) || (days !== 0 && this.win.from === from)) {
        opt.selected = true;
      }
    }
    preset.addEventListener('change', () => {
      const days = Number(preset.value);
      this.win = { from: days ? daysAgoIso(days) : '0000-01-01', to: todayIso() };
      this.summary = null;
      this.render();
    });

    // Entity type filter chips
    if (idx) {
      const typeChips = root.createDiv({ cls: 'rolodex-chips' });
      const allBtn = typeChips.createEl('button', {
        text: `All (${idx.entities.size})`,
        cls: this.types.length === 0 ? 'rolodex-chip is-on' : 'rolodex-chip',
      });
      allBtn.addEventListener('click', () => {
        this.types = [];
        this.render();
      });

      for (const [t, n] of idx.typesSeen) {
        const on = this.types.includes(t);
        const b = typeChips.createEl('button', {
          text: `${t} (${n})`,
          cls: on ? 'rolodex-chip is-on' : 'rolodex-chip',
        });
        b.addEventListener('click', () => {
          this.types = on ? this.types.filter((x) => x !== t) : [...this.types, t];
          this.render();
        });
      }
    }
  }

  /** Renders the confirmation/diff proposal returned by an AI command. */
  private renderActionProposal(
    host: HTMLElement,
    res: any,
    onSuccess: () => void,
  ) {
    host.empty();
    const card = host.createDiv({ cls: 'rolodex-proposal-card' });

    const head = card.createDiv({ cls: 'rolodex-proposal-head' });
    head.createSpan({ text: res.title || 'AI Action Proposal', cls: 'rolodex-proposal-title' });

    const closeBtn = head.createEl('button', { text: '✕', cls: 'rolodex-chip is-mini' });
    closeBtn.addEventListener('click', () => {
      host.closest('tr.rolodex-row-proposal-tr')?.remove();
      host.empty();
    });

    // 1. Reclassify Tag Proposal
    if (res.type === 'reclassify' && res.reclassify) {
      const { oldType, oldName, newType, newName } = res.reclassify;
      const targetName = newName || oldName;

      const body = card.createDiv({ cls: 'rolodex-proposal-body' });
      body.createDiv({
        text: `Reclassify all occurrences of #${oldType}/${oldName} to #${newType}/${targetName} across the entire vault.`,
      });

      const btnRow = card.createDiv({ cls: 'rolodex-row' });
      const applyBtn = btnRow.createEl('button', {
        text: `⚡ Apply Reclassification to #${newType}/${targetName}`,
        cls: 'rolodex-chip is-cta',
      });

      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        applyBtn.setText('⏳ Processing…');
        const results = await reclassifyTagInVault(
          this.app,
          oldType,
          oldName,
          newType,
          targetName,
        );
        const totalOccurrences = results.reduce((acc, r) => acc + r.count, 0);
        new Notice(
          `Reclassified #${oldType}/${oldName} ➔ #${newType}/${targetName} (${totalOccurrences} occurrences in ${results.length} files).`,
        );
        await this.plugin.rescan();
        onSuccess();
        this.render();
      });
    }

    // 2. Task Updates Proposal
    else if (res.type === 'task_updates' && res.taskUpdates?.length) {
      const updates: TaskUpdateProposal[] = res.taskUpdates;
      const body = card.createDiv({ cls: 'rolodex-proposal-body' });
      body.createDiv({
        text: `Found ${updates.length} task(s) proposed for cleanup:`,
        cls: 'rolodex-muted',
      });

      const list = body.createEl('ul', { cls: 'rolodex-proposal-list' });
      const checkedStates = updates.map(() => true);

      updates.forEach((u, i) => {
        const item = list.createEl('li', { cls: 'rolodex-proposal-item' });
        const cb = item.createEl('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => {
          checkedStates[i] = cb.checked;
        });

        const tagBadge = item.createSpan({
          text: u.newStatus === 'done' ? '✓ DONE' : '✗ CANCEL',
          cls: u.newStatus === 'done' ? 'rolodex-badge is-done' : 'rolodex-badge is-cancel',
        });
        item.createSpan({ text: ` ${u.currentText}`, cls: 'rolodex-task-text' });
        if (u.reason) {
          item.createSpan({ text: ` (${u.reason})`, cls: 'rolodex-muted' });
        }
      });

      const btnRow = card.createDiv({ cls: 'rolodex-row' });
      const applyBtn = btnRow.createEl('button', {
        text: `⚡ Apply Task Cleanups`,
        cls: 'rolodex-chip is-cta',
      });

      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        applyBtn.setText('⏳ Applying…');
        const selectedUpdates = updates.filter((_, i) => checkedStates[i]);
        const count = await applyTaskUpdates(this.app, selectedUpdates);
        new Notice(`Updated ${count} tasks across the vault.`);
        await this.plugin.rescan();
        onSuccess();
        this.render();
      });
    }

    // 3. Draft / Output Response
    else if (res.type === 'draft' && res.draft) {
      const body = card.createDiv({ cls: 'rolodex-proposal-body' });
      MarkdownRenderer.render(
        this.app,
        res.draft.content,
        body,
        '',
        this.plugin,
      );

      const btnRow = card.createDiv({ cls: 'rolodex-row' });
      const copyBtn = btnRow.createEl('button', {
        text: '📋 Copy to Clipboard',
        cls: 'rolodex-chip',
      });
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(res.draft.content);
        new Notice('Copied to clipboard!');
      });

      if (this.selected) {
        const entity = this.plugin.index?.entities.get(this.selected);
        if (entity?.notePath) {
          const appendBtn = btnRow.createEl('button', {
            text: `📌 Save to ${entity.name}.md`,
            cls: 'rolodex-chip is-cta',
          });
          appendBtn.addEventListener('click', async () => {
            await appendSectionToNote(
              this.app,
              entity.notePath!,
              res.draft.heading || 'AI Output',
              res.draft.content,
            );
            new Notice(`Appended to ${entity.notePath}`);
          });
        }
      }
    }

    // 4. Simple message
    else {
      const body = card.createDiv({ cls: 'rolodex-proposal-body' });
      body.createDiv({ text: res.message || 'Action executed successfully.' });
    }
  }

  // ── Portfolio View ───────────────────────────────────────────

  private renderPortfolio(root: HTMLElement) {
    const idx = this.plugin.index;
    if (!idx) {
      root.createDiv({ text: 'Scanning…', cls: 'rolodex-muted' });
      return;
    }

    const reportsRow = root.createDiv({ cls: 'rolodex-row rolodex-report-triggers' });
    reportsRow.createSpan({ text: 'Executive 2x2: ', cls: 'rolodex-muted' });
    new ButtonComponent(reportsRow)
      .setButtonText('📅 Weekly 2x2')
      .setTooltip('Generate weekly 2x2 for active window and log to Reporting/2x2/weekly/')
      .onClick(() => this.triggerPortfolioTwoByTwo('weekly_2x2'));
    new ButtonComponent(reportsRow)
      .setButtonText('🗓️ Monthly 2x2')
      .setTooltip('Generate monthly 2x2 for active window and log to Reporting/2x2/monthly/')
      .onClick(() => this.triggerPortfolioTwoByTwo('monthly_2x2'));

    const portReportHost = root.createDiv({ cls: 'rolodex-portfolio-report' });
    if (this.portfolioReport) {
      this.renderPortfolioReportCard(portReportHost, this.portfolioReport);
    }

    const tools = root.createDiv({ cls: 'rolodex-row' });
    const search = tools.createEl('input', {
      type: 'search',
      placeholder: 'Filter by name or key…',
    });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderTableOnly(root);
    });

    const sort = tools.createEl('select', { cls: 'dropdown' });
    const opts: Array<[SortKey, string]> = [
      ['attention', 'Needs attention'],
      ['recent', 'Most recent'],
      ['open', 'Most open tasks'],
      ['activity', 'Most activity'],
      ['name', 'Name'],
    ];
    for (const [k, label] of opts) {
      const o = sort.createEl('option', { text: label, value: k });
      if (k === this.sort) o.selected = true;
    }
    sort.addEventListener('change', () => {
      this.sort = sort.value as SortKey;
      this.renderTableOnly(root);
    });

    const openToggle = tools.createEl('button', {
      text: this.openOnly ? '⚡ Open work only' : 'All entities',
      cls: this.openOnly ? 'rolodex-chip is-on is-cta' : 'rolodex-chip',
    });
    openToggle.addEventListener('click', () => {
      this.openOnly = !this.openOnly;
      openToggle.setText(this.openOnly ? '⚡ Open work only' : 'All entities');
      openToggle.className = this.openOnly ? 'rolodex-chip is-on is-cta' : 'rolodex-chip';
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
    if (this.openOnly) {
      rows = rows.filter((r) => r.open > 0);
    }

    const q = this.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q),
      );
    }

    if (!rows.length) {
      host.createDiv({ text: this.openOnly ? 'No entities with open tasks in this window.' : 'Nothing in this window.', cls: 'rolodex-muted' });
      return;
    }

    const totals = rows.reduce(
      (a, r) => ({
        open: a.open + r.open,
        overdue: a.overdue + r.overdue,
      }),
      { open: 0, overdue: 0 },
    );
    const cap = host.createDiv({ cls: 'rolodex-totals' });
    cap.createSpan({ text: `${rows.length} entities` });
    cap.createSpan({ text: `${totals.open} open tasks` });
    if (totals.overdue) {
      cap.createSpan({ text: `${totals.overdue} overdue`, cls: 'rolodex-overdue' });
    }

    const table = host.createEl('table', { cls: 'rolodex-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const h of [
      '',
      'Customer / Entity',
      'Last Touch',
      'Open',
      'Late',
      'Quick Action',
    ]) {
      head.createEl('th', { text: h });
    }

    const tbody = table.createEl('tbody');
    for (const r of rows) this.renderRow(tbody, r);
  }

  private renderRow(tbody: HTMLElement, r: PortfolioRow) {
    const tr = tbody.createEl('tr');

    // Health Dot Indicator
    const dotCell = tr.createEl('td', { cls: 'rolodex-health-cell' });
    const days = this.daysSince(r.lastSeen);
    let healthClass = 'is-active';
    let healthTitle = 'Active (<7d)';
    if (days > 21) {
      healthClass = 'is-quiet';
      healthTitle = `Quiet (${days}d ago — attention recommended)`;
    } else if (days > 7) {
      healthClass = 'is-warm';
      healthTitle = `Warm (${days}d ago)`;
    }
    dotCell.createSpan({
      cls: `rolodex-health-dot ${healthClass}`,
      attr: { title: healthTitle },
    });

    // Name + Type
    const nameCell = tr.createEl('td');
    const link = nameCell.createEl('a', { text: r.name, cls: 'rolodex-link' });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      this.selected = r.key;
      this.summary = null;
      this.render();
    });
    nameCell.createEl('small', { text: ` ${r.type}`, cls: 'rolodex-muted' });

    // Last Touch
    tr.createEl('td', {
      text: r.lastSeen ? (days === 0 ? 'Today' : `${days}d ago`) : '—',
      cls: 'rolodex-muted',
    });

    // Deliverables
    tr.createEl('td', { text: String(r.open), cls: 'rolodex-num' });
    tr.createEl('td', {
      text: r.overdue ? String(r.overdue) : '—',
      cls: r.overdue ? 'rolodex-num rolodex-overdue' : 'rolodex-num rolodex-muted',
    });

    // Quick Action (Inline Ask AI input + Execute + Brief)
    const actCell = tr.createEl('td', { cls: 'rolodex-act-cell' });
    const actWrap = actCell.createDiv({ cls: 'rolodex-row-action-wrap' });

    const rowInput = actWrap.createEl('input', {
      type: 'text',
      cls: 'rolodex-row-action-input',
      placeholder: `Ask AI for ${r.name}…`,
    });

    const rowBtn = actWrap.createEl('button', {
      text: '⚡',
      cls: 'rolodex-chip is-mini is-cta rolodex-row-btn',
      attr: { title: `Run AI action for ${r.name} (e.g. "tag is wrong, it's a conference")` },
    });

    const briefBtn = actWrap.createEl('button', {
      text: '🧠',
      cls: 'rolodex-chip is-mini rolodex-row-btn',
      attr: { title: `Executive Briefing for ${r.name}` },
    });

    const twoByTwoBtn = actWrap.createEl('button', {
      text: '📊',
      cls: 'rolodex-chip is-mini rolodex-row-btn',
      attr: { title: `Generate 2x2 Report for ${r.name}` },
    });

    let proposalTr: HTMLElement | null = null;

    const runRowAction = async () => {
      const val = rowInput.value.trim();
      if (!val) return;

      if (proposalTr) {
        proposalTr.remove();
        proposalTr = null;
      }

      // If user typed "brief me" or "summarize", trigger briefing directly
      if (/^(?:brief(?:\s+me)?|summarize|overview)$/i.test(val)) {
        this.selected = r.key;
        this.summary = null;
        this.render();
        this.triggerBriefing();
        return;
      }

      // If user typed "2x2" or "report", trigger 2x2 directly
      if (/^(?:2x2|report|two by two)$/i.test(val)) {
        this.selected = r.key;
        this.summary = null;
        this.render();
        const entity = this.plugin.index?.entities.get(r.key);
        if (entity) this.triggerEntityTwoByTwo(entity);
        return;
      }

      // If user typed "risk" or "risk 2x2", trigger risk matrix directly
      if (/^(?:risk|risk 2x2|risk matrix)$/i.test(val)) {
        this.selected = r.key;
        this.summary = null;
        this.render();
        const entity = this.plugin.index?.entities.get(r.key);
        if (entity) this.triggerEntityRiskMatrix(entity);
        return;
      }

      // Insert proposal row right after this tr
      proposalTr = tbody.createEl('tr', { cls: 'rolodex-row-proposal-tr' });
      tr.insertAdjacentElement('afterend', proposalTr);
      const hostTd = proposalTr.createEl('td', { attr: { colspan: '6' } });

      hostTd.createDiv({
        text: `⏳ Analyzing "${val}" for ${r.name}…`,
        cls: 'rolodex-muted',
      });
      rowBtn.disabled = true;

      try {
        const idx = this.plugin.index;
        const currentEntity = idx?.entities.get(r.key) ?? null;

        const res = await executeAiCommand(
          this.plugin.settings.geminiApiKey,
          this.plugin.settings.geminiModel,
          val,
          currentEntity,
          idx ? idx.entities : new Map(),
        );

        hostTd.empty();
        this.renderActionProposal(hostTd, res, () => {
          rowInput.value = '';
          if (proposalTr) {
            proposalTr.remove();
            proposalTr = null;
          }
        });
      } catch (err: any) {
        hostTd.empty();
        hostTd.createDiv({
          text: `⚠️ Error: ${err.message || String(err)}`,
          cls: 'rolodex-error',
        });
      } finally {
        rowBtn.disabled = false;
      }
    };

    rowBtn.addEventListener('click', runRowAction);
    rowInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runRowAction();
    });

    briefBtn.addEventListener('click', async () => {
      this.selected = r.key;
      this.summary = null;
      this.entityReportPath = null;
      this.entityReportTitle = null;
      this.render();
      this.triggerBriefing();
    });

    twoByTwoBtn.addEventListener('click', async () => {
      this.selected = r.key;
      this.summary = null;
      this.entityReportPath = null;
      this.entityReportTitle = null;
      this.render();
      const entity = this.plugin.index?.entities.get(r.key);
      if (entity) this.triggerEntityTwoByTwo(entity);
    });
  }

  // ── Entity Detail View ───────────────────────────────────────

  private renderEntity(root: HTMLElement, key: string) {
    const e = this.plugin.index?.entities.get(key);
    if (!e) {
      root.createDiv({ text: `${key} is no longer in the index.`, cls: 'rolodex-muted' });
      this.selected = null;
      this.summary = null;
      this.entityReportPath = null;
      this.entityReportTitle = null;
      return;
    }

    const head = root.createDiv({ cls: 'rolodex-entity-head' });
    const back = head.createEl('button', { text: '← All Entities', cls: 'rolodex-chip' });
    back.addEventListener('click', () => {
      this.selected = null;
      this.summary = null;
      this.entityReportPath = null;
      this.entityReportTitle = null;
      this.render();
    });

    head.createEl('h3', { text: e.name });

    // Type chip with interactive Reclassify button
    const typeWrap = head.createSpan({ cls: 'rolodex-type-wrap' });
    typeWrap.createEl('small', { text: e.type, cls: 'rolodex-muted' });
    const reclassBtn = typeWrap.createEl('button', {
      text: '✏️ Reclassify',
      cls: 'rolodex-chip is-mini',
      attr: { title: `Change ${e.name} to another type (e.g. Conference)` },
    });
    reclassBtn.addEventListener('click', async () => {
      const newType = prompt(`Reclassify ${e.name} from "${e.type}" to:`, 'Conference');
      if (newType && newType.trim() && newType.trim() !== e.type) {
        reclassBtn.disabled = true;
        reclassBtn.setText('⏳ Updating…');
        const results = await reclassifyTagInVault(
          this.app,
          e.type,
          e.name,
          newType.trim(),
        );
        const total = results.reduce((acc, r) => acc + r.count, 0);
        new Notice(
          `Reclassified ${e.name} to #${newType.trim()}/${e.name} (${total} occurrences).`,
        );
        await this.plugin.rescan();
        this.selected = `${newType.trim().toLowerCase()}/${e.name.toLowerCase()}`;
        this.render();
      }
    });

    if (e.notePath) {
      const open = head.createEl('button', { text: '📄 Note', cls: 'rolodex-chip' });
      open.addEventListener('click', () => void this.app.workspace.openLinkText(e.notePath!, '', false));
    }

    const stats = root.createDiv({ cls: 'rolodex-totals' });
    const open = openTasks(e);
    const late = open.filter((t) => isOverdue(t)).length;
    stats.createSpan({ text: `${open.length} open` });
    if (late) stats.createSpan({ text: `${late} overdue`, cls: 'rolodex-overdue' });
    stats.createSpan({ text: `in ${e.noteCount} notes` });
    stats.createSpan({ text: `${e.firstSeen || '?'} → ${e.lastSeen || '?'}` });

    // Filtered Related Stakeholders / Focus
    const related = [...e.related.entries()]
      .filter(([k]) => {
        const other = this.plugin.index?.entities.get(k);
        return !other || other.type.toLowerCase() !== e.type.toLowerCase();
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    if (related.length) {
      const relRow = root.createDiv({ cls: 'rolodex-chips' });
      relRow.createSpan({ text: 'Focus & Collaborators: ', cls: 'rolodex-muted' });
      for (const [k, n] of related) {
        const b = relRow.createEl('button', {
          text: `${this.nameOf(k)} ${n}`,
          cls: 'rolodex-chip is-mini',
        });
        b.setAttr('title', k);
        b.addEventListener('click', () => {
          this.selected = k;
          this.summary = null;
          this.render();
        });
      }
    }

    this.renderAiControls(root, e);
    this.renderTasks(root, e);
    this.renderActivity(root, e);
  }

  private renderAiControls(root: HTMLElement, e: EntityRecord) {
    const row = root.createDiv({ cls: 'rolodex-row' });
    new ButtonComponent(row)
      .setButtonText('🧠 Executive Brief')
      .setCta()
      .onClick(() => this.triggerBriefing());

    const isProject = e.type.toLowerCase() === 'project';
    const reportBtnText = isProject ? '📊 Project 2x2' : '📊 Customer 2x2';
    new ButtonComponent(row)
      .setButtonText(reportBtnText)
      .onClick(() => this.triggerEntityTwoByTwo(e));

    new ButtonComponent(row)
      .setButtonText('⚠️ Risk 2x2')
      .setTooltip('Generate Probability vs Impact Risk & Opportunity 2x2 matrix')
      .onClick(() => this.triggerEntityRiskMatrix(e));

    const host = root.createDiv({ cls: 'rolodex-summary' });
    if (this.summary) {
      this.renderExecutiveBrief(
        host,
        this.summary,
        e,
        this.entityReportPath,
        this.entityReportTitle || 'Executive Brief',
      );
    }
  }

  private async triggerBriefing() {
    if (!this.selected) return;
    const e = this.plugin.index?.entities.get(this.selected);
    if (!e) return;

    if (!this.plugin.settings.geminiApiKey) {
      new Notice('Add a Gemini API key in Rolodex settings first');
      return;
    }

    const host = this.body().querySelector('.rolodex-summary') as HTMLElement | null;
    if (!host) return;
    host.empty();
    host.createDiv({ text: '🧠 Synthesizing executive brief…', cls: 'rolodex-muted' });

    try {
      const prompt = await loadPrompt(
        this.app,
        'brief',
        { EntityName: e.name },
        this.plugin.manifest.id,
      );
      this.summary = await summarize(
        this.plugin.settings.geminiApiKey,
        this.plugin.settings.geminiModel,
        prompt || this.plugin.settings.defaultPrompt,
        buildContext(e, this.win, this.plugin.index!.entities),
      );
      this.entityReportPath = null;
      this.entityReportTitle = '🧠 Executive Brief';
      this.renderExecutiveBrief(host, this.summary, e, null, this.entityReportTitle);
    } catch (err: any) {
      host.empty();
      host.createDiv({
        text: `Error: ${err.message || String(err)}`,
        cls: 'rolodex-error',
      });
    }
  }

  private async triggerEntityTwoByTwo(e: EntityRecord) {
    if (!this.plugin.settings.geminiApiKey) {
      new Notice('Add a Gemini API key in Rolodex settings first');
      return;
    }

    const host = this.body().querySelector('.rolodex-summary') as HTMLElement | null;
    if (!host) return;
    host.empty();
    host.createDiv({ text: `📊 Synthesizing 2x2 report for ${e.name}…`, cls: 'rolodex-muted' });

    const isProject = e.type.toLowerCase() === 'project';
    const reportType: ReportType = isProject ? 'project_2x2' : 'customer_2x2';
    const scope: 'customer' | 'project' = isProject ? 'project' : 'customer';

    try {
      const prompt = await loadPrompt(
        this.app,
        reportType,
        { EntityName: e.name },
        this.plugin.manifest.id,
      );
      const context = buildContext(e, this.win, this.plugin.index!.entities);
      const content = await summarize(
        this.plugin.settings.geminiApiKey,
        this.plugin.settings.geminiModel,
        prompt,
        context,
      );

      // Save to Reporting/2x2/<scope>/
      const savedPath = await saveTwoByTwoReport(
        this.app,
        scope,
        e.name,
        content,
        this.win.from,
        this.win.to,
      );

      this.summary = content;
      this.entityReportPath = savedPath;
      this.entityReportTitle = isProject ? '📊 Project 2x2' : '📊 Customer 2x2';
      this.renderExecutiveBrief(host, content, e, savedPath, this.entityReportTitle);
      new Notice(`2x2 saved to ${savedPath}`);
    } catch (err: any) {
      host.empty();
      host.createDiv({
        text: `Error: ${err.message || String(err)}`,
        cls: 'rolodex-error',
      });
    }
  }

  private async triggerEntityRiskMatrix(e: EntityRecord) {
    if (!this.plugin.settings.geminiApiKey) {
      new Notice('Add a Gemini API key in Rolodex settings first');
      return;
    }

    const host = this.body().querySelector('.rolodex-summary') as HTMLElement | null;
    if (!host) return;
    host.empty();
    host.createDiv({ text: `⚠️ Analyzing Risk & Opportunity 2x2 for ${e.name}…`, cls: 'rolodex-muted' });

    const isProject = e.type.toLowerCase() === 'project';
    const scope: 'customer' | 'project' = isProject ? 'project' : 'customer';

    try {
      const prompt = await loadPrompt(
        this.app,
        'risk_2x2',
        { EntityName: e.name },
        this.plugin.manifest.id,
      );
      const context = buildContext(e, this.win, this.plugin.index!.entities);
      const content = await summarize(
        this.plugin.settings.geminiApiKey,
        this.plugin.settings.geminiModel,
        prompt,
        context,
      );

      // Save to Reporting/2x2/<scope>/
      const savedPath = await saveTwoByTwoReport(
        this.app,
        scope,
        `${e.name}_Risk`,
        content,
        this.win.from,
        this.win.to,
      );

      this.summary = content;
      this.entityReportPath = savedPath;
      this.entityReportTitle = `⚠️ Risk & Opportunity 2x2`;
      this.renderExecutiveBrief(host, content, e, savedPath, this.entityReportTitle);
      new Notice(`Risk 2x2 saved to ${savedPath}`);
    } catch (err: any) {
      host.empty();
      host.createDiv({
        text: `Error: ${err.message || String(err)}`,
        cls: 'rolodex-error',
      });
    }
  }

  private async triggerPortfolioTwoByTwo(reportType: 'weekly_2x2' | 'monthly_2x2') {
    const idx = this.plugin.index;
    if (!idx) return;

    if (!this.plugin.settings.geminiApiKey) {
      new Notice('Add a Gemini API key in Rolodex settings first');
      return;
    }

    const isWeekly = reportType === 'weekly_2x2';
    const from = isWeekly ? daysAgoIso(7) : daysAgoIso(30);
    const to = todayIso();
    const scope = isWeekly ? 'weekly' : 'monthly';
    const reportTitle = isWeekly ? `📅 Weekly 2x2 (${from} to ${to})` : `🗓️ Monthly 2x2 (${from} to ${to})`;

    const host = this.body().querySelector('.rolodex-portfolio-report') as HTMLElement | null;
    if (!host) return;
    host.empty();
    host.createDiv({ text: `⏳ Synthesizing ${reportTitle} across portfolio…`, cls: 'rolodex-muted' });

    try {
      const prompt = await loadPrompt(
        this.app,
        reportType,
        { StartDate: from, EndDate: to },
        this.plugin.manifest.id,
      );
      const context = buildPortfolioContext({ from, to }, idx.entities);
      const content = await summarize(
        this.plugin.settings.geminiApiKey,
        this.plugin.settings.geminiModel,
        prompt,
        context,
      );

      // Auto-save to Reporting/2x2/<scope>/
      const savedPath = await saveTwoByTwoReport(
        this.app,
        scope,
        `${from}_to_${to}`,
        content,
        from,
        to,
      );

      this.portfolioReport = {
        title: reportTitle,
        content,
        savedPath,
      };

      this.renderPortfolioReportCard(host, this.portfolioReport);
      new Notice(`2x2 saved to ${savedPath}`);
    } catch (err: any) {
      host.empty();
      host.createDiv({
        text: `Error: ${err.message || String(err)}`,
        cls: 'rolodex-error',
      });
    }
  }

  private renderPortfolioReportCard(
    host: HTMLElement,
    report: { title: string; content: string; savedPath: string },
  ) {
    host.empty();
    const card = host.createDiv({ cls: 'rolodex-brief-card' });

    const head = card.createDiv({ cls: 'rolodex-brief-head' });
    head.createSpan({ text: report.title, cls: 'rolodex-brief-title' });

    const actions = head.createDiv({ cls: 'rolodex-brief-actions' });

    const openBtn = actions.createEl('button', {
      text: '📄 Open Saved Note',
      cls: 'rolodex-chip is-mini is-cta',
    });
    openBtn.addEventListener('click', () => {
      void this.app.workspace.openLinkText(report.savedPath, '', false);
    });

    const copyBtn = actions.createEl('button', {
      text: '📋 Copy',
      cls: 'rolodex-chip is-mini',
    });
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(report.content);
      new Notice('Copied report to clipboard');
    });

    const dismissBtn = actions.createEl('button', {
      text: '✕ Dismiss',
      cls: 'rolodex-chip is-mini',
    });
    dismissBtn.addEventListener('click', () => {
      this.portfolioReport = null;
      host.empty();
    });

    const savedBadge = card.createDiv({ cls: 'rolodex-saved-badge' });
    savedBadge.createSpan({ text: '📁 Logged to: ' });
    const link = savedBadge.createEl('a', { text: report.savedPath });
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      void this.app.workspace.openLinkText(report.savedPath, '', false);
    });

    const body = card.createDiv({ cls: 'rolodex-brief-body' });
    MarkdownRenderer.render(this.app, report.content, body, '', this.plugin);
  }

  private renderExecutiveBrief(
    host: HTMLElement,
    summary: string,
    e: EntityRecord,
    savedPath?: string | null,
    titlePrefix = 'Executive Brief',
  ) {
    host.empty();
    const card = host.createDiv({ cls: 'rolodex-brief-card' });

    const head = card.createDiv({ cls: 'rolodex-brief-head' });
    head.createSpan({ text: `${titlePrefix}: ${e.name}`, cls: 'rolodex-brief-title' });

    const actions = head.createDiv({ cls: 'rolodex-brief-actions' });

    if (savedPath) {
      const openBtn = actions.createEl('button', {
        text: '📄 Open Saved Note',
        cls: 'rolodex-chip is-mini is-cta',
      });
      openBtn.addEventListener('click', () => {
        void this.app.workspace.openLinkText(savedPath, '', false);
      });
    }

    // Save to Today's Note
    const saveTodayBtn = actions.createEl('button', {
      text: '📌 Save to Daily Note',
      cls: 'rolodex-chip is-mini',
    });
    saveTodayBtn.addEventListener('click', async () => {
      const todayPath = `~Daily/${todayIso()}.md`;
      const ok = await appendSectionToNote(
        this.app,
        todayPath,
        `${titlePrefix}: ${e.name}`,
        summary,
      );
      if (ok) new Notice(`Saved to ${todayPath}`);
      else new Notice(`Could not find ${todayPath}`);
    });

    // Save to Customer Page
    if (e.notePath) {
      const saveCustBtn = actions.createEl('button', {
        text: '📄 Save to Page',
        cls: 'rolodex-chip is-mini',
      });
      saveCustBtn.addEventListener('click', async () => {
        await appendSectionToNote(
          this.app,
          e.notePath!,
          `${titlePrefix} (${todayIso()})`,
          summary,
        );
        new Notice(`Saved to ${e.notePath}`);
      });
    }

    // Copy Button
    const copyBtn = actions.createEl('button', {
      text: '📋 Copy',
      cls: 'rolodex-chip is-mini',
    });
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(summary);
      new Notice('Briefing copied to clipboard');
    });

    // Dismiss Button
    const dismissBtn = actions.createEl('button', {
      text: '✕',
      cls: 'rolodex-chip is-mini',
    });
    dismissBtn.addEventListener('click', () => {
      this.summary = null;
      this.entityReportPath = null;
      this.entityReportTitle = null;
      host.empty();
    });

    if (savedPath) {
      const savedBadge = card.createDiv({ cls: 'rolodex-saved-badge' });
      savedBadge.createSpan({ text: '📁 Logged to: ' });
      const link = savedBadge.createEl('a', { text: savedPath });
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(savedPath, '', false);
      });
    }

    const body = card.createDiv({ cls: 'rolodex-brief-body' });
    MarkdownRenderer.render(this.app, summary, body, '', this.plugin);
  }

  private renderTasks(root: HTMLElement, e: EntityRecord) {
    const open = sortTasks(openTasks(e));
    if (!open.length) return;

    const sec = root.createDiv({ cls: 'rolodex-section' });
    sec.createEl('h4', { text: `Open Tasks (${open.length})` });

    const list = sec.createEl('ul', { cls: 'rolodex-tasks' });
    for (const t of open) {
      const li = list.createEl('li', {
        cls: isOverdue(t) ? 'rolodex-task is-late' : 'rolodex-task',
      });

      const cb = li.createEl('input', { type: 'checkbox' });
      cb.addEventListener('change', async () => {
        if (cb.checked) {
          await applyTaskUpdates(this.app, [
            {
              path: t.path,
              line: t.line,
              currentText: t.text,
              newStatus: 'done',
            },
          ]);
          new Notice('Task marked done!');
          await this.plugin.rescan();
          this.render();
        }
      });

      li.createSpan({ cls: 'rolodex-task-text', text: t.text });
      const meta = li.createDiv({ cls: 'rolodex-task-meta' });
      if (t.due) {
        meta.createSpan({
          text: `due ${t.due}`,
          cls: isOverdue(t) ? 'rolodex-overdue' : '',
        });
      }
      if (t.heading) meta.createSpan({ text: t.heading, cls: 'rolodex-muted' });
    }
  }

  private renderActivity(root: HTMLElement, e: EntityRecord) {
    if (!e.activities.length) return;

    const sec = root.createDiv({ cls: 'rolodex-section' });
    sec.createEl('h4', { text: 'Recent Activity' });

    for (const a of e.activities.slice(0, 15)) {
      const item = sec.createDiv({ cls: 'rolodex-activity-item' });
      const meta = item.createDiv({ cls: 'rolodex-activity-meta' });
      meta.createSpan({ text: a.date || 'Undated' });
      const link = meta.createEl('a', { text: a.file });
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(a.path, '', false);
      });
      if (a.heading) meta.createSpan({ text: ` > ${a.heading}`, cls: 'rolodex-muted' });

      item.createDiv({ text: a.text, cls: 'rolodex-activity-text' });
    }
  }

  private daysSince(iso: string): number {
    if (!iso) return 999;
    const then = new Date(iso).getTime();
    const now = new Date(todayIso()).getTime();
    return Math.max(0, Math.floor((now - then) / 86400000));
  }

  private nameOf(key: string): string {
    if (key.startsWith('link/')) return `[[${key.slice(5)}]]`;
    const other = this.plugin.index?.entities.get(key);
    return other ? other.name : key;
  }
}
