import {
  App,
  ButtonComponent,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import {
  askChiefOfStaff,
  buildContext,
  buildPortfolioContext,
  executeAiCommand,
  loadPrompt,
  summarize,
} from './ai';
import {
  appendTaskToDailyInbox,
  updateEntityNextStep,
  saveAnswerNote,
  buildGmailDraftUrl,
  buildGoogleCalendarUrl,
  applyTaskUpdates,
  appendSectionToNote,
  appendTaskToNote,
  reclassifyTagInVault,
  saveTwoByTwoReport,
  createOrOpenContactNote,
} from './actions';
import type { TaskUpdateProposal } from './actions';
import {
  findExistingReports,
  parseAccountSupportCases,
  parseAccountWorkloads,
} from './reporting';
import type { WorkloadOpportunity } from './reporting';
import { daysAgoIso, todayIso } from './parse';
import { buildRows, heat, inWindow, isOverdue, openTasks, sortRows, sortTasks } from './select';
import type { SortKey, Window } from './select';
import type {
  ChiefOfStaffActionProposal,
  ChiefOfStaffResult,
  EntityRecord,
  EntityTask,
  PortfolioRow,
  ReportType,
} from './types';
import type RolodexPlugin from './main';
import { renderEcosystemNetwork } from './graph';

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
  private ecosystemMode: 'graph' | 'chips' = 'graph';

  constructor(leaf: WorkspaceLeaf, plugin: RolodexPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.win = { from: daysAgoIso(plugin.settings.defaultDays), to: todayIso() };
  }

  getViewType() {
    return VIEW_TYPE_ROLODEX;
  }
  getDisplayText() {
    return 'Cockpit: Executive Chief of Staff';
  }
  getIcon() {
    return 'layout-dashboard';
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
        '👔 Ask Chief of Staff: e.g. "What should I do next on Amgen?", "Draft reply on FoldRun", "Fix Vector opps"...',
    });

    const actionBtn = actionRow.createEl('button', {
      text: '⚡ Execute',
      cls: 'rolodex-chip is-cta rolodex-action-btn',
    });

    const chipsRow = actionWrap.createDiv({ cls: 'rolodex-chips rolodex-quick-prompts' });
    const quickPrompts = [
      { label: '👔 Chief of Staff Brief', query: 'Provide a full situation briefing, diagnostic review, and recommended interventions.' },
      { label: '🚨 Unblock & Fix Vector', query: 'Identify active blockers in CaseChat and missing Vector CRM workloads, then propose fixes.' },
      { label: '✉️ Draft Follow-up', query: 'Draft an executive follow-up email to unblock pending commitments.' },
      { label: '📅 Schedule Sync', query: 'Propose a working session invite and agenda for key stakeholders.' },
    ];

    for (const qp of quickPrompts) {
      const chip = chipsRow.createEl('button', {
        text: qp.label,
        cls: 'rolodex-chip is-mini rolodex-quick-chip',
      });
      chip.addEventListener('click', () => {
        actionInput.value = qp.query;
        void runAction();
      });
    }

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
          this.app,
          this.plugin.settings.geminiApiKey,
          this.plugin.settings.geminiModel,
          val,
          currentEntity,
          idx ? idx.entities : new Map(),
          this.win,
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
      if (e.key === 'Enter') void runAction();
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

    // 4. Chief of Staff Dispatch
    else if (res.type === 'chief_of_staff' && res.chiefOfStaff) {
      this.renderChiefOfStaffDispatch(card, res.chiefOfStaff, onSuccess);
    }

    // 5. Simple message
    else {
      const body = card.createDiv({ cls: 'rolodex-proposal-body' });
      body.createDiv({ text: res.message || 'Action executed successfully.' });
    }
  }

  /** Renders the full Chief of Staff Dispatch: Diagnostic Review, Situation Brief, and Turnkey Interventions. */
  private renderChiefOfStaffDispatch(
    card: HTMLElement,
    cos: ChiefOfStaffResult,
    onSuccess: () => void,
  ) {
    const dispatch = card.createDiv({ cls: 'cockpit-chief-dispatch' });

    // 1. Diagnostic Review Banner
    const diag = cos.diagnosticReview;
    const banner = dispatch.createDiv({
      cls: `cockpit-diag-banner is-${diag.healthStatus || 'neutral'}`,
    });
    const bannerTop = banner.createDiv({ cls: 'cockpit-diag-top' });
    const badgeLabel =
      diag.healthStatus === 'critical'
        ? '🚨 CRITICAL ATTENTION'
        : diag.healthStatus === 'caution'
        ? '⚠️ ATTENTION NEEDED'
        : diag.healthStatus === 'healthy'
        ? '🛡️ STRONG POSTURE'
        : 'ℹ️ CHIEF OF STAFF ASSESSMENT';
    bannerTop.createSpan({ text: badgeLabel, cls: 'cockpit-diag-badge' });
    bannerTop.createSpan({ text: diag.headline, cls: 'cockpit-diag-headline' });

    if (diag.findings?.length) {
      const fList = banner.createEl('ul', { cls: 'cockpit-diag-findings' });
      for (const f of diag.findings) {
        fList.createEl('li', { text: f });
      }
    }
    if (diag.blindSpots?.length) {
      const bList = banner.createDiv({ cls: 'cockpit-diag-blindspots' });
      for (const bs of diag.blindSpots) {
        bList.createDiv({ text: `👁️ Blind Spot: ${bs}`, cls: 'cockpit-diag-blindspot-item' });
      }
    }

    // 2. Executive Situation Brief
    const briefSection = dispatch.createDiv({ cls: 'cockpit-chief-brief-sec' });
    briefSection.createEl('h4', { text: '📋 Executive Situation Brief', cls: 'cockpit-chief-sec-title' });
    const briefContent = briefSection.createDiv({ cls: 'cockpit-chief-brief-content markdown-rendered' });
    void MarkdownRenderer.render(this.app, cos.situationBrief, briefContent, '', this.plugin);

    briefContent.querySelectorAll('a.internal-link').forEach((linkEl) => {
      linkEl.addEventListener('click', (ev) => {
        ev.preventDefault();
        const target = (linkEl as HTMLElement).getAttribute('data-href') || linkEl.textContent || '';
        if (target) void this.app.workspace.openLinkText(target, '', false);
      });
    });

    // 3. Action Proposals Deck
    if (cos.actionProposals?.length) {
      const actionsSec = dispatch.createDiv({ cls: 'cockpit-chief-actions-sec' });
      actionsSec.createEl('h4', { text: '⚡ Recommended Interventions & Execution Levers', cls: 'cockpit-chief-sec-title' });
      const grid = actionsSec.createDiv({ cls: 'cockpit-chief-actions-grid' });

      for (const p of cos.actionProposals) {
        const pCard = grid.createDiv({ cls: `cockpit-action-card is-${p.type}` });
        const pHead = pCard.createDiv({ cls: 'cockpit-action-head' });
        pHead.createSpan({ text: p.title, cls: 'cockpit-action-title' });
        if (p.description) {
          pCard.createDiv({ text: p.description, cls: 'cockpit-action-desc' });
        }

        const pBody = pCard.createDiv({ cls: 'cockpit-action-body' });

        // A. Email Draft Proposal
        if (p.type === 'email_draft' && p.email) {
          const em = p.email;
          const preview = pBody.createDiv({ cls: 'cockpit-preview-box' });
          preview.createDiv({ text: `To: ${em.to}`, cls: 'cockpit-preview-meta' });
          preview.createDiv({ text: `Subject: ${em.subject}`, cls: 'cockpit-preview-meta' });
          preview.createEl('pre', { text: em.body, cls: 'cockpit-preview-text' });

          const bRow = pCard.createDiv({ cls: 'rolodex-row' });
          const openGmailBtn = bRow.createEl('button', {
            text: '🚀 Open in Gmail',
            cls: 'rolodex-chip is-cta',
          });
          openGmailBtn.addEventListener('click', () => {
            const url = buildGmailDraftUrl(em.to, em.subject, em.body);
            window.open(url, '_blank');
            new Notice('Opening Gmail draft in browser…');
          });

          const copyBtn = bRow.createEl('button', { text: '📋 Copy Draft', cls: 'rolodex-chip' });
          copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(`To: ${em.to}\nSubject: ${em.subject}\n\n${em.body}`);
            new Notice('Email draft copied to clipboard!');
          });
        }

        // B. Schedule Meeting Proposal
        else if (p.type === 'schedule_meeting' && p.meeting) {
          const mt = p.meeting;
          const preview = pBody.createDiv({ cls: 'cockpit-preview-box' });
          preview.createDiv({ text: `Attendees: ${mt.attendees}`, cls: 'cockpit-preview-meta' });
          preview.createDiv({ text: `Duration: ${mt.durationMinutes} min`, cls: 'cockpit-preview-meta' });
          preview.createEl('pre', { text: mt.agenda, cls: 'cockpit-preview-text' });

          const bRow = pCard.createDiv({ cls: 'rolodex-row' });
          const openCalBtn = bRow.createEl('button', {
            text: '📅 Open in Google Calendar',
            cls: 'rolodex-chip is-cta',
          });
          openCalBtn.addEventListener('click', () => {
            const url = buildGoogleCalendarUrl(mt.title, mt.attendees, mt.agenda, mt.durationMinutes);
            window.open(url, '_blank');
            new Notice('Opening Google Calendar invite in browser…');
          });

          const addCalTaskBtn = bRow.createEl('button', { text: '📥 Add Scheduling Task', cls: 'rolodex-chip' });
          addCalTaskBtn.addEventListener('click', async () => {
            const taskText = `Schedule ${mt.title} with ${mt.attendees}`;
            await appendTaskToDailyInbox(this.app, taskText, '🔺');
            new Notice('Added scheduling task to Today\'s Inbox!');
          });
        }

        // C. Fix in Vector Proposal
        else if (p.type === 'fix_vector' && p.vectorFix) {
          const vf = p.vectorFix;
          const preview = pBody.createDiv({ cls: 'cockpit-preview-box' });
          preview.createDiv({ text: `Opp: ${vf.oppName} (${vf.oppId || 'N/A'})`, cls: 'cockpit-preview-meta' });
          preview.createDiv({ text: `ARR: ${vf.arr} | Stage: ${vf.stage} | Close: ${vf.closeDate}`, cls: 'cockpit-preview-meta' });
          if (vf.nextSteps) {
            preview.createDiv({ text: `Next Step: ${vf.nextSteps}`, cls: 'cockpit-preview-meta' });
          }

          const bRow = pCard.createDiv({ cls: 'rolodex-row' });
          const fixBtn = bRow.createEl('button', {
            text: '⚡ Launch Fix in Vector (CDP)',
            cls: 'rolodex-chip is-cta is-vector-fix',
          });
          fixBtn.addEventListener('click', () => {
            const accName = this.selected ? (this.plugin.index?.entities.get(this.selected)?.name || '') : vf.oppName;
            new VectorFixModal(this.app, accName, {
              id: vf.oppId,
              name: vf.oppName,
              url: '',
              amount: parseFloat(vf.arr.replace(/[^0-9.]/g, '')) || 0,
              amountFormatted: vf.arr,
              closeDate: vf.closeDate,
              stage: vf.stage,
              type: 'New',
              isMissingWorkload: true,
              suggestedFix: `Create Workload (${vf.arr})`,
              fixCommand: vf.command,
            }).open();
          });

          const copyCliBtn = bRow.createEl('button', { text: '📋 Copy CLI', cls: 'rolodex-chip' });
          copyCliBtn.addEventListener('click', async () => {
            const cmd = vf.command || `python3 workload_hygiene.py --opp "${vf.oppId}" --close-date "${vf.closeDate}"`;
            await navigator.clipboard.writeText(cmd);
            new Notice('Copied CLI remediation command!');
          });
        }

        // D. Add Task Proposal
        else if (p.type === 'add_task' && p.task) {
          const t = p.task;
          const preview = pBody.createDiv({ cls: 'cockpit-preview-box' });
          preview.createDiv({ text: `Task: ${t.text}`, cls: 'cockpit-preview-meta' });
          if (t.due) preview.createDiv({ text: `Due: ${t.due}`, cls: 'cockpit-preview-meta' });
          if (t.reason) preview.createDiv({ text: `Rationale: ${t.reason}`, cls: 'cockpit-preview-meta is-muted' });

          const bRow = pCard.createDiv({ cls: 'rolodex-row' });
          const addTaskBtn = bRow.createEl('button', {
            text: '📥 Add to Today\'s Inbox',
            cls: 'rolodex-chip is-cta',
          });
          addTaskBtn.addEventListener('click', async () => {
            addTaskBtn.disabled = true;
            addTaskBtn.setText('⏳ Adding…');
            await appendTaskToDailyInbox(this.app, t.text, t.priority, t.due);
            addTaskBtn.setText('✅ Added to Inbox');
            new Notice('Task added to Today\'s Inbox!');
          });
        }

        // E. Update Next Step Proposal
        else if (p.type === 'update_next_step' && p.nextStep) {
          const ns = p.nextStep;
          const preview = pBody.createDiv({ cls: 'cockpit-preview-box' });
          preview.createEl('pre', { text: ns.text, cls: 'cockpit-preview-text' });
          if (ns.rationale) preview.createDiv({ text: `Rationale: ${ns.rationale}`, cls: 'cockpit-preview-meta is-muted' });

          const bRow = pCard.createDiv({ cls: 'rolodex-row' });
          const commitBtn = bRow.createEl('button', {
            text: '📌 Commit as Authoritative Next Step',
            cls: 'rolodex-chip is-cta',
          });
          commitBtn.addEventListener('click', async () => {
            const e = this.selected ? this.plugin.index?.entities.get(this.selected) : null;
            if (!e?.notePath) {
              new Notice('No dedicated note found for this entity to update.');
              return;
            }
            commitBtn.disabled = true;
            commitBtn.setText('⏳ Updating…');
            const ok = await updateEntityNextStep(this.app, e.notePath, ns.text);
            if (ok) {
              commitBtn.setText('✅ Next Step Updated');
              new Notice(`Updated ## Next Step for ${e.name}!`);
            } else {
              commitBtn.disabled = false;
              commitBtn.setText('⚠️ Failed to update');
            }
          });
        }
      }
    }

    // 4. Global Action Footer
    const footer = dispatch.createDiv({ cls: 'cockpit-chief-footer' });
    const saveAnsBtn = footer.createEl('button', {
      text: '📁 Save Briefing to Answers (~Review/)',
      cls: 'rolodex-chip',
    });
    saveAnsBtn.addEventListener('click', async () => {
      saveAnsBtn.disabled = true;
      saveAnsBtn.setText('⏳ Saving…');
      const entityName = this.selected ? (this.plugin.index?.entities.get(this.selected)?.name || '') : 'Portfolio';
      const ansContent = `### Situation Brief\n\n${cos.situationBrief}\n\n### Diagnostic Verdict\n\n**${cos.diagnosticReview.headline}**\n\n${cos.diagnosticReview.findings.map(f => `- ${f}`).join('\n')}\n`;
      const path = await saveAnswerNote(this.app, entityName, 'Chief of Staff Briefing', ansContent);
      saveAnsBtn.setText('✅ Saved to Answers');
      new Notice(`Filed answer note: ${path}`);
    });
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
        activities: a.activities + r.activities,
      }),
      { open: 0, overdue: 0, activities: 0 },
    );
    const cap = host.createDiv({ cls: 'rolodex-totals' });
    cap.createSpan({ text: `${rows.length} entities` });
    cap.createSpan({ text: `${totals.activities} activities (${this.win})` });
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
      'Activity',
      'Tasks (Late)',
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

    // Activity in window
    const actTd = tr.createEl('td', {
      text: r.activities > 0 ? String(r.activities) : '—',
      cls: r.activities > 0 ? 'rolodex-num rolodex-activity-num rolodex-clickable' : 'rolodex-num rolodex-muted',
      attr: { title: `${r.activities} activities in ${this.win} (click to view)` },
    });
    if (r.activities > 0) {
      actTd.addEventListener('click', (e) => {
        e.preventDefault();
        this.selected = r.key;
        this.summary = null;
        this.render();
      });
    }

    // Tasks (consolidated Open + Late)
    const taskTd = tr.createEl('td', {
      cls: r.open > 0 ? 'rolodex-num rolodex-tasks-cell rolodex-clickable' : 'rolodex-num rolodex-tasks-cell rolodex-muted',
      attr: {
        title: r.open > 0
          ? `${r.open} open tasks${r.overdue > 0 ? ` (${r.overdue} overdue)` : ''} (click to view)`
          : 'No open tasks',
      },
    });
    if (r.open > 0) {
      taskTd.createSpan({ text: String(r.open) });
      if (r.overdue > 0) {
        taskTd.createSpan({
          text: ` (${r.overdue} late)`,
          cls: 'rolodex-overdue',
        });
      }
      taskTd.addEventListener('click', (e) => {
        e.preventDefault();
        this.selected = r.key;
        this.summary = null;
        this.render();
      });
    } else {
      taskTd.setText('—');
    }
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

    // Cockpit Grid: Ecosystem Network Graph (left) & Commercial/Support Intelligence (right)
    const cockpitGrid = root.createDiv({ cls: 'rolodex-cockpit-grid' });
    const graphCol = cockpitGrid.createDiv({ cls: 'rolodex-cockpit-graph-col' });
    const intelCol = cockpitGrid.createDiv({ cls: 'rolodex-cockpit-intel-col' });

    // Ecosystem Network Graph & Connected Entities
    renderEcosystemNetwork(graphCol, e, this.plugin.index, {
      onSelectEntity: (k) => {
        this.selected = k;
        this.summary = null;
        this.render();
      },
      onOpenNote: (pathOrTitle) => {
        void this.app.workspace.openLinkText(pathOrTitle, '', false);
      },
      hasNote: (target) => {
        return !!this.app.metadataCache.getFirstLinkpathDest(target, '');
      },
      onCreateContact: async (name, company) => {
        const path = await createOrOpenContactNote(this.app, name, company);
        new Notice(`Created contact note: ${name}`);
        await this.app.workspace.openLinkText(path, '', false);
      },
      getNoteTitle: (target) => {
        const file = this.app.metadataCache.getFirstLinkpathDest(target, '');
        return file ? file.basename : null;
      },
      currentMode: this.ecosystemMode,
      onToggleMode: (mode) => {
        this.ecosystemMode = mode;
        this.render();
      },
    });

    void this.loadCommercialAndSupportPulse(cockpitGrid, intelCol, e);

    this.renderAiControls(root, e);
    this.renderTasks(root, e);
    this.renderActivity(root, e);
  }

  private async loadCommercialAndSupportPulse(
    cockpitGrid: HTMLElement,
    intelCol: HTMLElement,
    e: EntityRecord,
  ) {
    if (e.type.toLowerCase() !== 'customer') {
      intelCol.remove();
      return;
    }

    const [casesData, pipeline] = await Promise.all([
      parseAccountSupportCases(this.app, e.name),
      parseAccountWorkloads(this.app, e.name),
    ]);

    const openCases = casesData.openCases;
    const resolvedCases = casesData.resolvedCases;
    const hasOpenCases = openCases.length > 0;
    const hasResolvedCases = resolvedCases.length > 0;
    const hasPipeline = !!(pipeline && (pipeline.opps.length > 0 || pipeline.totalPipeline > 0));

    if (!hasOpenCases && !hasResolvedCases && !hasPipeline) {
      intelCol.remove();
      return;
    }

    cockpitGrid.addClass('has-intel');
    intelCol.empty();

    const panel = intelCol.createDiv({ cls: 'rolodex-intel-panel' });

    // 1. Cases:
    // If open cases exist -> render Urgent / Open cases alert block
    if (hasOpenCases) {
      const casesBlock = panel.createDiv({ cls: 'rolodex-intel-block is-cases' });
      const head = casesBlock.createDiv({ cls: 'rolodex-intel-block-header' });
      const title = head.createDiv({ cls: 'rolodex-intel-block-title' });
      title.createSpan({ text: '🚨 Support Cases', cls: 'rolodex-intel-title-text' });
      title.createSpan({
        text: `${openCases.length} open`,
        cls: 'rolodex-chip is-mini rolodex-case-count-chip',
      });
      if (hasResolvedCases) {
        title.createSpan({
          text: `${resolvedCases.length} resolved`,
          cls: 'rolodex-chip is-mini rolodex-case-resolved-chip',
          attr: { title: `${resolvedCases.length} historical resolved cases in ledger` },
        });
      }

      const list = casesBlock.createDiv({ cls: 'rolodex-intel-cases-list' });
      for (const c of openCases) {
        const card = list.createDiv({ cls: 'rolodex-case-card' });
        const top = card.createDiv({ cls: 'rolodex-case-card-top' });

        const link = top.createEl('a', {
          text: `#${c.caseNumber}`,
          cls: 'rolodex-case-num-link',
          attr: { title: `${c.status} (Owner: ${c.owner})` },
        });
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (c.url) window.open(c.url, '_blank');
          else void this.app.workspace.openLinkText(c.filePath || 'Reporting/Dashboards/Support Cases.md', '', false);
        });

        top.createSpan({
          text: c.priority,
          cls: `rolodex-case-pri-badge is-${c.priority.toLowerCase()}`,
        });

        if (c.age) {
          top.createSpan({ text: c.age, cls: 'rolodex-case-age' });
        }

        const bottom = card.createDiv({ cls: 'rolodex-case-details' });
        bottom.createSpan({ text: c.product, cls: 'rolodex-case-product' });
        if (c.owner) {
          bottom.createSpan({ text: ` · ${c.owner}`, cls: 'rolodex-case-owner' });
        }
      }

      const foot = casesBlock.createDiv({ cls: 'rolodex-intel-block-footer' });
      const targetCasePath = casesData.filePath || 'Reporting/Dashboards/Support Cases.md';
      const targetCaseLabel = casesData.filePath && !casesData.filePath.endsWith('Support Cases.md')
        ? `${e.name} Cases ↗`
        : 'Support Cases.md ↗';
      const dashLink = foot.createEl('a', {
        text: targetCaseLabel,
        cls: 'rolodex-intel-dashboard-link',
      });
      dashLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(targetCasePath, '', false);
      });
    } else if (hasResolvedCases) {
      // Reassuring status block showing 0 open and recent historical resolved cases
      const casesBlock = panel.createDiv({ cls: 'rolodex-intel-block is-cases-healthy' });
      const head = casesBlock.createDiv({ cls: 'rolodex-intel-block-header' });
      const title = head.createDiv({ cls: 'rolodex-intel-block-title' });
      title.createSpan({ text: '🛡️ Support Health', cls: 'rolodex-intel-title-text' });
      title.createSpan({
        text: '0 open',
        cls: 'rolodex-chip is-mini rolodex-case-healthy-chip',
      });
      title.createSpan({
        text: `${resolvedCases.length} resolved`,
        cls: 'rolodex-chip is-mini rolodex-case-resolved-chip',
        attr: { title: `${resolvedCases.length} historical resolved cases in ledger` },
      });

      const list = casesBlock.createDiv({ cls: 'rolodex-intel-cases-list' });
      for (const c of resolvedCases.slice(0, 2)) {
        const card = list.createDiv({ cls: 'rolodex-case-card is-resolved' });
        const top = card.createDiv({ cls: 'rolodex-case-card-top' });

        const link = top.createEl('a', {
          text: `#${c.caseNumber}`,
          cls: 'rolodex-case-num-link',
          attr: { title: `Resolved ${c.resolvedDate || ''} (Owner: ${c.owner})` },
        });
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          if (c.url) window.open(c.url, '_blank');
          else void this.app.workspace.openLinkText(c.filePath || 'Reporting/Dashboards/Support Cases.md', '', false);
        });

        top.createSpan({
          text: 'Resolved',
          cls: 'rolodex-case-pri-badge is-resolved',
        });

        if (c.resolvedDate) {
          top.createSpan({ text: c.resolvedDate, cls: 'rolodex-case-age' });
        }

        const bottom = card.createDiv({ cls: 'rolodex-case-details' });
        bottom.createSpan({ text: c.product, cls: 'rolodex-case-product' });
        if (c.notes) {
          bottom.createSpan({ text: ` · ${c.notes}`, cls: 'rolodex-case-owner' });
        }
      }

      const foot = casesBlock.createDiv({ cls: 'rolodex-intel-block-footer' });
      const targetCasePath = casesData.filePath || 'Reporting/Dashboards/Support Cases.md';
      const targetCaseLabel = casesData.filePath && !casesData.filePath.endsWith('Support Cases.md')
        ? `${e.name} Case History ↗`
        : 'Support Cases.md ↗';
      const dashLink = foot.createEl('a', {
        text: targetCaseLabel,
        cls: 'rolodex-intel-dashboard-link',
      });
      dashLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(targetCasePath, '', false);
      });
    }

    // 2. Followed by Pipeline
    if (pipeline && hasPipeline) {
      const pipeBlock = panel.createDiv({ cls: 'rolodex-intel-block is-pipeline' });
      const head = pipeBlock.createDiv({ cls: 'rolodex-intel-block-header' });
      const title = head.createDiv({ cls: 'rolodex-intel-block-title' });
      title.createSpan({ text: '💼 Pipeline', cls: 'rolodex-intel-title-text' });

      const sumRow = pipeBlock.createDiv({ cls: 'rolodex-pipeline-summary-bar' });
      sumRow.createSpan({
        text: pipeline.totalPipelineFormatted,
        cls: 'rolodex-pipeline-total-val',
      });
      sumRow.createSpan({
        text: `(${pipeline.opps.length} ${pipeline.opps.length === 1 ? 'opp' : 'opps'})`,
        cls: 'rolodex-pipeline-opp-count',
      });

      if (pipeline.missingWorkloadCount > 0) {
        const warn = sumRow.createSpan({
          text: `🔴 ${pipeline.missingWorkloadCount} missing WL`,
          cls: 'rolodex-chip is-mini rolodex-missing-wl-chip',
          attr: { title: 'Missing workloads detected. Click to open Workloads.md' },
        });
        warn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          void this.app.workspace.openLinkText('Reporting/Dashboards/Workloads.md', '', false);
        });
      }

      if (pipeline.opps.length > 0) {
        const oppList = pipeBlock.createDiv({ cls: 'rolodex-intel-opp-list' });
        for (const opp of pipeline.opps) {
          const card = oppList.createDiv({ cls: 'rolodex-opp-card' });
          const oppTop = card.createDiv({ cls: 'rolodex-opp-top' });

          const link = oppTop.createEl('a', {
            text: opp.name,
            cls: 'rolodex-opp-name',
            attr: { title: `${opp.name} (${opp.stage})` },
          });
          link.addEventListener('click', (ev) => {
            ev.preventDefault();
            if (opp.url) window.open(opp.url, '_blank');
            else void this.app.workspace.openLinkText('Reporting/Dashboards/Workloads.md', '', false);
          });

          oppTop.createSpan({ text: opp.amountFormatted, cls: 'rolodex-opp-amount' });

          const oppBottom = card.createDiv({ cls: 'rolodex-opp-bottom' });
          oppBottom.createSpan({ text: opp.stage, cls: 'rolodex-opp-stage' });
          if (opp.closeDate) {
            oppBottom.createSpan({ text: ` · Closes ${opp.closeDate}`, cls: 'rolodex-opp-date' });
          }
          if (opp.isMissingWorkload) {
            oppBottom.createSpan({ text: '🔴 No WL', cls: 'rolodex-opp-missing-badge' });
          }

          if (opp.suggestedFix) {
            const oppFixRow = card.createDiv({ cls: 'rolodex-opp-fix-row' });
            const fixTextEl = oppFixRow.createSpan({
              text: `💡 ${opp.suggestedFix}`,
              cls: 'rolodex-opp-fix-text',
            });
            fixTextEl.setAttribute('title', opp.suggestedFix);
            const fixBtn = oppFixRow.createEl('button', {
              text: '⚡ Fix in Vector',
              cls: 'rolodex-chip is-mini rolodex-fix-vector-btn',
            });
            fixBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              new VectorFixModal(this.app, e.name, opp).open();
            });
          }
        }
      }

      const foot = pipeBlock.createDiv({ cls: 'rolodex-intel-block-footer' });
      const targetPath = pipeline.filePath || 'Reporting/Dashboards/Workloads.md';
      const targetLabel = pipeline.filePath && !pipeline.filePath.endsWith('Workloads.md')
        ? `${e.name} Workloads ↗`
        : 'Workloads.md ↗';
      const dashLink = foot.createEl('a', {
        text: targetLabel,
        cls: 'rolodex-intel-dashboard-link',
      });
      dashLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(targetPath, '', false);
      });
    }
  }

  private renderAiControls(root: HTMLElement, e: EntityRecord) {
    const existingReports = findExistingReports(this.app, e);
    if (existingReports.length > 0) {
      const shelf = root.createDiv({ cls: 'rolodex-reports-shelf' });
      shelf.createSpan({ text: '📁 Existing 2x2 Reports:', cls: 'rolodex-reports-shelf-title' });
      const chipList = shelf.createDiv({ cls: 'rolodex-chips' });
      for (const rep of existingReports) {
        const icon = rep.isRisk ? '⚠️' : '📄';
        const btn = chipList.createEl('button', {
          text: `${icon} ${rep.label}`,
          cls: 'rolodex-chip is-report',
          attr: { title: `Open report: ${rep.dateRange}` },
        });
        btn.addEventListener('click', () => {
          void this.app.workspace.openLinkText(rep.path, '', false);
        });
      }
    }

    const row = root.createDiv({ cls: 'rolodex-row' });
    new ButtonComponent(row)
      .setButtonText('👔 Chief of Staff Brief')
      .setCta()
      .setTooltip('Diagnostic health review, risk scan, and turnkey email/meeting/Vector action proposals')
      .onClick(() => this.triggerChiefOfStaffBrief(e));

    new ButtonComponent(row)
      .setButtonText('🧠 Executive Brief')
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

  private async triggerChiefOfStaffBrief(e: EntityRecord) {
    if (!this.plugin.settings.geminiApiKey) {
      new Notice('Add a Gemini API key in Cockpit settings first');
      return;
    }

    const host = this.body().querySelector('.rolodex-summary') as HTMLElement | null;
    if (!host) return;
    host.empty();
    host.createDiv({ text: '👔 Chief of Staff analyzing posture, telemetry, and commitments…', cls: 'rolodex-muted' });

    try {
      const res = await askChiefOfStaff(
        this.app,
        this.plugin.settings.geminiApiKey,
        this.plugin.settings.geminiModel,
        `Provide an executive situation briefing, diagnostic health review, and proactive turnkey execution proposals for ${e.type}/${e.name}.`,
        e,
        this.plugin.index ? this.plugin.index.entities : new Map(),
        this.win,
      );
      host.empty();
      const card = host.createDiv({ cls: 'rolodex-proposal-card' });
      const head = card.createDiv({ cls: 'rolodex-proposal-head' });
      head.createSpan({ text: `👔 Chief of Staff Dispatch: ${e.name}`, cls: 'rolodex-proposal-title' });
      const closeBtn = head.createEl('button', { text: '✕', cls: 'rolodex-chip is-mini' });
      closeBtn.addEventListener('click', () => host.empty());
      this.renderChiefOfStaffDispatch(card, res, () => host.empty());
    } catch (err: any) {
      host.empty();
      host.createDiv({
        text: `⚠️ Error: ${err.message || String(err)}`,
        cls: 'rolodex-error',
      });
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

    // Filter to active window if possible, fallback to all activities
    const inWin = e.activities.filter((a) => inWindow(a.date, this.win));
    const toShow = inWin.length > 0 ? inWin : e.activities;

    const sec = root.createDiv({ cls: 'rolodex-section' });
    const headerRow = sec.createDiv({ cls: 'rolodex-section-header-row' });
    const countText = inWin.length > 0 ? `${inWin.length}` : `${e.activities.length} past`;
    headerRow.createEl('h4', { text: `Recent Activity (${countText})` });

    if (inWin.length === 0 && e.activities.length > 0) {
      headerRow.createSpan({
        text: 'No notes in selected window — showing earlier activity',
        cls: 'rolodex-muted',
      });
    }

    for (const a of toShow.slice(0, 15)) {
      const card = sec.createDiv({ cls: 'rolodex-activity-card' });

      // Meta header bar
      const meta = card.createDiv({ cls: 'rolodex-activity-meta' });
      if (a.date) {
        meta.createSpan({ text: a.date, cls: 'rolodex-activity-date' });
      }

      const fileLink = meta.createEl('a', {
        text: `📄 ${a.file}`,
        cls: 'rolodex-activity-file',
      });
      fileLink.addEventListener('click', (ev) => {
        ev.preventDefault();
        void this.app.workspace.openLinkText(a.path, '', false);
      });

      if (a.heading) {
        meta.createSpan({
          text: `› ${a.heading}`,
          cls: 'rolodex-activity-heading',
          attr: { title: a.heading },
        });
      }

      if (a.alsoHere && a.alsoHere.length > 0) {
        const chips = meta.createDiv({ cls: 'rolodex-activity-chips' });
        for (const other of a.alsoHere.slice(0, 3)) {
          chips.createSpan({
            text: this.nameOf(other),
            cls: 'rolodex-chip is-mini',
          });
        }
      }

      // Clean raw text: strip leading heading line if it mirrors the heading or tags
      let cleaned = a.text.trim();
      const lines = cleaned.split('\n');
      if (lines.length > 1 && /^#{1,6}\s+/.test(lines[0])) {
        cleaned = lines.slice(1).join('\n').trim();
      }

      const isLong = cleaned.split('\n').length > 5 || cleaned.length > 300;
      const body = card.createDiv({
        cls: isLong ? 'rolodex-activity-body is-clamped' : 'rolodex-activity-body',
      });

      MarkdownRenderer.render(
        this.app,
        cleaned || '*(Section contains no additional text)*',
        body,
        a.path,
        this.plugin,
      );

      if (isLong) {
        const foot = card.createDiv({ cls: 'rolodex-activity-foot' });
        const toggle = foot.createEl('button', {
          text: 'Show full note ▾',
          cls: 'rolodex-activity-toggle',
        });
        let expanded = false;
        toggle.addEventListener('click', () => {
          expanded = !expanded;
          if (expanded) {
            body.removeClass('is-clamped');
            toggle.setText('Show less ▴');
          } else {
            body.addClass('is-clamped');
            toggle.setText('Show full note ▾');
          }
        });
      }
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
    if (key.startsWith('person/')) {
      return key
        .slice(7)
        .split(/\s+/)
        .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
        .join(' ');
    }
    const other = this.plugin.index?.entities.get(key);
    return other ? other.name : key;
  }
}

export class VectorFixModal extends Modal {
  private accountName: string;
  private opp: WorkloadOpportunity;

  constructor(app: App, accountName: string, opp: WorkloadOpportunity) {
    super(app);
    this.accountName = accountName;
    this.opp = opp;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('rolodex-vector-modal-container');

    // Header
    const header = contentEl.createDiv({ cls: 'rolodex-vector-modal-header' });
    header.createEl('h3', { text: '⚡ Vector Workload Remediation' });
    header.createSpan({ text: 'AI Hygiene Action', cls: 'rolodex-chip is-mini is-accent' });

    // Description / Subtitle
    contentEl.createEl('p', {
      text: `Remediate Vector CRM data hygiene for ${this.accountName} via automated browser actions (CDP) or direct CLI execution.`,
      cls: 'rolodex-vector-modal-intro',
    });

    // Details Grid
    const detailsGrid = contentEl.createDiv({ cls: 'rolodex-vector-details-grid' });

    const createRow = (label: string, value: string, isLink = false, href = '') => {
      const row = detailsGrid.createDiv({ cls: 'rolodex-vector-details-row' });
      row.createSpan({ text: label, cls: 'rolodex-vector-row-label' });
      if (isLink && href) {
        const link = row.createEl('a', { text: value, cls: 'rolodex-vector-row-value is-link' });
        link.addEventListener('click', (ev) => {
          ev.preventDefault();
          window.open(href, '_blank');
        });
      } else {
        row.createSpan({ text: value, cls: 'rolodex-vector-row-value' });
      }
    };

    createRow('Account', this.accountName);
    createRow('Opportunity', this.opp.name, !!this.opp.url, this.opp.url);
    if (this.opp.id) {
      createRow('Opportunity ID', this.opp.id);
    }
    createRow('Pipeline ARR', this.opp.amountFormatted);
    createRow('Opportunity Stage', this.opp.stage);
    createRow('Target Close Date', this.opp.closeDate || 'None');
    createRow('Workload Status', this.opp.isMissingWorkload ? '🔴 Missing Workload' : '🟡 Review Alignment');
    createRow('Proposed Fix', this.opp.suggestedFix || 'Create Workload in Vector');

    // Command preview box
    const cmdSection = contentEl.createDiv({ cls: 'rolodex-vector-cmd-section' });
    cmdSection.createEl('h4', { text: 'Execution Command (Browser / CDP Automation)' });
    const cmdBox = cmdSection.createEl('pre', { cls: 'rolodex-vector-cmd-box' });
    const cmdText = this.opp.fixCommand || `python3 ~/.gemini/skills/ce-workload-advisor/scripts/workload_hygiene.py --id ${this.opp.id || '<OPP_ID>'} --arr ${Math.round(this.opp.amount)} --stage "0-2: Tech Eval/Solution Dev" --production-date ${this.opp.closeDate} --next-steps "Initial technical evaluation and architecture kickoff"`;
    cmdBox.createEl('code', { text: cmdText });

    // Output / log container for live execution
    const outputBox = contentEl.createDiv({ cls: 'rolodex-vector-output-box' });
    outputBox.style.display = 'none';

    // Action buttons container
    const actions = contentEl.createDiv({ cls: 'rolodex-vector-actions' });

    // Button 1: Copy CLI Command
    const copyCmdBtn = actions.createEl('button', {
      text: '📋 Copy CLI Command',
      cls: 'rolodex-chip rolodex-vector-action-btn',
    });
    copyCmdBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(cmdText);
      new Notice('Copied Vector CLI command to clipboard!');
    });

    // Button 2: Copy AI Prompt
    const copyAiPromptBtn = actions.createEl('button', {
      text: '🤖 Copy AI Agent Prompt',
      cls: 'rolodex-chip rolodex-vector-action-btn',
    });
    copyAiPromptBtn.addEventListener('click', () => {
      const prompt = `/workload-advisor Fix Salesforce Vector workload for opportunity "${this.opp.name}" (ID: ${this.opp.id || ''}) for ${this.accountName}. Proposed fix: ${this.opp.suggestedFix || 'Create Workload'}. Execute via Chrome CDP.`;
      void navigator.clipboard.writeText(prompt);
      new Notice('Copied AI prompt to clipboard!');
    });

    // Button 3: Open in Vector
    if (this.opp.url) {
      const openVectorBtn = actions.createEl('button', {
        text: '↗️ Open in Vector',
        cls: 'rolodex-chip rolodex-vector-action-btn',
      });
      openVectorBtn.addEventListener('click', () => {
        window.open(this.opp.url, '_blank');
      });
    }

    // Button 4: Run Fix in Chrome (CDP) if Node child_process is available
    let cp: any = null;
    try {
      cp = (window as any).require ? (window as any).require('child_process') : null;
    } catch {}

    if (cp && this.opp.fixCommand) {
      const runBtn = actions.createEl('button', {
        text: '⚡ Run Fix in Chrome (CDP)',
        cls: 'rolodex-chip is-accent rolodex-vector-action-btn',
      });
      runBtn.addEventListener('click', () => {
        outputBox.style.display = 'block';
        outputBox.empty();
        outputBox.createEl('div', {
          text: '⏳ Executing workload_hygiene.py via Chrome CDP (port 9222)...',
          cls: 'rolodex-vector-status-running',
        });
        runBtn.disabled = true;

        const execCmd = `${cmdText} --execute`;
        const envPath = (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin';
        cp.exec(execCmd, { env: { ...process.env, PATH: envPath } }, (err: any, stdout: string, stderr: string) => {
          runBtn.disabled = false;
          outputBox.empty();
          if (err) {
            outputBox.createEl('div', {
              text: `⚠️ Execution failed or Chrome CDP not connected on port 9222:\n${stderr || err.message}\n\nPlease ensure Chrome is started with remote debugging, or copy the command above and run it in your terminal.`,
              cls: 'rolodex-vector-status-error',
            });
          } else {
            outputBox.createEl('div', {
              text: `✅ Workload successfully updated in Vector!\n${stdout}`,
              cls: 'rolodex-vector-status-success',
            });
            new Notice('Vector workload hygiene update succeeded!');
          }
        });
      });
    }

    // Close button
    const closeBtn = actions.createEl('button', {
      text: 'Close',
      cls: 'rolodex-chip rolodex-vector-action-btn',
    });
    closeBtn.addEventListener('click', () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

