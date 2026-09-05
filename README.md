# Rolodex

An Obsidian dashboard for the **entities** in your vault — customers, projects,
partners, teams, whatever your tag namespaces happen to be. It answers one
question: *who am I dropping, and what do I still owe them?*

It reads tags of the form `#Type/Name` (`#Customer/Amgen`, `#Project/FoldRun`)
wherever they appear — headings, task lines, prose — and builds a live index of
every entity, the notes it appears in, the open commitments attached to it, and
which other entities it keeps showing up next to.

Nothing is written to your vault except when you tick a task.

```
🗂 Rolodex                                    last 30d ▾
   Customer  Project  Partner  Organization  Team

  ●  Amgen        Customer  2026-09-05   8 open  2 late  287  ⤷ Suki · Commure · GRAIL
  ●  Commure      Customer  2026-09-05   6 open  1 late  119  ⤷ Amgen · Suki · Medable
  ◐  Illumina     Customer  2026-08-14   0 open         65   ⤷ Amgen · Suki · Commure
  ○  Broad        Customer  2025-12-19   0 open        153   ⤷ Pfizer · MEDITECH
```

## What it does

**Portfolio view.** Every entity across every type in one table: how long it has
been quiet (● warm / ◐ cooling / ○ cold), open tasks, how many of those are past
due, note count, and its top three connections. Sorted by *needs attention* —
overdue first, then open work, then longest silence.

**Entity view.** Open commitments sorted overdue-first, each clickable straight
to its source line and tickable in place; the notes in your window rendered as
markdown; the entities it co-occurs with; and a link to its own page
(`Customers/Amgen.md`) when one exists.

**Connections.** Rolodex records which entities share a section, so a project
shows the accounts it touches and an account shows the projects running on it.
In the vault this was built against, 111 of 115 project-tagged notes also carry
a customer tag — that relationship was invisible before.

**Task metadata.** Full [Tasks plugin](https://publish.obsidian.md/tasks/) emoji
support: 📅 due, ⏳ scheduled, 🛫 start, ➕ created, ✅ done, ❌ cancelled, and
🔺⏫🔼🔽⏬ priority. Open work is deliberately **never** date-filtered — a
commitment made four months ago and never closed is exactly what you want to
see.

**AI briefings (optional).** Assembles the entity's open work, recent
completions and notes, and asks Gemini for a five-part brief. Without an API key
everything else still works — *Copy context* puts the same assembled text on your
clipboard for any assistant you like.

## Install

### BRAT (recommended, works on iOS)

1. Install **Obsidian42 – BRAT** from Community Plugins.
2. BRAT → *Add beta plugin* → `n0012/rolodex`.
3. Enable **Rolodex** in Community Plugins.

BRAT will pull new releases automatically.

### Manual

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/n0012/rolodex/releases/latest) into
`<vault>/.obsidian/plugins/rolodex/`, then reload Obsidian.

## Setup

Rolodex works with no configuration if your tags look like `#Customer/Amgen`.
Everything below is optional tuning, in Settings → Rolodex.

| Setting | What it is for |
| --- | --- |
| **Entity types** | Namespaces to list first. Empty shows every namespace found, most-used first. |
| **Ignored types** | Namespaces that are not entities — `chat`, `inbox`, status markers. |
| **Type aliases** | `Projects=Project` folds a namespace you have typed inconsistently. Case is folded automatically. |
| **Only scan these folders** | Empty means the whole vault. |
| **Never scan these folders** | Defaults to `Attachments`, `Template`, `Templates`, `.trash`. |
| **Entity note folders** | Where an entity's own page lives, so Rolodex can link to it. |
| **Default window** | Days of history the pane opens on. Open tasks ignore it. |
| **Gemini API key / model / prompt** | Optional; see below. |

Folder matching is on a **path boundary**, so `~Daily` does not also pull in
`~DailyMeetings`.

### AI briefings

Get a key from [aistudio.google.com](https://aistudio.google.com/apikey) and
paste it into *Gemini API key*. Default model is `gemini-flash-latest`; any
current model id works.

> The key is stored in `.obsidian/plugins/rolodex/data.json` **inside your
> vault**. If your vault syncs to Drive, iCloud or a git remote, the key goes
> with it. Use *Copy context* instead if that is not acceptable.

## How it decides things

- **Tags are matched on whole segments.** `#Customer/GE` does not also match
  `#Customer/GEHC`, and a trailing full stop is punctuation, not part of the
  name.
- **Identity is case-folded**, matching Obsidian's own tag handling, so
  `#customer/amgen` and `#Customer/Amgen` are one entity. The most-used spelling
  wins for display.
- **A third level is a sub-area, not a new entity.** `#Customer/Pharma/ISV`
  belongs to `Customer/Pharma` and records `ISV`.
- **A section is the unit of activity** — a heading plus everything under it
  until the next heading. Entities named in the same section are recorded as
  connected.
- **A task inherits its section's entities only if it names none itself**, so a
  task tagged `#Customer/Suki` under an Amgen heading stays Suki's.
- **A note's date comes from its filename** (`2026-09-05.md`), then frontmatter
  `created`, then ctime. Never mtime — a bulk rewrite would otherwise re-date
  years of history overnight.
- **The whole index is built in one pass.** The vault it was built against
  scans in ~150 ms for 1,405 notes; it rescans a few seconds after any change.

## Ticking a task

Clicking a checkbox rewrites the line in its source note to `[x]` and appends
`✅ YYYY-MM-DD`. Before writing, Rolodex checks the line still reads exactly as
it did at scan time — if the note changed underneath it, the write is refused
and the index rescans instead.

## Development

```bash
npm install
npm run dev        # watch build
npm run typecheck
npm test
npm run build      # typecheck + production bundle

# Run the real indexer over a vault on disk, outside Obsidian:
node scripts/dryrun.mjs "/path/to/vault" [type/name]
```

`dryrun.mjs` is the useful one — it exercises the actual scanner against a real
vault and prints entity counts, connections and open tasks, which is how the
tag-boundary and folder-boundary behaviour above was verified.

## Credits

Rolodex began as a rewrite of a personal "Entity Browser" plugin and keeps its
core idea — tag namespaces as a lightweight CRM — while replacing the indexing,
matching and rendering.

MIT.
