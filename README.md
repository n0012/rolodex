# Rolodex: Executive Cockpit

An Obsidian dashboard and AI cockpit for the **entities** in your vault — customers, projects, partners, teams, or any tag namespace you use (`#Customer/AcmeCorp`, `#Project/Phoenix`, `#Partner/OmniTech`).

It answers three core questions:
1. *Who is going quiet, and who needs attention?*
2. *What open commitments and deadlines do I still owe them?*
3. *What does leadership need to know right now?*

Rolodex parses tags across note titles, headings, task lines, and body prose in **~150 ms** across thousands of notes. It builds a live portfolio view of your relationships, automates **Executive 2x2 status reports**, and provides a natural-language **AI Action Engine** with visual confirmation diffs before modifying your vault.

```
🗂 Rolodex: Executive Cockpit (47 entities · 1,405 notes)              [ 🔄 Rescan ]
💬 Ask AI: "Change #Project/Alpha to #Project/Beta", "Clean up stale tasks for Acme"...  [ ⚡ Execute ]

[ Last 30 days ▾ ]  [ All (47) ]  [ Customer (24) ]  [ Project (15) ]  [ Partner (8) ]
Executive 2x2:      [ 📅 Weekly 2x2 ]   [ 🗓️ Monthly 2x2 ]

[ 🔍 Filter by name... ]  [ Needs attention ▾ ]  [ ⚡ Open work only ]

  ●  AcmeCorp     Customer  2026-09-05   8 open  2 late  287 notes  ⤷ Globex · Initech · Wayne   [⚡ Action] [🧠 Brief] [📊 2x2]
  ●  Globex       Customer  2026-09-05   6 open  1 late  119 notes  ⤷ AcmeCorp · Initech · Stark [⚡ Action] [🧠 Brief] [📊 2x2]
  ◐  Initech      Customer  2026-08-14   0 open  0 late   65 notes  ⤷ Umbrella · Cyberdyne       [⚡ Action] [🧠 Brief] [📊 2x2]
  ○  Umbrella     Customer  2025-12-19   0 open  0 late  153 notes  ⤷ Hooli · MassiveDyn         [⚡ Action] [🧠 Brief] [📊 2x2]
```

---

## What it does

**Portfolio cockpit.** Every entity across every namespace (`#Customer/AcmeCorp`, `#Project/Phoenix`, `#Partner/OmniTech`) in one live table: recency heat (`●` warm / `◐` cooling / `○` cold), open tasks, overdue deadlines, note count, and top connections. The **⚡ Open work only** toggle instantly hides quiet accounts so you see only entities with active commitments. Sorted by *needs attention* — overdue first, then open work, then longest silence.

**Executive 2x2 reporting.** Generates structured C-level status reports and matrices written directly into your vault with one click:
- **📅 Weekly 2x2** (`Reporting/2x2/weekly/YYYY/YYYY-MM/`): 7-day operational wins, blockers, and week-over-week commitments.
- **🗓️ Monthly 2x2** (`Reporting/2x2/monthly/YYYY/`): 30-day territory narrative aligned with **Grad Expectations & Leadership** pillars (*Customer Impact*, *Technical Excellence*, *Leadership & Culture*, *Strategic Thinking*, *Innovation & Problem Solving*).
- **📊 Customer & Project 2x2s** (`Reporting/2x2/customer/<Account>/` and `Reporting/2x2/project/<Project>/`): Deep dives into account wins, commercial ramps, technical blockers, and next steps with date-range filenames (`2x2 - Customer_<Account> - YYYY-MM-DD_to_YYYY-MM-DD.md`).
- **🛡️ Risk & Opportunity 2x2 Matrix**: Impact vs. Probability quadrant analysis with concrete mitigations.

**Natural-language AI action engine.** A central command bar at the top of the cockpit plus row-level quick inputs. Type plain-English instructions — *"Change #Project/Alpha to #Project/Beta across the vault"*, *"Clean up stale tasks for Acme older than 60 days"*, or *"Brief me on Globex"*. Gemini proposes changes as a visual diff first; **nothing is written to your vault until you review and confirm**.

**Entity view.** Open commitments sorted overdue-first, clickable straight to the source note and line; recent notes rendered as live markdown; co-occurring entities; and a direct link to the entity's own hub page (`Customers/AcmeCorp.md`) when one exists.

**Ground-truth AI briefings.** Assembles the entity's open work, recent completions, and notes, then asks Gemini for a structured five-part brief. Powered by `gemini-3.8-flash` with a 2048 thinking budget and zero-hallucination guardrails strictly bounded by your vault notes. Without an API key, *Copy context* puts the exact assembled markdown on your clipboard for any assistant.

**Editable prompt templates on disk.** Prompt templates live as standard markdown files directly inside your vault at `.obsidian/plugins/rolodex/prompts/` (`customer-2x2.md`, `project-2x2.md`, `weekly-2x2.md`, `monthly-2x2.md`, `briefing.md`, `risk-2x2.md`). Edit them in Obsidian to match your team's executive review format, or restore defaults anytime via Settings.

**Connections.** Rolodex records which entities share a section, so projects show the accounts they touch and accounts show active workstreams. In a typical engineering or sales vault, over 95% of project-tagged notes also carry customer tags — relationships that were previously buried in prose.

**Task metadata & atomic ticking.** Full [Tasks plugin](https://publish.obsidian.md/tasks/) emoji support: `📅` due, `⏳` scheduled, `🛫` start, `➕` created, `✅` done, `❌` cancelled, and `🔺⏫🔼🔽⏬` priority. Clicking a checkbox rewrites only that exact line via Obsidian's `app.vault.process()` to `[x]` and appends `✅ YYYY-MM-DD`. If the note was modified underneath it, the write is refused and the index rescans. Open work is deliberately **never** date-filtered — an unclosed task from four months ago remains front and center.

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

Rolodex works out of the box with zero configuration if your tags use `#Type/Name` syntax (e.g. `#Customer/AcmeCorp`). Optional settings are available in **Settings → Rolodex**:

| Setting | Default | Description |
| :--- | :--- | :--- |
| **Entity types** | *(empty)* | Tag namespaces to show first in filter chips. Empty shows every namespace found, ordered by frequency. |
| **Ignored types** | `chat, inbox, all, slide, meeting, learning, territory, personal, architecture, admin, process, agreement, internal` | Tag namespaces to exclude from entities (status markers, functional tags). |
| **Type aliases** | `Projects=Project, Customers=Customer` | Fold inconsistent singular/plural tags. Case folding is automatic. |
| **Only scan these folders** | *(empty)* | Scope indexing to specific folders. Empty scans the entire vault. Path-boundary matched (`~Daily` will not match `~DailyMeetings`). |
| **Never scan these folders** | `Attachments, Template, Templates, .trash, ~Archive` | Folders excluded from indexing. |
| **Entity note folders** | `Customers, Projects, Partners, Organization` | Where entity hub pages live (e.g. `Customers/AcmeCorp.md`). Rolodex links to them from entity headers. |
| **Default window** | `30` | Number of days of history shown on open. Open tasks are always shown regardless of window. |
| **Gemini API key** | *(empty)* | API key from [aistudio.google.com](https://aistudio.google.com/apikey). Stored locally in `.obsidian/plugins/rolodex/data.json`. |
| **Model** | `gemini-3.8-flash` | Gemini model ID. Supports any active Gemini model. |
| **Default Briefing Prompt** | *(builtin)* | Fallback prompt for executive briefings (also editable in `.obsidian/plugins/rolodex/prompts/briefing.md`). |
| **Prompt Templates on Disk** | *(button)* | Verifies and restores the prompt templates in `.obsidian/plugins/rolodex/prompts/`. |

---

## Indexing & Matching Rules

- **Whole-segment tag matching**: `#Customer/Acme` does not match `#Customer/AcmeLabs`. Trailing punctuation (`.`, `,`, `!`) is stripped cleanly.
- **Case folding**: `#customer/acme` and `#Customer/Acme` are treated as the same entity. The most frequently used casing is used for display.
- **Sub-areas**: A third tag level denotes a sub-area rather than a separate entity (`#Customer/Acme/Security` belongs to `Customer/Acme` with sub-area `Security`).
- **Section as the unit of activity**: Headings define sections. Entities mentioned within the same section are recorded as connected.
- **Task entity inheritance**: A task inherits its enclosing section's entity tags unless it explicitly defines its own entity tags (e.g. a task tagged `#Customer/Globex` under an Acme heading stays Globex's).
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
