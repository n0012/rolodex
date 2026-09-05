# Rolodex Executive Cockpit: Future View Roadmap

This document outlines the strategic enhancements planned and delivered for the Rolodex **Entity Detail / Executive View** page in Obsidian. The goal is to turn the detail view into a rapid, 10-second operational command center for account leadership, executive briefings, and pre-meeting preparation.

---

## 🚀 Shipped & Delivered

### 🌐 Ecosystem Network Graph (Delivered in v1.4.9)
- **Problem**: The flat text chip row (`Focus & Collaborators: ...`) was static and lacked visual hierarchy, making it hard to see the broader web of partners, internal peers, and cross-account projects at a glance.
- **Implemented Architecture**:
  - **Zero-Dependency SVG Network Canvas**: Central entity hub surrounded by orbiting satellites with responsive elliptical layout and stagger positioning.
  - **Category Color-Coding**:
    - 🟣 **Projects** (`#7c3aed`)
    - 🟢 **Partners** (`#059669`)
    - 🔵 **Stakeholders / People** (`#0284c7`)
    - 🟠 **Customers** (`#ea580c`)
  - **Proportional Weighting**: Edge thickness and node radii scale dynamically based on shared daily note touches (`n`).
  - **Micro-Interactions**: Hover halo glow, connecting edge illumination, mutual dimming of unrelated nodes, and rich floating tooltip cards.
  - **One-Click Navigation**: Direct drill-in for Rolodex entities; note opening for Obsidian markdown pages.
  - **Noise Filter & Mode Switch**: Automatic exclusion of internal dashboards (`Task Hub`, `Support Cases`), attachments, and dates; instant `[ 🕸️ Graph | 🏷️ Chips ]` toggle.

#### Future Graph Evolutions (Phase 2)
- **Multi-Hop / 2nd-Degree Linkages**: Render connections between orbiting satellites (e.g., showing which partners work with which specific customer champions).
- **Strength / Recency Filter Slider**: Interactive slider to filter nodes by minimum touch count (e.g. `Touches ≥ 3`) or by recency (e.g. last 30 days vs all-time).
- **Direct Collaborator Quick-Actions**: Click-to-action menu on a stakeholder node to quickly copy contact email, jump to recent mentions, or file a task assigned to that person.

---

## 📋 Upcoming Roadmap Features

### 1. 📑 Existing 2x2 Report Shelf (Instant Strategic Access)
#### Problem
Currently, 2x2 reports are synthesized and saved under `Reporting/2x2/customer/<Account>/` (or `project/<Project>/`). However, navigating back to an account page later does not automatically surface existing reports unless they were generated in that immediate session.

#### Proposed Design
- **Automatic Library Discovery**: On rendering the entity view, check `Reporting/2x2/(customer|project)/<EntityName>/` for existing monthly and weekly reports.
- **Report Shelf Component**:
  - Prominently display a card or link list at the top of the view:
    `📄 Latest 2x2: August 2026 (Aug 1 – Aug 31) ↗` · `July 2026 ↗`
  - Clicking opens the generated markdown report directly in Obsidian workspace without needing to re-invoke Gemini.

---

### 2. 🚦 Account Health & Engagement Velocity Pulse
#### Problem
CEs managing multiple high-stakes accounts need to spot immediately whether an account is cooling down, maintaining steady cadence, or accelerating into a critical phase.

#### Proposed Design
- **Color-Coded Status Badge**:
  - 🟢 **Active**: Touch within last 7 days.
  - 🟡 **Warm**: Touch 8–21 days ago.
  - 🔴 **Cooling**: No touch for >21 days.
- **Velocity Metrics**:
  - Cadence count: e.g., *"4 customer sessions in last 30d (↗ Accelerating)"* vs. *"0 sessions in last 30d (↘ Stalling)"*.
  - Commitment Clearance Ratio: Completed vs. overdue deliverables within the current review window.

---

### 3. 👥 Stakeholders & Account Team Roster
#### Problem
Attendee rosters and key customer contacts are currently embedded inside individual meeting notes across various daily log entries. Retrieving "who is our champion at Takeda or Agilent" requires searching or reading old logs.

#### Proposed Design
- **Attendee Extraction**: Parse `**Attendees:**` lines from meeting notes within the scanned window.
- **Categorized Directory**:
  - **Customer Contacts**: External stakeholders identified by non-google email domains or company affiliation (e.g., `Jan-Felix Meyer @ Takeda`).
  - **Partners**: Systems integrators and ISV collaborators (e.g., `Altimetrik`, `Deloitte`).
  - **Google Team Pod**: Internal peers (e.g., AE `David Pichardo`, Specialist `Skander`, Engineering `Vicente`).

---

### 4. 🔗 Key Artifacts & Working Decks Shelf
#### Problem
Active presentations, PRDs, and architecture Google Docs are frequently referenced in daily notes (`**📊 Deck:**`, `**📄 Notes:**`), but getting back to the latest working deck requires finding the specific day's meeting note.

#### Proposed Design
- **Artifact Parser**: Extract Google Docs and Google Slides links referenced in meeting scaffolds or sections matching `#Customer/<Name>`.
- **Docs Backlink**: Link directly to `Reporting/2x2/customer/<Account>/Docs.md` (curated by `ce-doc-linker`).
- **One-Click Launch Shelf**:
  - `📊 Presentation: Donor Yield, Forecasting and the Optimizer ↗`
  - `📄 Implementation Architecture Notes ↗`

---

### 5. ➕ One-Click Task & Scratch Capture
#### Problem
Switching out of Rolodex to open today's daily note, scroll to `## 📥 Inbox`, and format a Tasks-plugin line introduces capture friction.

#### Proposed Design
- **Inline Capture Input**:
  - A simple command field: `[ Add new task for <Entity>... ] [Add Task]`
  - Automatically appends a properly structured Tasks-plugin line directly into today's `~Daily/YYYY-MM-DD.md` under `## 📥 Inbox`:
    `- [ ] <task text> #Customer/<Entity> ➕ YYYY-MM-DD`
  - Instantly refreshes the open task list in the view.
