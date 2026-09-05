import type { EntityRecord, RolodexIndex } from './types';

export interface ConnectedNode {
  key: string;
  name: string;
  type: 'Customer' | 'Partner' | 'Project' | 'Stakeholder' | 'Other';
  count: number;
  isEntity: boolean;
  targetPath?: string;
}

export interface GraphLayoutNode extends ConnectedNode {
  x: number;
  y: number;
  radius: number;
  color: string;
  borderColor: string;
  labelY: number;
  truncatedName: string;
}

export interface GraphCallbacks {
  onSelectEntity: (key: string) => void;
  onOpenNote: (pathOrTitle: string) => void;
  getNoteTitle?: (target: string) => string | null;
  currentMode?: 'graph' | 'chips';
  onToggleMode?: (mode: 'graph' | 'chips') => void;
}

export const SYSTEM_LINKS = new Set([
  'task hub',
  'support cases',
  'thread consolidation',
  'daily log',
  'scratch',
  'review',
  'templates',
  'template',
  'start here',
  'aging',
  'inbox',
  'tasks',
  'daily check list',
  'stale tasks',
  'workloads',
  '1on1s',
  'index',
  'skills catalog',
  'reading',
  'onboarding',
  'twb',
  'todos',
  'career',
  'cloud quick links',
  'fabric ai commands',
  'demo resources',
  'intro',
  'weekly review',
  'monthly review',
  'quarterly review',
]);

/**
 * Returns true if a wikilink target is an internal Obsidian meta-note,
 * an image/media attachment, a date link, or calendar meeting audio note.
 */
export function isSystemOrNoiseLink(rawTarget: string): boolean {
  const target = rawTarget.trim().toLowerCase();
  if (!target) return true;
  // Attachment images or files
  if (/\.(png|jpe?g|gif|webp|svg|pdf|mp4|mov)$/i.test(target)) return true;
  if (target.startsWith('pasted image')) return true;
  // Date links e.g. 2026-08-12
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(target)) return true;
  // Calendar / Audio meeting note suffixes e.g. "Meeting with Eric — notes"
  if (/[—–-]\s*notes$/i.test(target)) return true;
  // Direct match to system links
  if (SYSTEM_LINKS.has(target)) return true;
  return false;
}

export function toTitleCase(str: string): string {
  return str
    .split(/\s+/)
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

/**
 * Extracts, filters, and resolves connected entities from an EntityRecord's related map.
 */
export function getConnectedNodes(
  entity: EntityRecord,
  index?: RolodexIndex | null,
  getNoteTitle?: (target: string) => string | null,
  maxNodes = 12
): ConnectedNode[] {
  const nodeMap = new Map<string, ConnectedNode>();

  for (const [k, count] of entity.related.entries()) {
    if (k === entity.key) continue;

    if (k.startsWith('link/')) {
      const rawTarget = k.slice(5).trim();
      if (isSystemOrNoiseLink(rawTarget)) continue;
      if (rawTarget.toLowerCase() === entity.name.toLowerCase()) continue;

      // Check if this wikilink points to an existing Rolodex entity (Partner, Project, Customer)
      let resolvedKey: string | null = null;
      let matchedEntity: EntityRecord | undefined = undefined;

      const lower = rawTarget.toLowerCase();
      for (const prefix of ['partner/', 'project/', 'customer/']) {
        const testKey = prefix + lower;
        if (index?.entities.has(testKey)) {
          resolvedKey = testKey;
          matchedEntity = index.entities.get(testKey);
          break;
        }
      }

      if (matchedEntity && resolvedKey) {
        const existing = nodeMap.get(resolvedKey);
        if (existing) {
          existing.count += count;
        } else {
          nodeMap.set(resolvedKey, {
            key: resolvedKey,
            name: matchedEntity.name,
            type: normalizeType(matchedEntity.type),
            count,
            isEntity: true,
            targetPath: matchedEntity.notePath,
          });
        }
      } else {
        // Stakeholder / person or note link
        let displayName = getNoteTitle ? getNoteTitle(rawTarget) : null;
        if (!displayName) {
          displayName = toTitleCase(rawTarget);
        }

        const existing = nodeMap.get(k);
        if (existing) {
          existing.count += count;
        } else {
          nodeMap.set(k, {
            key: k,
            name: displayName,
            type: 'Stakeholder',
            count,
            isEntity: false,
            targetPath: rawTarget,
          });
        }
      }
    } else {
      // Tagged entity key (e.g. partner/altimetrik, project/alphaevolve, customer/suki)
      const other = index?.entities.get(k);
      const rawType = other?.type || k.split('/')[0] || 'Other';
      const normType = normalizeType(rawType);
      const displayName = other?.name || toTitleCase(k.split('/')[1] || k);

      const existing = nodeMap.get(k);
      if (existing) {
        existing.count += count;
      } else {
        nodeMap.set(k, {
          key: k,
          name: displayName,
          type: normType,
          count,
          isEntity: !!other,
          targetPath: other?.notePath,
        });
      }
    }
  }

  return [...nodeMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxNodes);
}

function normalizeType(typeStr: string): 'Customer' | 'Partner' | 'Project' | 'Stakeholder' | 'Other' {
  const lower = typeStr.toLowerCase();
  if (lower === 'customer') return 'Customer';
  if (lower === 'partner') return 'Partner';
  if (lower === 'project') return 'Project';
  if (lower === 'stakeholder' || lower === 'person') return 'Stakeholder';
  return 'Other';
}

export function getTypeColors(type: 'Customer' | 'Partner' | 'Project' | 'Stakeholder' | 'Other'): {
  color: string;
  borderColor: string;
  icon: string;
} {
  switch (type) {
    case 'Customer':
      return { color: '#ea580c', borderColor: '#fb923c', icon: '🏢' };
    case 'Partner':
      return { color: '#059669', borderColor: '#34d399', icon: '🤝' };
    case 'Project':
      return { color: '#7c3aed', borderColor: '#a78bfa', icon: '🚀' };
    case 'Stakeholder':
      return { color: '#0284c7', borderColor: '#38bdf8', icon: '👤' };
    default:
      return { color: '#64748b', borderColor: '#94a3b8', icon: '🔗' };
  }
}

/**
 * Calculates responsive coordinates and layouts for connected nodes around the hub.
 */
export function computeGraphLayout(
  nodes: ConnectedNode[],
  width = 600,
  height = 270
): {
  center: { x: number; y: number; radius: number };
  nodes: GraphLayoutNode[];
} {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const N = nodes.length;

  const rx = Math.min(210, width * 0.36);
  const ry = Math.min(84, height * 0.32);

  const layoutNodes: GraphLayoutNode[] = nodes.map((node, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    // Stagger radius slightly if more than 5 nodes to avoid horizontal/vertical label crowding
    const stagger = N > 5 && i % 2 === 1 ? 0.88 : 1.04;
    const x = Math.round(cx + rx * stagger * Math.cos(angle));
    const y = Math.round(cy + ry * stagger * Math.sin(angle));
    const radius = Math.min(19, Math.max(12, 11 + Math.round(Math.sqrt(node.count) * 2)));

    const { color, borderColor } = getTypeColors(node.type);
    const labelY = y < cy ? y - radius - 6 : y + radius + 14;
    const truncatedName = node.name.length > 15 ? node.name.slice(0, 14) + '…' : node.name;

    return {
      ...node,
      x,
      y,
      radius,
      color,
      borderColor,
      angle,
      labelY,
      truncatedName,
    };
  });

  return {
    center: { x: cx, y: cy, radius: 25 },
    nodes: layoutNodes,
  };
}

/**
 * Renders the Ecosystem Network section into the target container.
 */
export function renderEcosystemNetwork(
  container: HTMLElement,
  entity: EntityRecord,
  index: RolodexIndex | null | undefined,
  callbacks: GraphCallbacks
): void {
  const mode = callbacks.currentMode || 'graph';
  const nodes = getConnectedNodes(entity, index, callbacks.getNoteTitle, 12);

  const section = container.createDiv({ cls: 'rolodex-ecosystem-section' });

  // Header Bar
  const head = section.createDiv({ cls: 'rolodex-ecosystem-header' });
  const titleLeft = head.createDiv({ cls: 'rolodex-ecosystem-title' });
  titleLeft.createSpan({ text: '🌐 Ecosystem Network', cls: 'rolodex-ecosystem-title-text' });
  titleLeft.createSpan({
    text: `${nodes.length} connected`,
    cls: 'rolodex-chip is-mini rolodex-ecosystem-badge',
  });

  const toggles = head.createDiv({ cls: 'rolodex-ecosystem-toggles' });
  const graphBtn = toggles.createEl('button', {
    text: '🕸️ Graph',
    cls: `rolodex-chip is-mini ${mode === 'graph' ? 'is-on' : ''}`,
  });
  const chipsBtn = toggles.createEl('button', {
    text: '🏷️ Chips',
    cls: `rolodex-chip is-mini ${mode === 'chips' ? 'is-on' : ''}`,
  });

  graphBtn.addEventListener('click', () => {
    if (mode !== 'graph' && callbacks.onToggleMode) callbacks.onToggleMode('graph');
  });
  chipsBtn.addEventListener('click', () => {
    if (mode !== 'chips' && callbacks.onToggleMode) callbacks.onToggleMode('chips');
  });

  if (nodes.length === 0) {
    const empty = section.createDiv({ cls: 'rolodex-graph-empty' });
    empty.createDiv({ text: '🌐', cls: 'rolodex-graph-empty-icon' });
    empty.createDiv({
      text: 'No Connected Entities Detected',
      cls: 'rolodex-graph-empty-title',
    });
    empty.createDiv({
      text: 'Tag partners (#Partner/...), projects (#Project/...), or link collaborators ([[Jane Doe]]) in daily notes to visualize connections.',
      cls: 'rolodex-graph-empty-sub',
    });
    return;
  }

  if (mode === 'chips') {
    renderChipsView(section, nodes, callbacks);
  } else {
    renderSvgGraphView(section, entity, nodes, callbacks);
  }
}

function renderChipsView(
  container: HTMLElement,
  nodes: ConnectedNode[],
  callbacks: GraphCallbacks
): void {
  const chipRow = container.createDiv({ cls: 'rolodex-chips rolodex-ecosystem-chips' });
  for (const node of nodes) {
    const { color, icon } = getTypeColors(node.type);
    const btn = chipRow.createEl('button', {
      cls: 'rolodex-chip is-mini rolodex-ecosystem-chip',
    });
    btn.setAttr('title', `${node.type}: ${node.name} (${node.count} touches)`);

    const dot = btn.createSpan({ cls: 'rolodex-legend-dot' });
    dot.style.backgroundColor = color;

    btn.createSpan({ text: `${icon} ${node.name} ` });
    btn.createSpan({ text: `${node.count}`, cls: 'rolodex-muted' });

    btn.addEventListener('click', () => {
      if (node.isEntity) {
        callbacks.onSelectEntity(node.key);
      } else {
        callbacks.onOpenNote(node.targetPath || node.name);
      }
    });
  }
}

function renderSvgGraphView(
  container: HTMLElement,
  entity: EntityRecord,
  nodes: ConnectedNode[],
  callbacks: GraphCallbacks
): void {
  const wrapper = container.createDiv({ cls: 'rolodex-graph-wrapper' });

  // Floating rich tooltip
  const tooltip = wrapper.createDiv({ cls: 'rolodex-graph-tooltip' });
  tooltip.style.display = 'none';

  const width = 600;
  const height = 270;
  const layout = computeGraphLayout(nodes, width, height);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'rolodex-graph-svg');

  // Defs: Filters & Radial Gradients
  const defs = document.createElementNS(svgNS, 'defs');

  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', 'rolodex-glow');
  filter.setAttribute('x', '-30%');
  filter.setAttribute('y', '-30%');
  filter.setAttribute('width', '160%');
  filter.setAttribute('height', '160%');

  const blur = document.createElementNS(svgNS, 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '3.5');
  blur.setAttribute('result', 'blur');
  filter.appendChild(blur);

  const merge = document.createElementNS(svgNS, 'feMerge');
  const m1 = document.createElementNS(svgNS, 'feMergeNode');
  m1.setAttribute('in', 'blur');
  const m2 = document.createElementNS(svgNS, 'feMergeNode');
  m2.setAttribute('in', 'SourceGraphic');
  merge.appendChild(m1);
  merge.appendChild(m2);
  filter.appendChild(merge);
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Group for Edges
  const edgeGroup = document.createElementNS(svgNS, 'g');
  edgeGroup.setAttribute('class', 'rolodex-graph-edges');
  svg.appendChild(edgeGroup);

  const edgeElements = new Map<string, SVGLineElement>();

  for (const node of layout.nodes) {
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', String(layout.center.x));
    line.setAttribute('y1', String(layout.center.y));
    line.setAttribute('x2', String(node.x));
    line.setAttribute('y2', String(node.y));
    line.setAttribute('stroke', node.borderColor);
    line.setAttribute('stroke-width', String(1.6 + Math.min(3, Math.sqrt(node.count))));
    line.setAttribute('stroke-opacity', '0.35');
    line.setAttribute('class', 'rolodex-graph-edge');
    line.setAttribute('data-key', node.key);
    edgeGroup.appendChild(line);
    edgeElements.set(node.key, line);
  }

  // Group for Nodes
  const nodeGroup = document.createElementNS(svgNS, 'g');
  nodeGroup.setAttribute('class', 'rolodex-graph-nodes');
  svg.appendChild(nodeGroup);

  // Center Hub Node
  const hubNormType = normalizeType(entity.type);
  const { color: hubColor, borderColor: hubBorder, icon: hubIcon } = getTypeColors(hubNormType);

  const hubG = document.createElementNS(svgNS, 'g');
  hubG.setAttribute('class', 'rolodex-graph-hub');
  hubG.style.cursor = entity.notePath ? 'pointer' : 'default';

  const hubHalo = document.createElementNS(svgNS, 'circle');
  hubHalo.setAttribute('cx', String(layout.center.x));
  hubHalo.setAttribute('cy', String(layout.center.y));
  hubHalo.setAttribute('r', '33');
  hubHalo.setAttribute('class', 'rolodex-hub-halo');
  hubHalo.setAttribute('stroke', hubBorder);
  hubHalo.setAttribute('stroke-width', '1.5');
  hubG.appendChild(hubHalo);

  const hubCircle = document.createElementNS(svgNS, 'circle');
  hubCircle.setAttribute('cx', String(layout.center.x));
  hubCircle.setAttribute('cy', String(layout.center.y));
  hubCircle.setAttribute('r', String(layout.center.radius));
  hubCircle.setAttribute('fill', hubColor);
  hubCircle.setAttribute('stroke', hubBorder);
  hubCircle.setAttribute('stroke-width', '2.5');
  hubCircle.setAttribute('class', 'rolodex-hub-circle');
  hubG.appendChild(hubCircle);

  const hubText = document.createElementNS(svgNS, 'text');
  hubText.setAttribute('x', String(layout.center.x));
  hubText.setAttribute('y', String(layout.center.y + 6));
  hubText.setAttribute('text-anchor', 'middle');
  hubText.setAttribute('class', 'rolodex-hub-icon');
  hubText.textContent = hubIcon;
  hubG.appendChild(hubText);

  const hubLabel = document.createElementNS(svgNS, 'text');
  hubLabel.setAttribute('x', String(layout.center.x));
  hubLabel.setAttribute('y', String(layout.center.y + 42));
  hubLabel.setAttribute('text-anchor', 'middle');
  hubLabel.setAttribute('class', 'rolodex-hub-label');
  hubLabel.textContent = entity.name;
  hubG.appendChild(hubLabel);

  hubG.addEventListener('mouseenter', () => {
    hubHalo.setAttribute('filter', 'url(#rolodex-glow)');
    for (const line of edgeElements.values()) {
      line.classList.add('is-highlighted');
    }
    tooltip.innerHTML = `
      <div class="rolodex-tooltip-header">
        <span class="rolodex-tooltip-badge" style="background: ${hubColor}30; color: ${hubBorder}; border: 1px solid ${hubBorder}60;">
          ${hubIcon} ${entity.type}
        </span>
        <span class="rolodex-tooltip-count">${entity.activities.length} touches</span>
      </div>
      <div class="rolodex-tooltip-title">${entity.name}</div>
      <div class="rolodex-tooltip-hint">${nodes.length} connected partners, projects & stakeholders</div>
    `;
    tooltip.style.left = `${(layout.center.x / width) * 100}%`;
    tooltip.style.top = `${(layout.center.y / height) * 100}%`;
    tooltip.style.transform = 'translate(-50%, -125%)';
    tooltip.style.display = 'block';
  });

  hubG.addEventListener('mouseleave', () => {
    hubHalo.removeAttribute('filter');
    for (const line of edgeElements.values()) {
      line.classList.remove('is-highlighted');
    }
    tooltip.style.display = 'none';
  });

  if (entity.notePath) {
    hubG.addEventListener('click', () => callbacks.onOpenNote(entity.notePath!));
  }

  nodeGroup.appendChild(hubG);

  // Satellite Nodes
  const nodeElements: SVGGElement[] = [];

  for (const node of layout.nodes) {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'rolodex-graph-node');
    g.setAttribute('data-key', node.key);
    g.style.cursor = 'pointer';

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', String(node.radius));
    circle.setAttribute('fill', node.color);
    circle.setAttribute('stroke', node.borderColor);
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('class', 'rolodex-node-circle');
    g.appendChild(circle);

    const countText = document.createElementNS(svgNS, 'text');
    countText.setAttribute('x', String(node.x));
    countText.setAttribute('y', String(node.y + 4));
    countText.setAttribute('text-anchor', 'middle');
    countText.setAttribute('class', 'rolodex-node-count');
    countText.textContent = String(node.count);
    g.appendChild(countText);

    const nameLabel = document.createElementNS(svgNS, 'text');
    nameLabel.setAttribute('x', String(node.x));
    nameLabel.setAttribute('y', String(node.labelY));
    nameLabel.setAttribute('text-anchor', 'middle');
    nameLabel.setAttribute('class', 'rolodex-node-label');
    nameLabel.textContent = node.truncatedName;
    g.appendChild(nameLabel);

    // Hover micro-interactions
    g.addEventListener('mouseenter', () => {
      circle.setAttribute('filter', 'url(#rolodex-glow)');
      const matchedLine = edgeElements.get(node.key);
      if (matchedLine) matchedLine.classList.add('is-highlighted');

      // Dim other nodes & edges
      for (const [k, line] of edgeElements) {
        if (k !== node.key) line.classList.add('is-dimmed');
      }
      for (const el of nodeElements) {
        if (el !== g) el.classList.add('is-dimmed');
      }

      const { icon } = getTypeColors(node.type);
      tooltip.innerHTML = `
        <div class="rolodex-tooltip-header">
          <span class="rolodex-tooltip-badge" style="background: ${node.color}30; color: ${node.borderColor}; border: 1px solid ${node.borderColor}60;">
            ${icon} ${node.type}
          </span>
          <span class="rolodex-tooltip-count">${node.count} shared touches</span>
        </div>
        <div class="rolodex-tooltip-title">${node.name}</div>
        <div class="rolodex-tooltip-hint">${node.isEntity ? '⚡ Click to drill in' : '📄 Click to open note'}</div>
      `;
      tooltip.style.left = `${(node.x / width) * 100}%`;
      tooltip.style.top = `${(node.y / height) * 100}%`;
      const isTopHalf = node.y < layout.center.y;
      tooltip.style.transform = `translate(-50%, ${isTopHalf ? '20px' : '-120%'})`;
      tooltip.style.display = 'block';
    });

    g.addEventListener('mouseleave', () => {
      circle.removeAttribute('filter');
      const matchedLine = edgeElements.get(node.key);
      if (matchedLine) matchedLine.classList.remove('is-highlighted');

      for (const line of edgeElements.values()) {
        line.classList.remove('is-dimmed');
      }
      for (const el of nodeElements) {
        el.classList.remove('is-dimmed');
      }
      tooltip.style.display = 'none';
    });

    // Click handler
    g.addEventListener('click', () => {
      if (node.isEntity) {
        callbacks.onSelectEntity(node.key);
      } else {
        callbacks.onOpenNote(node.targetPath || node.name);
      }
    });

    nodeGroup.appendChild(g);
    nodeElements.push(g);
  }

  wrapper.appendChild(svg);

  // Legend Bar
  const legend = container.createDiv({ cls: 'rolodex-graph-legend' });
  const legendTypes: Array<{ type: 'Project' | 'Partner' | 'Stakeholder' | 'Customer'; label: string }> = [
    { type: 'Project', label: 'Project' },
    { type: 'Partner', label: 'Partner' },
    { type: 'Stakeholder', label: 'Stakeholder' },
    { type: 'Customer', label: 'Customer' },
  ];

  for (const item of legendTypes) {
    const { color } = getTypeColors(item.type);
    const it = legend.createSpan({ cls: 'rolodex-legend-item' });
    const dot = it.createSpan({ cls: 'rolodex-legend-dot' });
    dot.style.backgroundColor = color;
    it.createSpan({ text: item.label });
  }
}
