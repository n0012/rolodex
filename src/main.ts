import {
  App, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf,
} from 'obsidian';
import { buildIndex } from './scanner';
import { todayIso } from './parse';
import { ensurePromptFiles } from './ai';
import { RolodexView, VIEW_TYPE_ROLODEX } from './view';
import { DEFAULT_PROMPT, DEFAULT_SETTINGS } from './types';
import type { EntityTask, RolodexIndex, RolodexSettings } from './types';

const RESCAN_DEBOUNCE_MS = 5_000;

export default class RolodexPlugin extends Plugin {
  settings: RolodexSettings = { ...DEFAULT_SETTINGS };
  index: RolodexIndex | null = null;

  private scanning: Promise<RolodexIndex> | null = null;
  private dirtyTimer: number | undefined;

  async onload() {
    await this.loadSettings();
    await ensurePromptFiles(this.app, this.manifest.id);

    this.registerView(VIEW_TYPE_ROLODEX, leaf => new RolodexView(leaf, this));
    this.addSettingTab(new RolodexSettingTab(this.app, this));
    this.addRibbonIcon('contact', 'Rolodex', () => void this.openView());

    this.addCommand({
      id: 'open',
      name: 'Open Rolodex',
      callback: () => void this.openView(),
    });
    this.addCommand({
      id: 'rescan',
      name: 'Rescan the vault',
      callback: async () => {
        await this.rescan();
        new Notice(`Rolodex: ${this.index?.entities.size ?? 0} entities`);
      },
    });

    // The first scan reads every note, so it waits for layout rather than
    // competing with startup.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('modify', f => this.markDirty(f)));
      this.registerEvent(this.app.vault.on('create', f => this.markDirty(f)));
      this.registerEvent(this.app.vault.on('delete', f => this.markDirty(f)));
      this.registerEvent(this.app.vault.on('rename', f => this.markDirty(f)));
    });
  }

  onunload() {
    if (this.dirtyTimer !== undefined) window.clearTimeout(this.dirtyTimer);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.defaultPrompt?.trim()) this.settings.defaultPrompt = DEFAULT_PROMPT;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // ── Index ────────────────────────────────────────────────────

  /** Build once, then hand the same index to every caller until it is dirtied. */
  async ensureIndex(): Promise<RolodexIndex> {
    if (this.index) return this.index;
    if (this.scanning) return this.scanning;
    return this.rescan();
  }

  async rescan(): Promise<RolodexIndex> {
    // Concurrent callers share one scan; two full passes would be pure waste.
    if (this.scanning) return this.scanning;
    this.scanning = buildIndex(this.app, this.settings)
      .then(idx => { this.index = idx; return idx; })
      .finally(() => { this.scanning = null; });
    return this.scanning;
  }

  private markDirty(file: { path: string }) {
    if (!file.path.endsWith('.md')) return;
    // Debounced: typing in a daily note fires modify on nearly every keystroke,
    // and a full pass costs ~1,600 reads.
    if (this.dirtyTimer !== undefined) window.clearTimeout(this.dirtyTimer);
    this.dirtyTimer = window.setTimeout(() => {
      this.dirtyTimer = undefined;
      void this.rescan().then(() => this.view()?.refresh());
    }, RESCAN_DEBOUNCE_MS);
  }

  // ── View ─────────────────────────────────────────────────────

  private view(): RolodexView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_ROLODEX)[0];
    return leaf?.view instanceof RolodexView ? leaf.view : null;
  }

  async openView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_ROLODEX)[0];
    if (existing) { await this.app.workspace.revealLeaf(existing); return; }
    // Right sidebar on desktop; on phones getRightLeaf returns the single
    // mobile drawer, which is the correct home there too.
    const leaf: WorkspaceLeaf | null = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_ROLODEX, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  // ── Writing back ─────────────────────────────────────────────

  /**
   * Tick a task in its source note. Verifies the line still reads exactly as it
   * did at scan time before touching anything — the index can be minutes old,
   * and writing to a shifted line number would corrupt an unrelated line.
   */
  async completeTask(task: EntityTask): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
      new Notice(`Rolodex: ${task.path} is gone — rescan`);
      return false;
    }
    try {
      await this.app.vault.process(file, content => {
        const lines = content.split('\n');
        let idx = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw);
        if (idx < 0) throw new Error('moved');
        lines[idx] = task.raw
          .replace(/\[[ /]\]/, '[x]')
          .replace(/\s*$/, ` ✅ ${todayIso()}`);
        return lines.join('\n');
      });
    } catch {
      new Notice('Rolodex: that line changed since the last scan — rescanning');
      void this.rescan().then(() => this.view()?.refresh());
      return false;
    }
    // Keep the in-memory copy honest so the pane does not re-offer the task
    // before the debounced rescan lands.
    task.status = 'done';
    task.done = todayIso();
    return true;
  }
}

class RolodexSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: RolodexPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const idx = this.plugin.index;
    const banner = containerEl.createDiv({ cls: 'rolodex-banner' });
    banner.setText(idx
      ? `Indexed ${idx.entities.size} entities across ${idx.scannedFiles} notes.`
      : 'Not scanned yet — open Rolodex to build the index.');
    if (idx) {
      const types = [...idx.typesSeen.entries()].sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t} ${n}`).join(' · ');
      containerEl.createEl('p', { text: types, cls: 'rolodex-muted' });
    }

    new Setting(containerEl).setName('Scope').setHeading();

    new Setting(containerEl)
      .setName('Entity types')
      .setDesc('Tag namespaces to show first, comma separated — Customer, Project, Partner. Leave empty to show every namespace found, most-used first.')
      .addText(t => t
        .setPlaceholder('Customer, Project, Partner')
        .setValue(this.plugin.settings.entityTypes.join(', '))
        .onChange(async v => {
          this.plugin.settings.entityTypes = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Ignored types')
      .setDesc('Namespaces that are not entities — chat, inbox, status tags and the like.')
      .addText(t => t
        .setValue(this.plugin.settings.ignoredTypes.join(', '))
        .onChange(async v => {
          this.plugin.settings.ignoredTypes = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Type aliases')
      .setDesc('Fold a namespace typed inconsistently, as "Projects=Project". Case is already folded automatically — this is only for genuinely different words.')
      .addText(t => t
        .setValue(this.plugin.settings.typeAliases.join(', '))
        .onChange(async v => {
          this.plugin.settings.typeAliases = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Only scan these folders')
      .setDesc('Comma separated. Empty means the whole vault. Matched on a path boundary, so "~Daily" does not also pull in "~DailyMeetings".')
      .addText(t => t
        .setPlaceholder('whole vault')
        .setValue(this.plugin.settings.includeFolders.join(', '))
        .onChange(async v => {
          this.plugin.settings.includeFolders = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Never scan these folders')
      .addText(t => t
        .setValue(this.plugin.settings.excludeFolders.join(', '))
        .onChange(async v => {
          this.plugin.settings.excludeFolders = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Entity note folders')
      .setDesc('Where an entity\'s own page lives — Customers/AcmeCorp.md, Projects/Phoenix.md. Rolodex links to it from the entity header.')
      .addText(t => t
        .setValue(this.plugin.settings.entityNoteFolders.join(', '))
        .onChange(async v => {
          this.plugin.settings.entityNoteFolders = splitList(v);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default window')
      .setDesc('Days of history the pane opens on. Open tasks are always shown regardless — an unclosed commitment does not expire.')
      .addText(t => t
        .setValue(String(this.plugin.settings.defaultDays))
        .onChange(async v => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            this.plugin.settings.defaultDays = Math.floor(n);
            await this.plugin.saveSettings();
          }
        }));

    new Setting(containerEl)
      .setName('Rescan now')
      .setDesc('Rolodex also rescans automatically a few seconds after the vault changes.')
      .addButton(b => b.setButtonText('Rescan').onClick(async () => {
        await this.plugin.rescan();
        this.display();
      }));

    new Setting(containerEl).setName('AI briefings & 2x2 Reports').setHeading();
    containerEl.createEl('p', {
      cls: 'rolodex-muted',
      text: 'Optional. Without a key everything still works — use "Copy context" to paste the assembled notes into any assistant. Prompt templates are stored as editable markdown files in your vault at .obsidian/plugins/rolodex/prompts/ (customer-2x2.md, project-2x2.md, weekly-2x2.md, monthly-2x2.md, briefing.md). You can customize them directly in Obsidian.',
    });

    let keyInput: HTMLInputElement | null = null;
    new Setting(containerEl)
      .setName('Gemini API key')
      .setDesc('From aistudio.google.com. Stored in this plugin\'s data.json inside your vault, so treat the vault as holding a secret.')
      .addText(t => {
        keyInput = t.inputEl;
        t.inputEl.type = 'password';
        t.setPlaceholder('AIza…')
        .setValue(this.plugin.settings.geminiApiKey)
        .onChange(async v => {
          this.plugin.settings.geminiApiKey = v.trim();
          await this.plugin.saveSettings();
        });
    })
    .addExtraButton(b => b.setIcon('eye').setTooltip('Show or hide').onClick(() => {
      if (keyInput) keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    }));

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Any current Gemini model id. The catalog moves; "-latest" aliases age best.')
      .addText(t => t
        .setPlaceholder('gemini-flash-latest')
        .setValue(this.plugin.settings.geminiModel)
        .onChange(async v => {
          this.plugin.settings.geminiModel = v.trim() || DEFAULT_SETTINGS.geminiModel;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Default Briefing Prompt')
      .setDesc('Fallback prompt for executive briefs (also stored in .obsidian/plugins/rolodex/prompts/briefing.md).')
      .addTextArea(t => {
        t.inputEl.rows = 6;
        t.setValue(this.plugin.settings.defaultPrompt)
          .onChange(async v => {
            this.plugin.settings.defaultPrompt = v;
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(async () => {
        this.plugin.settings.defaultPrompt = DEFAULT_PROMPT;
        await this.plugin.saveSettings();
        this.display();
      }));

    new Setting(containerEl)
      .setName('Prompt Templates on Disk')
      .setDesc('Ensure all 5 prompt files (customer-2x2, project-2x2, weekly-2x2, monthly-2x2, briefing) exist in .obsidian/plugins/rolodex/prompts/.')
      .addButton(b => b.setButtonText('Verify / Restore Prompts').onClick(async () => {
        await ensurePromptFiles(this.app, this.plugin.manifest.id);
        new Notice('Verified prompt files in .obsidian/plugins/rolodex/prompts/');
      }));
  }
}

function splitList(v: string): string[] {
  return v.split(',').map(s => s.trim()).filter(Boolean);
}
