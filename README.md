# Rolodex: Executive Cockpit

An Obsidian dashboard and AI cockpit for the **entities** in your vault — customers, projects, partners, teams, or any tag namespace you use (`#Customer/Amgen`, `#Project/FoldRun`, `#Partner/NVIDIA`).

It answers three core questions:
1. *Who is going quiet, and who needs attention?*
2. *What open commitments and deadlines do I still owe them?*
3. *What does leadership need to know right now?*

Rolodex parses tags across note titles, headings, task lines, and body prose in **~150 ms** across thousands of notes. It builds a live portfolio view of your relationships, automates **Executive 2x2 status reports**, and provides a natural-language **AI Action Engine** with visual confirmation diffs before modifying your vault.

```
🗂 Rolodex: Executive Cockpit (47 entities · 1,405 notes)              [ 🔄 Rescan ]
💬 Ask AI: "Change #Project/Old to #Project/New", "Clean up stale tasks for Amgen"...  [ ⚡ Execute ]

[ Last 30 days ▾ ]  [ All (47) ]  [ Customer (24) ]  [ Project (15) ]  [ Partner (8) ]
Executive 2x2:      [ 📅 Weekly 2x2 ]   [ 🗓️ Monthly 2x2 ]

[ 🔍 Filter by name... ]  [ Needs attention ▾ ]  [ ⚡ Open work only ]

  ●  Amgen        Customer  2026-09-05   8 open  2 late  287 notes  ⤷ Suki · Commure · GRAIL   [⚡ Action] [🧠 Brief] [📊 2x2]
  ●  Commure      Customer  2026-09-05   6 open  1 late  119 notes  ⤷ Amgen · Suki · Medable   [⚡ Action] [🧠 Brief] [📊 2x2]
  ◐  Illumina     Customer  2026-08-14   0 open  0 late   65 notes  ⤷ Broad · Takeda           [⚡ Action] [🧠 Brief] [📊 2x2]
  ○  Broad        Customer  2025-12-19   0 open  0 late  153 notes  ⤷ Pfizer · MEDITECH        [⚡ Action] [🧠 Brief] [📊 2x2]
```

---

## Features

### 1. Portfolio Cockpit
- **Recency Heat Indicators**: Immediate visual signal of relationship health:
  - `●` **Warm**: Active within recent days.
  - `◐` **Cooling**: Slipping past your expected touch frequency.
  - `○` **Cold**: Quiescent or dormant.
- **Commitment Tracking**: Tracks open tasks and overdue deadlines per entity. Full support for [Tasks plugin](https://publish.obsidian.md/tasks/) emojis: `📅` due, `⏳` scheduled, `🛫` start, `➕` created, `✅` done, `❌` cancelled, and `🔺⏫🔼🔽⏬` priority.
- **⚡ Open Work Only Toggle**: Instantly filters the view to show only entities with active, unclosed deliverables. Open work is never date-filtered—a four-month-old dropped task stays visible until resolved.
- **Co-occurrence Mapping**: Automatically records which entities appear in the same sections, revealing multi-party relationships (e.g. projects running at specific accounts, joint partner pursuits).
- **Attention Sorting**: Sort by *Needs attention* (overdue tasks first, then total open work, then longest silence), *Most recent*, *Most open tasks*, *Most activity*, or *Alphabetical*.

### 2. Executive 2x2 Reporting Suite
Generate structured, C-level 2x2 status reports and executive summaries directly into your vault with one click:
- **📅 Weekly 2x2** (`Reporting/2x2/weekly/YYYY/YYYY-MM/weekly_2x2_YYYY-MM-DD_to_YYYY-MM-DD.md`): Synthesizes rolling 7-day wins, operational blockers, and week-over-week commitments.
- **🗓️ Monthly 2x2** (`Reporting/2x2/monthly/YYYY/monthly_2x2_YYYY-MM.md`): Rolling 30-day territory status narrative aligned with Google Cloud **Grad Expectations & Leadership** pillars (*Customer Impact*, *Technical Excellence*, *Leadership & Culture*, *Strategic Thinking*, *Innovation & Problem Solving*).
- **📊 Customer & Project 2x2s** (`Reporting/2x2/customer/<Account>/` and `Reporting/2x2/project/<Project>/`): Deep dives into account wins, commercial ramps, technical blockers, and next steps with date-range filenames (`2x2 - Customer_<Account> - YYYY-MM-DD_to_YYYY-MM-DD.md`).
- **🛡️ Risk & Opportunity 2x2 Matrix**: Probability vs. Impact quadrant analysis for proactive contingency planning.

### 3. Natural Language AI Action Command Bar
Execute safe, intelligent vault operations from the central command bar or row-level action inputs:
- **Tag Migrations**: *"Change #Project/Venter to #Project/gcp-dde"* — reclassifies tags across all notes in the vault atomically.
- **Task Hygiene**: *"Clean up stale tasks for Amgen older than 60 days"* — scans and identifies unclosed tasks for cancellation.
- **Meeting Follow-ups**: *"Add a follow-up task for Commure to review BigQuery architecture next Tuesday"*.
- **Visual Safety Diffs**: AI commands generate a visual proposal and diff first. **Nothing is written to your vault until you review and click Confirm & Apply**.

### 4. Ground-Truth AI Engine
- **Powered by Gemini**: Default model is `gemini-3.8-flash` configured with thinking budget (`2048`), low temperature (`0.1`), and strict ground-truth prompt guardrails.
- **Zero Hallucinations**: Constrained exclusively to verifiable facts, dates, and deliverables in your notes.
- **Offline / Keyless Mode**: Without an API key, all core indexing, filtering, task ticking, and connection tracking work fully. The **Copy context** button puts the assembled markdown notes on your clipboard to paste into Claude, ChatGPT, or any other assistant.

### 5. Editable Markdown Prompts on Disk
Prompt templates are saved as editable markdown files directly inside your vault at `.obsidian/plugins/rolodex/prompts/`:
- `customer-2x2.md`
- `project-2x2.md`
- `weekly-2x2.md`
- `monthly-2x2.md`
- `briefing.md`
- `risk-2x2.md`

Customize the prompts directly in Obsidian to fit your team's executive review formats, or restore defaults anytime via Settings.

### 6. Entity Deep-Dive & Safe Task Ticking
- Click any entity to drill into its dedicated view: open commitments sorted overdue-first, notes rendered as markdown, connected entities, and a direct link to its canonical note (e.g. `Customers/Amgen.md`).
- **Atomic Task Ticking**: Clicking a checkbox rewrites the line in its source file to `[x]` and appends `✅ YYYY-MM-DD` via Obsidian's `app.vault.process()`. If the note was modified underneath it, the write is refused and the index automatically rescans.

---

## Installation

### Method 1: Obsidian BRAT (Recommended)
BRAT enables easy installation and one-click updates on desktop and mobile:
1. Install **Obsidian42 – BRAT** from Community Plugins.
2. In BRAT settings, click **Add beta plugin**.
3. Enter repository: `n0012/rolodex`.
4. Enable **Rolodex** in Community Plugins.

### Method 2: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [Latest Release](https://github.com/n0012/rolodex/releases/latest).
2. Create folder `<vault>/.obsidian/plugins/rolodex/`.
3. Copy the three files into that folder.
4. Reload Obsidian and enable **Rolodex** in Community Plugins.

---

## Configuration & Settings

Rolodex works out of the box with zero configuration if your tags use `#Type/Name` syntax (e.g. `#Customer/Amgen`). Optional settings are available in **Settings → Rolodex**:

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Entity types** | *(empty)* | Tag namespaces to show first in filter chips. Empty shows every namespace found, ordered by frequency. |
| **Ignored types** | `chat, inbox, all, slide, meeting, learning, territory, personal, architecture, admin, process, agreement, internal` | Tag namespaces to exclude from entities (status markers, functional tags). |
| **Type aliases** | `Projects=Project, Customers=Customer` | Fold inconsistent singular/plural tags. Case folding is automatic. |
| **Only scan these folders** | *(empty)* | Scope indexing to specific folders. Empty scans the entire vault. Path-boundary matched (`~Daily` will not match `~DailyMeetings`). |
| **Never scan these folders** | `Attachments, Template, Templates, .trash, ~Archive` | Folders excluded from indexing. |
| **Entity note folders** | `Customers, Projects, Partners, Organization` | Where entity hub pages live (e.g. `Customers/Amgen.md`). Rolodex links to them from entity headers. |
| **Default window** | `30` | Number of days of history shown on open. Open tasks are always shown regardless of window. |
| **Gemini API key** | *(empty)* | API key from [aistudio.google.com](https://aistudio.google.com/apikey). Stored locally in `.obsidian/plugins/rolodex/data.json`. |
| **Model** | `gemini-3.8-flash` | Gemini model ID. Supports any active Gemini model. |
| **Default Briefing Prompt** | *(builtin)* | Fallback prompt for executive briefings (also editable in `.obsidian/plugins/rolodex/prompts/briefing.md`). |
| **Prompt Templates on Disk** | *(button)* | Verifies and restores the prompt templates in `.obsidian/plugins/rolodex/prompts/`. |

---

## Indexing & Matching Rules

- **Whole-segment tag matching**: `#Customer/GE` does not match `#Customer/GEHC`. Trailing punctuation (`.`, `,`, `!`) is stripped cleanly.
- **Case folding**: `#customer/amgen` and `#Customer/Amgen` are treated as the same entity. The most frequently used casing is used for display.
- **Sub-areas**: A third tag level denotes a sub-area rather than a separate entity (`#Customer/Pharma/ISV` belongs to `Customer/Pharma` with sub-area `ISV`).
- **Section as the unit of activity**: Headings define sections. Entities mentioned within the same section are recorded as connected.
- **Task entity inheritance**: A task inherits its enclosing section's entity tags unless it explicitly defines its own entity tags.
- **Strict date derivation**: A note's date is derived from its filename (`YYYY-MM-DD.md`), then frontmatter `created`, then filesystem `ctime`. Filesystem `mtime` is deliberately ignored to prevent bulk edits from corrupting historical timelines.

---

## Obsidian Commands

- `Rolodex: Open Rolodex` — Opens the Executive Cockpit in the right sidebar.
- `Rolodex: Rescan the vault` — Triggers an immediate full index rebuild.

---

## Development

```bash
# Install dependencies
npm install

# Run build in watch mode
npm run dev

# Typecheck and run tests
npm run typecheck
npm test

# Production build
npm run build

# Test the scanner on any vault on disk without running Obsidian:
node scripts/dryrun.mjs "/path/to/vault" [type/name]
```

---

## License

MIT © [n0012](https://github.com/n0012)
