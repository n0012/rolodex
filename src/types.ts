/** Shared shapes for the Rolodex index and settings. */

export interface RolodexSettings {
  /** Tag namespaces to treat as entity types, in display order. Empty = every
   *  namespace found in the vault. */
  entityTypes: string[];
  /** Folder prefixes to scan. Empty = the whole vault. */
  includeFolders: string[];
  /** Folder prefixes never scanned, on top of the always-excluded config dir. */
  excludeFolders: string[];
  /** Folders holding one note per entity, e.g. Customers/ or Projects/. Used to
   *  offer "open the account page" for an entity. */
  entityNoteFolders: string[];
  defaultDays: number;
  geminiApiKey: string;
  geminiModel: string;
  defaultPrompt: string;
  /** "Projects=Project" style folds for a namespace typed inconsistently.
   *  Case is folded automatically; this is only for genuinely different words. */
  typeAliases: string[];
  /** Tag namespaces that exist but are not entities — chat threads, inbox
   *  markers and the like. Hidden from the type list without being deleted. */
  ignoredTypes: string[];
}

export const DEFAULT_PROMPT = `You are briefing me before I re-engage with this entity.

Give me, in this order and nothing else:

1. **Where things stand** — 3 sentences, no preamble.
2. **Open commitments** — what I owe them and what they owe me, with dates. Mark anything past due.
3. **What changed recently** — only if the recent notes differ from the older ones.
4. **Risks** — name them concretely; write "none evident" rather than inventing one.
5. **Next step** — a single action I could take this week.

Use only the notes provided. Where you infer rather than read, say so.`;

export const DEFAULT_SETTINGS: RolodexSettings = {
  entityTypes: [],
  includeFolders: [],
  excludeFolders: ['Attachments', 'Template', 'Templates', '.trash'],
  entityNoteFolders: ['Customers', 'Projects', 'Partners', 'Organization'],
  defaultDays: 30,
  geminiApiKey: '',
  geminiModel: 'gemini-flash-latest',
  defaultPrompt: DEFAULT_PROMPT,
  typeAliases: ['Projects=Project', 'Customers=Customer'],
  ignoredTypes: ['chat', 'inbox', 'all', 'slide'],
};

/** Tasks-plugin emoji metadata, parsed off a task line. */
export interface TaskMeta {
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  /** 1 highest (🔺) … 5 lowest (⏬); undefined when unmarked. */
  priority?: number;
  recurrence?: string;
}

export type TaskStatus = 'open' | 'done' | 'cancelled';

export interface EntityTask extends TaskMeta {
  /** Task text with tags and metadata emoji stripped, for display. */
  text: string;
  /** The original line, for writing back a completion. */
  raw: string;
  status: TaskStatus;
  path: string;
  /** 0-based line number in the source file. */
  line: number;
  /** Date attributed to the note this came from (see noteDate). */
  noteDate: string;
  heading: string;
}

export interface EntityActivity {
  date: string;
  heading: string;
  text: string;
  path: string;
  file: string;
  /** Other entity keys mentioned in the same section. */
  alsoHere: string[];
}

export interface EntityRecord {
  /** "Customer/Amgen" — the stable key used everywhere. */
  key: string;
  type: string;
  name: string;
  /** Sub-namespaces seen under this entity, e.g. ISV from #Customer/Pharma/ISV. */
  subs: Set<string>;
  tasks: EntityTask[];
  activities: EntityActivity[];
  /** Entity key -> number of sections shared with this entity. */
  related: Map<string, number>;
  /** Number of notes this entity is tagged in. Not tag occurrences: ten
   *  mentions inside one meeting note are still one note. */
  noteCount: number;
  lastSeen: string;
  firstSeen: string;
  /** Path of a dedicated note for this entity, when one exists. */
  notePath?: string;
}

export interface RolodexIndex {
  entities: Map<string, EntityRecord>;
  /** All type namespaces seen, including ignored ones. */
  typesSeen: Map<string, number>;
  scannedFiles: number;
  builtAt: number;
}

/** A row in the portfolio table, already reduced to the active date window. */
export interface PortfolioRow {
  key: string;
  type: string;
  name: string;
  open: number;
  overdue: number;
  done: number;
  activities: number;
  noteCount: number;
  lastSeen: string;
  related: string[];
  notePath?: string;
}

export interface TaskUpdateProposal {
  path: string;
  line: number;
  currentText: string;
  newStatus: 'done' | 'cancelled' | 'open';
  reason?: string;
}

export interface AiCommandResult {
  type: 'reclassify' | 'task_updates' | 'draft' | 'message';
  title: string;
  reclassify?: {
    oldType: string;
    oldName: string;
    newType: string;
    newName?: string;
  };
  taskUpdates?: TaskUpdateProposal[];
  draft?: {
    heading?: string;
    content: string;
  };
  message?: string;
}
