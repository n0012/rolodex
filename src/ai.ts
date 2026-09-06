import { App, requestUrl } from 'obsidian';
import { daysAgoIso, todayIso, tryDeterministicCommand } from './parse';
import { isOverdue, openTasks, sortTasks } from './select';
import { DEFAULT_PROMPT, PROMPT_DEFINITIONS } from './types';
import type {
  AiCommandResult,
  ChiefOfStaffActionProposal,
  ChiefOfStaffResult,
  EntityRecord,
  EntityTask,
  ReportType,
} from './types';
import type { Window } from './select';
import type { TaskUpdateProposal } from './actions';
import { parseAccountSupportCases, parseAccountWorkloads } from './reporting';

export function getPromptsDir(app: App, pluginId = 'cockpit'): string {
  return `${app.vault.configDir}/plugins/${pluginId}/prompts`;
}

/**
 * Ensures that the prompts directory and default prompt markdown files exist on disk.
 */
export async function ensurePromptFiles(app: App, pluginId = 'cockpit'): Promise<void> {
  const dir = getPromptsDir(app, pluginId);
  const adapter = app.vault.adapter;
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }
  for (const def of Object.values(PROMPT_DEFINITIONS)) {
    const p = `${dir}/${def.filename}`;
    if (!(await adapter.exists(p))) {
      await adapter.write(p, def.defaultText);
    }
  }
}

/**
 * Loads a prompt from disk (allowing user edits) or falls back to built-in default.
 */
export async function loadPrompt(
  app: App,
  reportType: ReportType,
  variables: Record<string, string> = {},
  pluginId = 'cockpit',
): Promise<string> {
  const def = PROMPT_DEFINITIONS[reportType];
  let text = def ? def.defaultText : DEFAULT_PROMPT;
  const p = `${getPromptsDir(app, pluginId)}/${def?.filename || 'briefing.md'}`;
  const legacyP = `${getPromptsDir(app, 'rolodex')}/${def?.filename || 'briefing.md'}`;

  try {
    if (await app.vault.adapter.exists(p)) {
      const diskText = await app.vault.adapter.read(p);
      if (diskText.trim()) text = diskText;
    } else if (await app.vault.adapter.exists(legacyP)) {
      const diskText = await app.vault.adapter.read(legacyP);
      if (diskText.trim()) text = diskText;
    }
  } catch (err) {
    console.warn(`Cockpit: unable to read prompt file ${p}`, err);
  }

  // Interpolate template variables: {EntityName}, {StartDate}, {EndDate}
  for (const [k, v] of Object.entries(variables)) {
    const re = new RegExp(`\\{${k}\\}`, 'g');
    text = text.replace(re, v);
  }

  return text;
}

const GROUND_TRUTH_INSTRUCTIONS = `
CRITICAL GROUND-TRUTH RULES:
1. Under NO circumstances invent, extrapolate, or hallucinate metrics, company names, projects, partner names, or blockers.
2. Rely EXCLUSIVELY and STRICTLY on the facts, stakeholders, and technical discussions explicitly mentioned in the GROUND TRUTH CONTEXT provided below.
3. NEVER use generic placeholder or fictional company names (such as Acme Corp, Globex, Cyberdyne, Umbrella Corp, Partner X, Project Phoenix, etc.). If an engagement or blocker is not in the context, do NOT invent one.
4. Reflect real customer stakeholders, Google peers, and technologies accurately as documented in the notes.
5. Provide a rigorous, executive-level 2x2 matrix, key metrics, strategic insights, and Grad Expectations alignment.
`;

export async function summarize(
  apiKey: string,
  model: string,
  prompt: string,
  context: string,
): Promise<string> {
  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${GROUND_TRUTH_INSTRUCTIONS}\n\n${prompt}\n\n---\n\n${context}` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      },
    }),
    throw: false,
  });

  if (resp.status >= 400) {
    const detail = (resp.json as { error?: { message?: string } })?.error?.message;
    throw new Error(detail ?? `Gemini returned ${resp.status}`);
  }

  const data = resp.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('');
  if (!text) {
    const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'empty response';
    throw new Error(`No summary returned (${why})`);
  }
  return text;
}

/**
 * Builds rich, multi-source context for Chief of Staff intelligence:
 * notes, activities, authoritative Next Steps, Docs links, Support Cases, and Vector CRM pipeline.
 */
export async function buildChiefOfStaffContext(
  app: App,
  e: EntityRecord | null,
  all: Map<string, EntityRecord>,
  win: Window,
  charBudget = 70_000,
): Promise<string> {
  if (!e) {
    return buildPortfolioContext(win, all, charBudget);
  }

  const parts: string[] = [buildContext(e, win, all, 35_000)];

  // Read authoritative Entity note (Customers/<Name>.md, Projects/<Name>.md) if notePath exists
  if (e.notePath) {
    try {
      const adapter = app.vault.adapter;
      if (await adapter.exists(e.notePath)) {
        const fullContent = await adapter.read(e.notePath);
        const nextStepMatch = fullContent.match(/##\s+Next Step[\s\S]*?(?=\n#+ |\Z)/i);
        if (nextStepMatch) {
          parts.push(`\n## Authoritative Next Step from Entity Note:\n${nextStepMatch[0].trim()}`);
        }
        const docsMatch = fullContent.match(/##\s+Docs[\s\S]*?(?=\n#+ |\Z)/i);
        if (docsMatch) {
          parts.push(`\n## Linked Strategy Docs & Artifacts from Note:\n${docsMatch[0].trim()}`);
        }
      }
    } catch (err) {
      console.warn('Chief of Staff: error reading entity note', err);
    }
  }

  // Telemetry: Support cases & Workloads
  if (e.type.toLowerCase() === 'customer') {
    try {
      const cases = await parseAccountSupportCases(app, e.name);
      if (cases.openCases.length || cases.resolvedCases.length) {
        parts.push('\n## Google Cloud Support Cases (Real-Time CaseChat Spaces)');
        if (cases.openCases.length) {
          parts.push(`### Active Open Cases (${cases.openCases.length}):`);
          for (const c of cases.openCases) {
            parts.push(`- Case #${c.caseNumber} [${c.priority}] (${c.status}) Owner: ${c.owner} | Product: ${c.product} ${c.notes ? '| Notes: ' + c.notes : ''} | URL: ${c.url || 'N/A'}`);
          }
        }
        if (cases.resolvedCases.length) {
          parts.push(`### Historical Resolved Cases on File (${cases.resolvedCases.length}):`);
          for (const c of cases.resolvedCases.slice(0, 5)) {
            parts.push(`- Case #${c.caseNumber} [${c.priority}] Resolved ${c.resolvedDate || ''} | Product: ${c.product} ${c.notes ? '| Notes: ' + c.notes : ''}`);
          }
        }
      }

      const workloads = await parseAccountWorkloads(app, e.name);
      if (workloads && (workloads.opps.length || workloads.totalPipeline > 0)) {
        parts.push('\n## Salesforce Vector Workloads & Pipeline (concord-prod BQ)');
        parts.push(`Total Pipeline ARR: $${workloads.totalPipeline.toLocaleString()}`);
        for (const opp of workloads.opps) {
          const hygiene = opp.isMissingWorkload ? `MISSING WORKLOAD (${opp.suggestedFix || 'Create Workload'})` : 'Workload Attached';
          parts.push(`- Opp: ${opp.name} (ID: ${opp.id || 'N/A'}) | Amount: $${(opp.amount || 0).toLocaleString()} | Stage: ${opp.stage} | Close: ${opp.closeDate} | ${hygiene} | CLI: ${opp.fixCommand || 'N/A'}`);
        }
      }
    } catch (err) {
      console.warn('Chief of Staff: error reading telemetry', err);
    }
  }

  return parts.join('\n\n');
}

/**
 * Runs the Chief of Staff intelligence engine:
 * diagnoses account posture, identifies blockers & friction points, and prepares turnkey execution artifacts.
 */
export async function askChiefOfStaff(
  app: App,
  apiKey: string,
  model: string,
  query: string,
  currentEntity: EntityRecord | null,
  allEntities: Map<string, EntityRecord>,
  win: Window,
): Promise<ChiefOfStaffResult> {
  if (!apiKey) {
    throw new Error('Please configure a Gemini API key in Cockpit settings for Chief of Staff AI actions.');
  }

  const context = await buildChiefOfStaffContext(app, currentEntity, allEntities, win);
  const today = todayIso();
  const entityScope = currentEntity ? `${currentEntity.type} / ${currentEntity.name}` : 'Entire Portfolio';

  const systemInstruction = `You are the Executive Chief of Staff to a Principal Google Cloud Healthcare & Life Sciences (HCLS) Customer Engineer.
Your mandate is high-agency strategic partnership: diagnose account health, uncover friction points and blockers, and prepare turnkey execution artifacts (emails, meeting invites, Vector CRM fixes, prioritized tasks, next steps).

Current Scope: ${entityScope}
Today's Date: ${today}

User Query / Directive: "${query}"

CRITICAL GROUND-TRUTH & ACTIONABILITY RULES:
1. Rely EXCLUSIVELY and STRICTLY on the facts, stakeholders, support tickets, and telemetry in the GROUND TRUTH CONTEXT. Do NOT invent fictional companies or cases.
2. Produce a rigorous, structured response matching this JSON schema:

{
  "situationBrief": "Grounded executive briefing (2-3 paragraphs) directly answering the query or synthesizing current posture. Cite notes, dates (e.g. [[${today}]]), customer stakeholders, and cases.",
  "diagnosticReview": {
    "healthStatus": "healthy" | "caution" | "critical" | "neutral",
    "headline": "Punchy 1-sentence diagnostic verdict",
    "findings": [
      "Key diagnostic finding (e.g. P1 blocker on FoldRun quota unassigned in CaseChat)",
      "Key commercial/technical finding (e.g. $250K Vector Opp missing workload)"
    ],
    "blindSpots": [
      "Critical gaps, missing touchpoints, unreplied asks, or overdue commitments"
    ]
  },
  "actionProposals": [
    // Include 2 to 5 actionable proposals that solve problems uncovered above:
    // Email draft if outreach, reply, or status update is needed:
    {
      "type": "email_draft",
      "title": "Email: [Follow-up Subject]",
      "description": "Why sending this email now moves the needle",
      "email": {
        "to": "recipient email or stakeholder name",
        "subject": "Clear, professional subject",
        "body": "Complete, turnkey draft ready to send",
        "rationale": "Strategic objective of this email"
      }
    },
    // Meeting proposal if alignment or triage is needed:
    {
      "type": "schedule_meeting",
      "title": "Meeting: [Duration] [Topic] with [Attendees]",
      "description": "Why a meeting is required",
      "meeting": {
        "title": "Working Session: [Topic]",
        "attendees": "stakeholder@customer.com",
        "durationMinutes": 30,
        "agenda": "1. Review blocker\\n2. Technical path forward\\n3. Action items",
        "rationale": "Direct alignment needed"
      }
    },
    // Vector CRM fix if workload is missing or stage/ARR is misaligned:
    {
      "type": "fix_vector",
      "title": "Fix Vector: Create Workload for [Opp Name]",
      "description": "Fix Vector CRM hygiene gap ($XXX ARR)",
      "vectorFix": {
        "oppId": "006...",
        "oppName": "Opportunity Name",
        "arr": "$250,000",
        "stage": "0-2",
        "closeDate": "YYYY-MM-DD",
        "nextSteps": "Authoritative next step under 255 chars"
      }
    },
    // High-priority task if action is required today:
    {
      "type": "add_task",
      "title": "Task: [Actionable Verb Phrase]",
      "description": "Why this must be captured today",
      "task": {
        "text": "Verb phrase for task",
        "priority": "🔺", // "🔺" for high/critical, "⏫" for medium, or empty
        "due": "YYYY-MM-DD",
        "reason": "Prevents blocker from slipping"
      }
    },
    // Authoritative next step if direction needs updating:
    {
      "type": "update_next_step",
      "title": "Update ## Next Step on Entity Page",
      "description": "Align entity note with latest reality",
      "nextStep": {
        "text": "Clear next step description",
        "rationale": "Supersedes older guidance"
      }
    }
  ]
}

Return ONLY raw valid JSON, no markdown codeblocks, no commentary.`;

  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemInstruction}\n\nGROUND TRUTH CONTEXT:\n${context}` }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      },
    }),
    throw: false,
  });

  if (resp.status >= 400) {
    const detail = (resp.json as { error?: { message?: string } })?.error?.message;
    throw new Error(detail ?? `Gemini returned ${resp.status}`);
  }

  const data = resp.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
  if (!rawText) throw new Error('No response from Chief of Staff AI.');

  const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleanJson) as ChiefOfStaffResult;
  } catch (err) {
    return {
      situationBrief: rawText,
      diagnosticReview: {
        healthStatus: 'neutral',
        headline: 'Chief of Staff Assessment',
        findings: ['Review generated in narrative mode'],
        blindSpots: [],
      },
      actionProposals: [],
    };
  }
}

/**
 * Executes a natural language command via Chief of Staff engine or deterministic parser.
 */
export async function executeAiCommand(
  app: App,
  apiKey: string,
  model: string,
  command: string,
  currentEntity: EntityRecord | null,
  allEntities: Map<string, EntityRecord>,
  win?: Window,
): Promise<AiCommandResult> {
  // Try instant deterministic parsing first
  const fast = tryDeterministicCommand(command, allEntities, currentEntity);
  if (fast) return fast;

  if (!apiKey) {
    throw new Error('Please configure a Gemini API key in Cockpit settings for natural language AI actions.');
  }

  const defaultWin: Window = win || { from: daysAgoIso(30), to: todayIso() };

  // If the command is a query, question, action request, review, or chief of staff task:
  // Route to the comprehensive Chief of Staff engine!
  const lower = command.toLowerCase();
  const isSimpleTaskUpdate = /^(clean up|cancel|mark done|stale tasks)\b/i.test(lower);

  if (!isSimpleTaskUpdate) {
    try {
      const chiefResult = await askChiefOfStaff(
        app,
        apiKey,
        model,
        command,
        currentEntity,
        allEntities,
        defaultWin,
      );
      return {
        type: 'chief_of_staff',
        title: currentEntity ? `👔 Chief of Staff: ${currentEntity.name}` : '👔 Chief of Staff: Territory Review',
        chiefOfStaff: chiefResult,
      };
    } catch (err: any) {
      console.warn('Chief of Staff execution error, falling back to basic command parser:', err);
    }
  }

  // Build context for AI execution fallback
  const today = todayIso();
  let contextBrief = `Today's Date: ${today}\n`;
  if (currentEntity) {
    contextBrief += `Active Entity: ${currentEntity.type}/${currentEntity.name}\n`;
    contextBrief += `Open Tasks:\n${currentEntity.tasks.filter(t => t.status === 'open').map(t => `- [line ${t.line} in ${t.path}] ${t.text} (${t.due ? `due ${t.due}` : ''})`).join('\n')}\n`;
  }

  const systemInstruction = `You are the executive AI assistant inside Cockpit for a Google Cloud Customer Engineer.
The user gave this command: "${command}"

Analyze the intent and return ONLY a valid JSON object matching one of these forms:

1. If the user wants to reclassify an entity tag (e.g. from Project to Conference):
{
  "type": "reclassify",
  "title": "Reclassify description",
  "reclassify": {
    "oldType": "Project",
    "oldName": "EntityName",
    "newType": "Conference"
  }
}

2. If the user wants to clean up, cancel, or mark tasks done:
{
  "type": "task_updates",
  "title": "Task cleanup proposal description",
  "taskUpdates": [
    {
      "path": "path/to/file.md",
      "line": 123,
      "currentText": "exact line text",
      "newStatus": "cancelled", // or "done"
      "reason": "older than 30d"
    }
  ]
}

3. If the user wants to draft an email, brief, or note:
{
  "type": "draft",
  "title": "Subject or Heading",
  "draft": {
    "heading": "Briefing / Subject",
    "content": "Full markdown content"
  }
}

4. If general query or clarification:
{
  "type": "message",
  "title": "AI Response",
  "message": "Answer or clarification"
}

Return ONLY raw JSON, no markdown codeblocks, no formatting.`;

  const resp = await requestUrl({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${systemInstruction}\n\nContext:\n${contextBrief}` }] }],
    }),
    throw: false,
  });

  if (resp.status >= 400) {
    const detail = (resp.json as { error?: { message?: string } })?.error?.message;
    throw new Error(detail ?? `Gemini returned ${resp.status}`);
  }

  const data = resp.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim();
  if (!rawText) throw new Error('No response from AI.');

  const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleanJson) as AiCommandResult;
  } catch (err) {
    return {
      type: 'draft',
      title: 'AI Output',
      draft: { content: rawText },
    };
  }
}

export function buildContext(
  e: EntityRecord,
  w: Window,
  all: Map<string, EntityRecord>,
  charBudget = 60_000,
): string {
  const nameOf = (key: string) => {
    if (key.startsWith('link/')) return `[[${key.slice(5)}]]`;
    if (key.startsWith('person/')) {
      return key
        .slice(7)
        .split(/\s+/)
        .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
        .join(' ');
    }
    const other = all.get(key);
    return other ? `${other.type}/${other.name}` : key;
  };
  const today = todayIso();
  const parts: string[] = [];

  parts.push(`Entity: ${e.type} / ${e.name}`);
  if (e.subs.size) parts.push(`Sub-areas: ${[...e.subs].join(', ')}`);
  parts.push(`Window shown: ${w.from} to ${w.to} (today is ${today})`);
  parts.push(`First seen ${e.firstSeen || 'unknown'}, last seen ${e.lastSeen || 'unknown'}, tagged in ${e.noteCount} notes.`);

  // Filter out same-type connections
  const related = [...e.related.entries()]
    .filter(([k]) => {
      const other = all.get(k);
      return !other || other.type.toLowerCase() !== e.type.toLowerCase();
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  if (related.length) {
    parts.push(`Connected stakeholders, partners & projects: ${related.map(([k, n]) => `${nameOf(k)} (${n})`).join(', ')}`);
  }

  const open = sortTasks(openTasks(e), today);
  if (open.length) {
    parts.push('\n## Open tasks (all time, not just the window)');
    for (const t of open) {
      const bits = [t.due ? `due ${t.due}` : '', isOverdue(t, today) ? 'OVERDUE' : '', t.priority ? `p${t.priority}` : '']
        .filter(Boolean).join(', ');
      parts.push(`- [ ] ${t.text}${bits ? ` (${bits})` : ''} — noted ${t.noteDate}`);
    }
  }

  const recentlyDone = e.tasks
    .filter(t => t.status === 'done' && (t.done ?? t.noteDate) >= w.from)
    .sort((a, b) => (b.done ?? b.noteDate).localeCompare(a.done ?? a.noteDate));
  if (recentlyDone.length) {
    parts.push('\n## Completed in the window');
    for (const t of recentlyDone.slice(0, 40)) {
      parts.push(`- [x] ${t.text} (${t.done ?? t.noteDate})`);
    }
  }

  parts.push('\n## Notes, newest first');
  let used = parts.join('\n').length;

  for (const a of e.activities) {
    if (a.date && a.date < w.from) continue;
    const block = [
      `\n### ${a.date || 'Undated'} — ${a.file}${a.heading ? ` > ${a.heading}` : ''}`,
      a.text,
    ].join('\n');
    if (used + block.length > charBudget) {
      parts.push('\n… (older notes in window omitted for length)');
      break;
    }
    parts.push(block);
    used += block.length;
  }

  return parts.join('\n');
}

/**
 * Builds rich portfolio context across all active entities in a time window
 * for Weekly and Monthly 2x2 synthesis.
 */
export function buildPortfolioContext(
  w: Window,
  all: Map<string, EntityRecord>,
  charBudget = 80_000,
): string {
  const today = todayIso();
  const parts: string[] = [];

  parts.push(`Portfolio Overview — Window: ${w.from} to ${w.to} (Today is ${today})`);

  // Active entities in this window
  const activeEntities = [...all.values()]
    .filter((e) => e.activities.some((a) => !a.date || a.date >= w.from) || e.tasks.some((t) => t.status === 'open'))
    .sort((a, b) => b.activities.length - a.activities.length);

  parts.push(`Total Active Accounts & Projects: ${activeEntities.length}`);

  // Summary of completions across portfolio
  const allRecentlyDone = activeEntities.flatMap((e) =>
    e.tasks
      .filter((t) => t.status === 'done' && (t.done ?? t.noteDate) >= w.from)
      .map((t) => ({ entity: e.name, type: e.type, text: t.text, date: t.done ?? t.noteDate }))
  ).sort((a, b) => b.date.localeCompare(a.date));

  if (allRecentlyDone.length) {
    parts.push(`\n## Completed Deliverables & Tasks (${allRecentlyDone.length})`);
    for (const t of allRecentlyDone.slice(0, 50)) {
      parts.push(`- [x] [${t.type}/${t.entity}] ${t.text} (${t.date})`);
    }
  }

  // Active open blockers (#waiting / overdue)
  const openBlockers = activeEntities.flatMap((e) =>
    openTasks(e)
      .filter((t) => t.text.includes('#waiting') || isOverdue(t, today))
      .map((t) => ({ entity: e.name, type: e.type, text: t.text, due: t.due }))
  );
  if (openBlockers.length) {
    parts.push(`\n## Active Blockers & Overdue Priorities (${openBlockers.length})`);
    for (const t of openBlockers.slice(0, 30)) {
      parts.push(`- [ ] [${t.type}/${t.entity}] ${t.text}${t.due ? ` (due ${t.due})` : ''}`);
    }
  }

  // Per-entity activities in the window
  parts.push('\n## Notes & Meeting Highlights by Entity (Newest First)');
  let used = parts.join('\n').length;

  for (const e of activeEntities) {
    const recentActs = e.activities.filter((a) => !a.date || a.date >= w.from);
    if (!recentActs.length) continue;

    parts.push(`\n### ${e.type}: ${e.name} (${recentActs.length} notes)`);
    for (const a of recentActs) {
      const block = `[${a.date || 'Undated'}] ${a.heading ? `${a.heading}: ` : ''}${a.text}`;
      if (used + block.length > charBudget) {
        parts.push('\n… (additional historical notes omitted for length)');
        return parts.join('\n');
      }
      parts.push(block);
      used += block.length;
    }
  }

  return parts.join('\n');
}
