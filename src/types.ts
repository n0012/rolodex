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

export type ReportType = 'brief' | 'customer_2x2' | 'project_2x2' | 'weekly_2x2' | 'monthly_2x2' | 'risk_2x2';

export interface PromptDefinition {
  id: ReportType;
  filename: string;
  label: string;
  defaultText: string;
}

export const PROMPT_DEFINITIONS: Record<ReportType, PromptDefinition> = {
  brief: {
    id: 'brief',
    filename: 'briefing.md',
    label: 'Executive Brief',
    defaultText: `You are briefing me before I re-engage with this entity.

Give me, in this order and nothing else:

1. **Where things stand** — 3 sentences, no preamble.
2. **Open commitments** — what I owe them and what they owe me, with dates. Mark anything past due.
3. **What changed recently** — only if the recent notes differ from the older ones.
4. **Risks** — name them concretely; write "none evident" rather than inventing one.
5. **Next step** — a single action I could take this week.

Use only the notes provided. Where you infer rather than read, say so.`,
  },
  customer_2x2: {
    id: 'customer_2x2',
    filename: 'customer-2x2.md',
    label: 'Customer 2x2 Report',
    defaultText: `You are an executive business analyst and Google Cloud Customer Engineer lead. Create a concise executive 2x2 matrix and status report for the specified Customer based on the provided notes and activities.

**Methodology & Instructions:**
1. Extract key factors related to both **Opportunities** (commercial momentum, architectural wins, expanded consumption) and **Risks** (blockers, environment access issues, stakeholder friction, procurement delays).
2. Assess both **Impact on Account Success** (High vs Low) and **Urgency/Probability**.
3. Format as a clean 2x2 matrix supported by an executive narrative, key metrics, strategic insights, and Grad Expectations alignment.

Output format (use clean GitHub-flavored markdown):

# 2x2 Report: {EntityName} ({StartDate} to {EndDate})

### Executive Summary
[2-3 punchy sentences summarizing commercial & technical momentum, primary blocker, and key strategic lever.]

---

| **Key Accomplishments & Customer Progress** | **Next Steps & Upcoming Priorities** |
| :--- | :--- |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |
| **Challenges & Blockers** | **Learning & Development** |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |

---

### Key Metrics
* **Interactions**: [Meeting count / key stakeholder engagements]
* **Decisions Made**: [Key architectural / strategic decisions]
* **Products & Workloads Touched**: [Vertex AI, Gemini, BigQuery, Infrastructure, etc.]

### Strategic Insights
* [Bullet points on customer psychology, competitive wedge vs AWS/Azure, partner leverage, or procurement insights]

### Grad Expectations Alignment
* **Customer Impact**: [Concrete value delivered or unblocked revenue]
* **Technical Excellence**: [Architecture, POC, or technical guidance delivered]
* **Leadership & Collaboration**: [Cross-functional orchestration across AE, PSO, product, partners]
* **Strategic Thinking**: [Business alignment, customer psychology, long-term roadmap]
* **Innovation & Problem Solving**: [Novel architectures, creative workarounds, reusable field patterns]`,
  },
  project_2x2: {
    id: 'project_2x2',
    filename: 'project-2x2.md',
    label: 'Project 2x2 Report',
    defaultText: `You are a Principal Solutions Architect. Create a concise 2x2 technical milestone report for the specified Project based on the provided notes and activities.

**Methodology & Instructions:**
1. Analyze project milestones, architecture prototypes, design specs, code commits, and dependencies.
2. Evaluate critical roadblocks (IP constraints, environment bottlenecks, technical debt) and technical learnings.
3. Align deliverables with enterprise adoption, reusable assets, and field enablement.

Output format (use clean GitHub-flavored markdown):

# Project 2x2 Report: {EntityName} ({StartDate} to {EndDate})

### Executive Summary
[2-3 sentences summarizing technical status, architecture progress, and delivery runway.]

---

| **Architecture Progress & Milestones** | **Next Sprints & Technical Priorities** |
| :--- | :--- |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |
| **Technical Roadblocks & Dependencies** | **Architecture Learnings & Tooling** |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |

---

### Key Deliverables & Artifacts
* [PRDs, repos, demo prototypes, design specs completed or in progress]

### Strategic Fit & Ecosystem Impact
* [How this project impacts GCP adoption, reusable assets, or field enablement]

### Grad Expectations Alignment
* **Customer Impact**: [Scalable product home, customer transformation, velocity unlocks]
* **Technical Excellence**: [Pioneering architectures, performance benchmarks, technical rigor]
* **Leadership & Collaboration**: [Cross-team orchestration across Engineering, PSO, Product, CE]
* **Strategic Thinking**: [Workflow-first design, incubation model, market timing]
* **Innovation & Problem Solving**: [Creative solutions to hard constraints, reusable patterns]`,
  },
  weekly_2x2: {
    id: 'weekly_2x2',
    filename: 'weekly-2x2.md',
    label: 'Weekly 2x2 Report',
    defaultText: `You are a Lead Customer Engineer preparing your weekly executive 2x2 status review across your entire book of accounts.

**Methodology & Instructions:**
1. Synthesize cross-account customer touchpoints, workload milestones, partner collaborations, and active blockers.
2. Highlight high-probability wins, critical deal movements, and customer-side dependencies (e.g. environment access, security reviews).

Output format (use clean GitHub-flavored markdown):

# Weekly 2x2 Report: {StartDate} to {EndDate}

### Weekly Executive Summary
[High-level synthesis of major weekly wins, critical deal movements, and primary blockers across the territory.]

---

| **Key Accomplishments Across Accounts** | **Next Week's Priorities & P0s** |
| :--- | :--- |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |
| **Customer & Partner Blockers** | **Technical Learnings & Reusable Assets** |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |

---

### Territory Velocity & Highlights
* **Active Customer Touches**: [Key meetings and accounts engaged]
* **Hygiene & Consumption**: [Workload movements, support case resolutions, quota/deal approvals]

### Key Account Spotlight
* [Brief 1-2 sentence updates on top active accounts]

### Strategic Insights
* [Ecosystem trends, partner synergies, common enterprise blockers observed]

### Grad Expectations Alignment
* **Customer Impact**: [Tangible customer value driven across territory]
* **Technical Excellence**: [Advanced technical patterns or solutions architected]
* **Leadership & Collaboration**: [Internal expert networks and cross-functional teams leveraged]
* **Strategic Thinking**: [Territory pipeline acceleration and proactive opportunity framing]
* **Innovation & Problem Solving**: [Overcoming blockers with creative technical or process paths]`,
  },
  monthly_2x2: {
    id: 'monthly_2x2',
    filename: 'monthly-2x2.md',
    label: 'Monthly 2x2 Report',
    defaultText: `You are an executive Cloud Customer Engineer lead compiling the monthly portfolio 2x2 review for leadership.

**Methodology & Instructions:**
1. Provide a monthly synthesis across accounts, consumption trends, architectural milestones, and operational health.
2. Group accomplishments and strategic focus by customer/project, highlighting major stage migrations and quota impact.

Output format (use clean GitHub-flavored markdown):

# Monthly 2x2 Report: {StartDate} to {EndDate}

### Monthly Executive Summary
[Strategic narrative on monthly quota attainment, consumption trends, significant architecture milestones, and operational health.]

---

| **Major Monthly Wins & Customer Impact** | **Strategic Focus for Next Month** |
| :--- | :--- |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |
| **Critical Territory Blockers & Escalations** | **Skill & Technical Advancements** |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |

---

### Monthly Key Metrics
* **Total Significant Interactions**: [Summary of customer and partner sessions]
* **Key Deal Milestones**: [Stage movements, workloads secured, POCs closed]
* **Escalations Resolved**: [Major cases / capacity issues mitigated]

### Grad Expectations & Leadership Summary
* **Customer Impact**: [Major customer transformations and business value]
* **Technical Excellence**: [Solutions architecture, whitepapers, benchmarks, innovative patterns]
* **Leadership & Culture**: [Mentorship, cross-team enablement, community contributions]
* **Strategic Thinking**: [Long-term territory positioning and customer trust building]
* **Innovation & Problem Solving**: [Scalable assets, field tools, architectural breakthroughs]`,
  },
  risk_2x2: {
    id: 'risk_2x2',
    filename: 'risk-2x2.md',
    label: 'Risk & Opportunity 2x2 Matrix',
    defaultText: `You are an executive business analyst and risk consultant tasked with creating a concise executive summary from provided meeting notes and activity updates. The summary takes the form of a 2x2 matrix, analyzing current status by evaluating potential Opportunities and Risks along Probability and Impact axes.

**Input Analysis Instructions:**
1. **Identify Key Factors**: Extract key factors related to both **Opportunities** (positive developments, potential benefits, revenue expansion) and **Risks** (challenges, roadblocks, customer hesitation, dependency delays).
2. **Assess Impact & Probability**:
   * **Impact on Project/Account Success**: High vs Low
   * **Probability of Occurrence**: High vs Low
3. **Populate Matrix**: Place each factor into the corresponding quadrant using clear bullet points.

Output format (use clean GitHub-flavored markdown):

# Risk & Opportunity 2x2: {EntityName} ({StartDate} to {EndDate})

### Executive Summary
[At-a-glance summary highlighting the most critical opportunities and highest-priority risks requiring immediate mitigation.]

---

| **High Probability / High Impact** *(Immediate Action & Focus)* | **Low Probability / High Impact** *(Develop Contingency Plans)* |
| :--- | :--- |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |
| **High Probability / Low Impact** *(Monitor Efficiently)* | **Low Probability / Low Impact** *(Acknowledge & Deprioritize)* |
| <ul><li>...</li></ul> | <ul><li>...</li></ul> |

---

### Strategic Insights & Priority Mitigations
* **Immediate Priorities (High/High)**: [Concrete actions to capitalize on wins or neutralize immediate threats]
* **Contingency Planning (Low/High)**: [Leading indicators, triggers, and fallback architectures]
* **Dependencies & Ownership**: [Customer-side vs Google-side dependencies and owners]`,
  },
};

export const DEFAULT_PROMPT = PROMPT_DEFINITIONS.brief.defaultText;

export const DEFAULT_SETTINGS: RolodexSettings = {
  entityTypes: [],
  includeFolders: [],
  excludeFolders: ['Attachments', 'Template', 'Templates', '.trash', '~Archive', 'Reporting'],
  entityNoteFolders: ['Customers', 'Projects', 'Partners', 'Organization'],
  defaultDays: 30,
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  defaultPrompt: DEFAULT_PROMPT,
  typeAliases: ['Projects=Project', 'Customers=Customer'],
  ignoredTypes: [
    'chat', 'inbox', 'all', 'slide', 'meeting', 'learning',
    'territory', 'personal', 'architecture', 'admin', 'process',
    'agreement', 'internal',
  ],
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
  /** "Customer/AcmeCorp" — the stable key used everywhere. */
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

export interface ChiefOfStaffActionProposal {
  type: 'email_draft' | 'schedule_meeting' | 'fix_vector' | 'add_task' | 'update_next_step' | 'save_answer';
  title: string;
  description: string;
  email?: {
    to: string;
    subject: string;
    body: string;
    rationale?: string;
  };
  meeting?: {
    title: string;
    attendees: string;
    durationMinutes: number;
    agenda: string;
    rationale?: string;
  };
  vectorFix?: {
    oppId: string;
    oppName: string;
    arr: string;
    stage: string;
    closeDate: string;
    nextSteps: string;
    command?: string;
  };
  task?: {
    text: string;
    priority?: string;
    due?: string;
    reason?: string;
  };
  nextStep?: {
    text: string;
    rationale?: string;
  };
}

export interface ChiefOfStaffResult {
  situationBrief: string;
  diagnosticReview: {
    healthStatus: 'healthy' | 'caution' | 'critical' | 'neutral';
    headline: string;
    findings: string[];
    blindSpots: string[];
  };
  actionProposals: ChiefOfStaffActionProposal[];
}

export interface AiCommandResult {
  type: 'reclassify' | 'task_updates' | 'draft' | 'message' | 'chief_of_staff';
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
  chiefOfStaff?: ChiefOfStaffResult;
}
