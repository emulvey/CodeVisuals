(() => {
  const DATA = window.__GLASSBOX_DATA__;
  if (!DATA) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const LAYER_COLORS = {
    entry: '#38bdf8',
    orchestration: '#818cf8',
    domain: '#34d399',
    data: '#fbbf24'
  };

  const LIB_COLORS = {
    web: '#38bdf8',
    ui: '#f472b6',
    data: '#fbbf24',
    ai: '#c084fc',
    crypto: '#fb7185',
    io: '#34d399',
    stdlib: '#94a3b8',
    util: '#a78bfa'
  };

  const SEV_COLORS = {
    critical: '#fb7185',
    warning: '#fbbf24',
    info: '#60a5fa'
  };

  // Fast Lookup Maps
  const modById = new Map(DATA.modules.map((m) => [m.id, m]));
  const fnById = new Map(DATA.functions.map((f) => [f.id, f]));
  const libById = new Map(DATA.libraries.map((l) => [l.id, l]));
  const modEdgeById = new Map(DATA.moduleEdges.map((e) => [e.id, e]));
  const callEdgeById = new Map(DATA.callEdges.map((e) => [e.id, e]));
  const flowById = new Map(DATA.flows.map((f) => [f.id, f]));

  const diagsByMod = new Map();
  const diagsByFn = new Map();
  for (const d of DATA.diagnostics) {
    if (!diagsByMod.has(d.moduleId)) diagsByMod.set(d.moduleId, []);
    diagsByMod.get(d.moduleId).push(d);
    if (d.functionId) {
      if (!diagsByFn.has(d.functionId)) diagsByFn.set(d.functionId, []);
      diagsByFn.get(d.functionId).push(d);
    }
  }

  // Application State
  const state = {
    zoomLevel: 2, // 1: Atlas, 2: Circuit, 3: Dataflow
    camera: { x: 40, y: 40, k: 1 },
    selection: null, // { type: 'module'|'function'|'library'|'callEdge'|'modEdge', id }
    hover: null,
    riskLens: false,
    riskFilter: 'all',
    riskExpanded: false,
    activeTrace: null, // flow object
    traceHop: 0,
    traceTimer: null,
    tourIndex: -1,
    activeTab: 'explain',
    plainEnglishMode: true,
    storyOpen: false,
    storyExpanded: false,
    inspectorExpanded: false,
    searchShowAll: false,
    searchSelectedIndex: 0,
    theme: 'dark',
    layout: null,
    animFrame: null
  };

  // DOM References
  const el = {
    stage: document.getElementById('canvas-stage'),
    svg: document.getElementById('circuit-svg'),
    viewport: document.getElementById('viewport-group'),
    layerZones: document.getElementById('layer-zones'),
    layerEdges: document.getElementById('layer-edges'),
    layerNodes: document.getElementById('layer-nodes'),
    layerOverlays: document.getElementById('layer-overlays'),
    minimap: document.getElementById('minimap-svg'),
    tooltip: document.getElementById('hover-tooltip'),
    breadcrumbs: document.getElementById('breadcrumb-bar'),
    projectTitle: document.getElementById('project-title'),
    projectMeta: document.getElementById('project-meta'),
    flowCount: document.getElementById('flow-count'),
    riskCount: document.getElementById('risk-count'),
    healthScoreVal: document.getElementById('health-score-val'),
    healthRingFg: document.getElementById('health-ring-fg'),
    healthPill: document.getElementById('health-pill'),
    btnStory: document.getElementById('btn-story'),
    btnPlainMode: document.getElementById('btn-plain-mode'),
    storyPanel: document.getElementById('story-panel'),
    btnExpandStory: document.getElementById('story-expand'),
    storyArchetype: document.getElementById('story-archetype'),
    storyHeadline: document.getElementById('story-headline'),
    storyConcepts: document.getElementById('story-concepts'),
    storySections: document.getElementById('story-sections'),
    btnFlows: document.getElementById('btn-flows'),
    flowPopover: document.getElementById('flow-popover'),
    btnRisk: document.getElementById('btn-risk'),
    btnTour: document.getElementById('btn-tour'),
    btnSearch: document.getElementById('btn-search'),
    btnTheme: document.getElementById('btn-theme'),
    themeGlyph: document.getElementById('theme-glyph'),
    zoomPct: document.getElementById('zoom-pct'),
    inspector: document.getElementById('inspector'),
    btnExpandInspector: document.getElementById('insp-expand'),
    inspBadges: document.getElementById('insp-badges'),
    inspTitle: document.getElementById('insp-title'),
    inspSubtitle: document.getElementById('insp-subtitle'),
    inspActions: document.getElementById('insp-actions'),
    inspExplain: document.getElementById('insp-body-explain'),
    inspVisual: document.getElementById('insp-body-visual'),
    inspSource: document.getElementById('insp-body-source'),
    traceDock: document.getElementById('trace-dock'),
    traceTitle: document.getElementById('trace-title'),
    traceHopCounter: document.getElementById('trace-hop-counter'),
    traceBeads: document.getElementById('trace-beads'),
    tracePacket: document.getElementById('trace-packet'),
    traceNarration: document.getElementById('trace-narration'),
    tracePlay: document.getElementById('trace-play'),
    riskDock: document.getElementById('risk-dock'),
    btnExpandRisk: document.getElementById('btn-expand-risk'),
    riskDockSummary: document.getElementById('risk-dock-summary'),
    riskFilters: document.getElementById('risk-filters'),
    riskList: document.getElementById('risk-list'),
    riskDockFooter: document.getElementById('risk-dock-footer'),
    tourCard: document.getElementById('tour-card'),
    tourTitle: document.getElementById('tour-title'),
    tourCaption: document.getElementById('tour-caption'),
    tourDots: document.getElementById('tour-dots'),
    tourNext: document.getElementById('tour-next'),
    searchModal: document.getElementById('search-modal'),
    searchInput: document.getElementById('search-input'),
    searchResults: document.getElementById('search-results')
  };

  function svgEl(tag, attrs = {}, text = null) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== null && v !== undefined) node.setAttribute(k, String(v));
    }
    if (text !== null) node.textContent = text;
    return node;
  }

  function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function trunc(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function langShort(lang) {
    const map = { typescript: 'TS', javascript: 'JS', python: 'PY', go: 'GO', rust: 'RS', java: 'JV', cpp: 'C++', c: 'C', csharp: 'C#' };
    return map[lang] || (lang || 'SRC').slice(0, 3).toUpperCase();
  }

  function complexityRatio(c) {
    return Math.max(0.12, Math.min(1, c / 14));
  }

  function complexityColor(c) {
    if (c >= 12) return '#fb7185';
    if (c >= 7) return '#fbbf24';
    return '#34d399';
  }

  function formatGlyphs(flags) {
    const g = [];
    if (flags?.hasAsync) g.push('⚡');
    if (flags?.hasIO) g.push('⇄');
    if (flags?.hasMutation) g.push('✎');
    if (flags?.hasBranch) g.push('⑂');
    if (flags?.hasLoop) g.push('↻');
    return g.join(' ');
  }

  function getModFlags(mod) {
    const fns = mod.functionIds.map((id) => fnById.get(id)).filter(Boolean);
    return {
      hasAsync: fns.some((f) => f.isAsync || f.flags?.hasAsync),
      hasIO: fns.some((f) => f.flags?.hasIO),
      hasMutation: fns.some((f) => f.flags?.hasMutation),
      hasBranch: fns.some((f) => f.flags?.hasBranch),
      hasLoop: fns.some((f) => f.flags?.hasLoop)
    };
  }

  // =========================================================================
  // 1. DETERMINISTIC LAYERED CIRCUIT LAYOUT ENGINE (Sugiyama-Inspired)
  // =========================================================================

  function orderModulesBarycenter(activeLayers) {
    const colOrder = new Map();
    for (const layer of activeLayers) {
      // Initial sort: entrypoints first, then highest fan-out + fan-in
      const list = [...layer.moduleIds].sort((a, b) => {
        const ma = modById.get(a);
        const mb = modById.get(b);
        const sa = (ma.isEntryPoint ? 100 : 0) + ma.metrics.fanOut * 3 + ma.metrics.fanIn;
        const sb = (mb.isEntryPoint ? 100 : 0) + mb.metrics.fanOut * 3 + mb.metrics.fanIn;
        return sb - sa || a.localeCompare(b);
      });
      colOrder.set(layer.id, list);
    }

    // 3 barycenter sweeps left-to-right & right-to-left to untangle wires
    for (let sweep = 0; sweep < 3; sweep++) {
      const rank = new Map();
      for (const list of colOrder.values()) {
        list.forEach((id, idx) => rank.set(id, idx));
      }
      for (const layer of activeLayers) {
        const list = colOrder.get(layer.id);
        list.sort((a, b) => {
          const neighborsA = DATA.moduleEdges.filter((e) => e.from === a || e.to === a).map((e) => (e.from === a ? e.to : e.from));
          const neighborsB = DATA.moduleEdges.filter((e) => e.from === b || e.to === b).map((e) => (e.from === b ? e.to : e.from));
          const avgA = neighborsA.length ? neighborsA.reduce((s, id) => s + (rank.get(id) ?? 0), 0) / neighborsA.length : rank.get(a);
          const avgB = neighborsB.length ? neighborsB.reduce((s, id) => s + (rank.get(id) ?? 0), 0) / neighborsB.length : rank.get(b);
          return avgA - avgB;
        });
      }
    }
    return colOrder;
  }

  function computeLayout(level) {
    const activeLayers = DATA.layers.filter((l) => l.moduleIds.length > 0);
    const colOrder = orderModulesBarycenter(activeLayers);

    if (level === 1) return layoutAtlas(activeLayers);
    if (level === 2) return layoutCircuit(activeLayers, colOrder);
    return layoutDataflow(activeLayers, colOrder);
  }

  function layoutAtlas(activeLayers) {
    const zones = [];
    const nodes = new Map();
    const edges = [];
    const W = 264;
    const H = 220;
    const GAP_X = 115;
    const startX = 60;
    const startY = 80;

    activeLayers.forEach((layer, idx) => {
      const x = startX + idx * (W + GAP_X);
      const y = startY;
      const mods = layer.moduleIds.map((id) => modById.get(id)).filter(Boolean);
      const fnCount = mods.reduce((s, m) => s + m.functionIds.length, 0);
      const diagCount = mods.reduce((s, m) => s + m.metrics.diagnosticCount, 0);
      const lines = mods.reduce((s, m) => s + m.lines, 0);
      nodes.set(layer.id, {
        kind: 'atlasLayer',
        id: layer.id,
        layer,
        x, y, w: W, h: H,
        inPin: { x, y: y + H / 2 },
        outPin: { x: x + W, y: y + H / 2 },
        mods, fnCount, diagCount, lines
      });
    });

    // External Library Territory below
    const totalW = Math.max(W, activeLayers.length * W + Math.max(0, activeLayers.length - 1) * GAP_X);
    if (DATA.libraries.length > 0) {
      const libH = 104;
      const libY = startY + H + 90;
      nodes.set('atlas::libs', {
        kind: 'atlasLibs',
        id: 'atlas::libs',
        x: startX,
        y: libY,
        w: totalW,
        h: libH,
        inPin: { x: startX + totalW / 2, y: libY },
        outPin: { x: startX + totalW / 2, y: libY }
      });
    }

    // Aggregate module edges into layer-to-layer ribbons
    const agg = new Map();
    for (const e of DATA.moduleEdges) {
      const mf = modById.get(e.from);
      const mt = modById.get(e.to);
      if (!mf || !mt || mf.layer === mt.layer) continue;
      const key = `${mf.layer}-->${mt.layer}`;
      if (!agg.has(key)) {
        agg.set(key, { id: `ae::${key}`, from: mf.layer, to: mt.layer, weight: 0, edgeCount: 0, isCycle: false });
      }
      const a = agg.get(key);
      a.weight += e.weight;
      a.edgeCount++;
      if (e.isCycle) a.isCycle = true;
    }

    for (const a of agg.values()) {
      const nf = nodes.get(a.from);
      const nt = nodes.get(a.to);
      if (!nf || !nt) continue;
      edges.push({ kind: 'atlasEdge', ...a, fromNode: nf, toNode: nt });
    }

    const bounds = {
      minX: 20,
      minY: 20,
      maxX: startX + totalW + 60,
      maxY: startY + H + (DATA.libraries.length ? 240 : 80)
    };
    return { level: 1, zones, nodes, edges, bounds };
  }

  function layoutCircuit(activeLayers, colOrder) {
    const zones = [];
    const nodes = new Map();
    const edges = [];

    const CARD_W = 248;
    const CARD_H = 98;
    const GAP_Y = 26;
    const COL_GAP = 128;
    const PAD_X = 22;
    const PAD_TOP = 56;
    const PAD_BOT = 24;

    let curX = 60;
    let maxColBottom = 0;

    for (const layer of activeLayers) {
      const modIds = colOrder.get(layer.id) || [];
      // If a column has > 8 modules, wrap cleanly into 2 sub-columns to keep aspect ratio balanced
      const subCols = modIds.length > 8 ? 2 : 1;
      const perSub = Math.ceil(modIds.length / subCols);
      const zoneW = subCols * CARD_W + (subCols - 1) * 32 + PAD_X * 2;
      const zoneH = PAD_TOP + perSub * CARD_H + Math.max(0, perSub - 1) * GAP_Y + PAD_BOT;

      zones.push({
        id: `zone::${layer.id}`,
        layer,
        x: curX,
        y: 50,
        w: zoneW,
        h: zoneH
      });

      modIds.forEach((modId, idx) => {
        const sc = Math.floor(idx / perSub);
        const row = idx % perSub;
        const x = curX + PAD_X + sc * (CARD_W + 32);
        const y = 50 + PAD_TOP + row * (CARD_H + GAP_Y);
        const mod = modById.get(modId);
        nodes.set(modId, {
          kind: 'module',
          id: modId,
          mod,
          x, y, w: CARD_W, h: CARD_H,
          colIndex: layer.order,
          inPin: { x, y: y + CARD_H / 2 },
          outPin: { x: x + CARD_W, y: y + CARD_H / 2 }
        });
      });

      maxColBottom = Math.max(maxColBottom, 50 + zoneH);
      curX += zoneW + COL_GAP;
    }

    const totalMainW = Math.max(520, curX - COL_GAP - 60);

    // External Library Bus Rail cleanly docked along the bottom
    let maxY = maxColBottom + 50;
    if (DATA.libraries.length > 0) {
      const busY = maxColBottom + 66;
      const LIB_W = 158;
      const LIB_H = 52;
      const LIB_GAP = 14;
      const cols = Math.max(3, Math.floor((totalMainW - 40) / (LIB_W + LIB_GAP)));
      const rows = Math.ceil(DATA.libraries.length / cols);
      const busH = 54 + rows * LIB_H + Math.max(0, rows - 1) * LIB_GAP + 18;

      zones.push({
        id: 'zone::libraries',
        layer: { id: 'libraries', label: 'External Library Bus', subtitle: 'Click any package to illuminate every connected module', color: '#c084fc' },
        x: 60,
        y: busY,
        w: Math.max(totalMainW, cols * (LIB_W + LIB_GAP) + 32),
        h: busH
      });

      DATA.libraries.forEach((lib, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const x = 60 + 20 + c * (LIB_W + LIB_GAP);
        const y = busY + 50 + r * (LIB_H + LIB_GAP);
        nodes.set(lib.id, {
          kind: 'library',
          id: lib.id,
          lib,
          x, y, w: LIB_W, h: LIB_H,
          inPin: { x: x + LIB_W / 2, y },
          outPin: { x: x + LIB_W / 2, y }
        });
      });
      maxY = busY + busH + 50;
    }

    for (const e of DATA.moduleEdges) {
      const nf = nodes.get(e.from);
      const nt = nodes.get(e.to);
      if (!nf || !nt) continue;
      edges.push({ kind: 'modEdge', ...e, fromNode: nf, toNode: nt });
    }

    const bounds = {
      minX: 20,
      minY: 15,
      maxX: Math.max(curX - COL_GAP + 50, 60 + totalMainW + 50),
      maxY
    };
    return { level: 2, zones, nodes, edges, bounds };
  }

  function layoutDataflow(activeLayers, colOrder) {
    const zones = [];
    const nodes = new Map();
    const edges = [];

    const FN_W = 286;
    const FN_H = 74;
    const FN_GAP = 14;
    const MOD_PAD_X = 16;
    const MOD_PAD_TOP = 42;
    const MOD_PAD_BOT = 14;
    const MOD_GAP_Y = 26;
    const COL_GAP = 160;
    const LAYER_PAD_X = 20;
    const LAYER_PAD_TOP = 54;

    let curX = 60;
    let maxY = 240;

    for (const layer of activeLayers) {
      const modIds = colOrder.get(layer.id) || [];
      let curY = 50 + LAYER_PAD_TOP;
      const modW = FN_W + MOD_PAD_X * 2;
      const zoneStartY = 50;

      for (const modId of modIds) {
        const mod = modById.get(modId);
        const fns = mod.functionIds.map((id) => fnById.get(id)).filter(Boolean);
        const boxH = fns.length
          ? MOD_PAD_TOP + fns.length * FN_H + (fns.length - 1) * FN_GAP + MOD_PAD_BOT
          : 64;

        // Module enclosure
        zones.push({
          id: `modbox::${modId}`,
          kind: 'moduleBox',
          mod,
          layer,
          x: curX + LAYER_PAD_X,
          y: curY,
          w: modW,
          h: boxH
        });

        fns.forEach((fn, idx) => {
          const fx = curX + LAYER_PAD_X + MOD_PAD_X;
          const fy = curY + MOD_PAD_TOP + idx * (FN_H + FN_GAP);
          nodes.set(fn.id, {
            kind: 'function',
            id: fn.id,
            fn,
            mod,
            layer,
            colIndex: layer.order,
            x: fx, y: fy, w: FN_W, h: FN_H,
            inPin: { x: fx, y: fy + FN_H / 2 },
            outPin: { x: fx + FN_W, y: fy + FN_H / 2 }
          });
        });

        curY += boxH + MOD_GAP_Y;
      }

      const zoneW = modW + LAYER_PAD_X * 2;
      const zoneH = Math.max(160, curY - zoneStartY);
      zones.unshift({
        id: `zone::${layer.id}`,
        kind: 'layerZone',
        layer,
        x: curX,
        y: zoneStartY,
        w: zoneW,
        h: zoneH
      });

      maxY = Math.max(maxY, zoneStartY + zoneH + 60);
      curX += zoneW + COL_GAP;
    }

    for (const e of DATA.callEdges) {
      const nf = nodes.get(e.from);
      const nt = nodes.get(e.to);
      if (!nf || !nt) continue;
      edges.push({ kind: 'callEdge', ...e, fromNode: nf, toNode: nt });
    }

    const bounds = {
      minX: 20,
      minY: 15,
      maxX: curX - COL_GAP + 70,
      maxY
    };
    return { level: 3, zones, nodes, edges, bounds };
  }

  // =========================================================================
  // 2. CURVE ROUTING FOR SCHEMATIC WIRES
  // =========================================================================

  function computeWirePath(fromNode, toNode, isCycle, sameColOffset = 0) {
    const x1 = fromNode.outPin.x;
    const y1 = fromNode.outPin.y;
    const x2 = toNode.inPin.x;
    const y2 = toNode.inPin.y;

    // Backward or cycle wire -> graceful overhead arch so feedback loops pop out immediately!
    if (isCycle || x2 <= x1 - 10) {
      // Check if same column (vertical call inside same module or layer)
      if (Math.abs(fromNode.x - toNode.x) < 40) {
        const bow = 46 + (sameColOffset % 4) * 18;
        const rx = fromNode.x + fromNode.w;
        const d = `M ${rx} ${y1} C ${rx + bow} ${y1}, ${rx + bow} ${y2}, ${rx} ${y2}`;
        return { d, labelX: rx + bow * 0.78, labelY: (y1 + y2) / 2 };
      }
      const archLift = Math.min(130, 55 + Math.abs(x1 - x2) * 0.14);
      const topY = Math.min(y1, y2) - archLift;
      const d = `M ${x1} ${y1} C ${x1 + 50} ${topY}, ${x2 - 50} ${topY}, ${x2} ${y2}`;
      return { d, labelX: (x1 + x2) / 2, labelY: topY + 14 };
    }

    // Standard left-to-right smooth schematic Bézier bus
    const dx = Math.max(48, (x2 - x1) * 0.48);
    const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    return { d, labelX: (x1 + x2) / 2, labelY: (y1 + y2) / 2 };
  }

  // =========================================================================
  // 3. FOCUS / SPOTLIGHT SET COMPUTATION (Zero-Hairball Highlighting)
  // =========================================================================

  function collectEgoNeighbors(focusTarget, activeNodes, activeEdges) {
    const { type, id } = focusTarget;
    activeNodes.add(id);

    if (type === 'module') {
      for (const e of DATA.moduleEdges) {
        if (e.from === id || e.to === id) {
          activeEdges.add(e.id);
          activeNodes.add(e.from);
          activeNodes.add(e.to);
        }
      }
      for (const libName of modById.get(id)?.libraries || []) activeNodes.add(`lib::${libName}`);
    } else if (type === 'function') {
      for (const e of DATA.callEdges) {
        if (e.from === id || e.to === id) {
          activeEdges.add(e.id);
          activeNodes.add(e.from);
          activeNodes.add(e.to);
        }
      }
    } else if (type === 'library') {
      for (const mId of libById.get(id)?.moduleIds || []) activeNodes.add(mId);
    } else if (type === 'callEdge' || type === 'modEdge') {
      const edge = type === 'callEdge' ? callEdgeById.get(id) : modEdgeById.get(id);
      if (edge) {
        activeEdges.add(edge.id);
        activeNodes.add(edge.from);
        activeNodes.add(edge.to);
      }
    }
  }

  function getActiveFocusSets() {
    const activeNodes = new Set();
    const activeEdges = new Set();

    if (state.activeTrace) {
      for (const id of state.activeTrace.functionIds) activeNodes.add(id);
      for (const id of state.activeTrace.moduleIds) activeNodes.add(id);
      for (const hop of state.activeTrace.hops) if (hop.edgeId) activeEdges.add(hop.edgeId);
      for (const e of DATA.moduleEdges) {
        if (activeNodes.has(e.from) && activeNodes.has(e.to)) activeEdges.add(e.id);
      }
      return { hasFocus: true, activeNodes, activeEdges };
    }

    if (state.riskLens) {
      for (const d of getFilteredDiagnostics()) {
        activeNodes.add(d.moduleId);
        if (d.functionId) activeNodes.add(d.functionId);
        for (const r of d.relatedIds || []) activeNodes.add(r);
      }
      for (const e of DATA.moduleEdges) if (e.isCycle) activeEdges.add(e.id);
      for (const e of DATA.callEdges) if (e.isCycle) activeEdges.add(e.id);
      return { hasFocus: true, activeNodes, activeEdges };
    }

    const focusTarget = state.selection || state.hover;
    if (!focusTarget) return { hasFocus: false, activeNodes, activeEdges };

    collectEgoNeighbors(focusTarget, activeNodes, activeEdges);
    return { hasFocus: true, activeNodes, activeEdges };
  }

  // =========================================================================
  // 4. SVG RENDERING FOR ALL 3 SEMANTIC ZOOM LEVELS
  // =========================================================================

  function applyHoverSpotlight() {
    if (!state.layout) return;
    const focus = getActiveFocusSets();

    el.layerNodes.querySelectorAll('[data-node-id]').forEach((elNode) => {
      const nid = elNode.getAttribute('data-node-id');
      const dim = focus.hasFocus && !focus.activeNodes.has(nid);
      elNode.classList.toggle('dimmed', dim);
    });

    el.layerEdges.querySelectorAll('[data-edge-id]').forEach((elEdge) => {
      const eid = elEdge.getAttribute('data-edge-id');
      const dim = focus.hasFocus && !focus.activeEdges.has(eid);
      elEdge.classList.toggle('dimmed', dim);
    });

    // Update transient hover library wires without tearing down existing nodes
    el.layerOverlays.querySelectorAll('[data-hover-wire]').forEach((n) => n.remove());
    if (state.zoomLevel === 2 && state.hover && (state.hover.type === 'library' || state.hover.type === 'module')) {
      const pairs = [];
      if (state.hover.type === 'library') {
        const lib = libById.get(state.hover.id);
        if (lib) for (const mId of lib.moduleIds) pairs.push([mId, lib.id]);
      } else if (state.hover.type === 'module') {
        const mod = modById.get(state.hover.id);
        if (mod) for (const libName of mod.libraries) pairs.push([mod.id, `lib::${libName}`]);
      }
      for (const [mId, libId] of pairs) {
        const mn = state.layout.nodes.get(mId);
        const ln = state.layout.nodes.get(libId);
        if (!mn || !ln) continue;
        const x1 = mn.x + mn.w / 2;
        const y1 = mn.y + mn.h;
        const x2 = ln.inPin.x;
        const y2 = ln.inPin.y;
        const midY = (y1 + y2) / 2;
        el.layerOverlays.appendChild(svgEl('path', {
          'data-hover-wire': '1',
          style: 'pointer-events:none',
          d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
          fill: 'none', stroke: 'var(--accent-lib)', 'stroke-width': 2, 'stroke-opacity': 0.85,
          class: 'wire-animated', 'marker-end': 'url(#arrow-lib)'
        }));
      }
    }
  }

  function renderCanvas() {
    const layout = computeLayout(state.zoomLevel);
    state.layout = layout;

    el.layerZones.innerHTML = '';
    el.layerEdges.innerHTML = '';
    el.layerNodes.innerHTML = '';
    el.layerOverlays.innerHTML = '';

    const focus = getActiveFocusSets();

    if (layout.level === 1) renderAtlasLevel(layout, focus);
    else if (layout.level === 2) renderCircuitLevel(layout, focus);
    else renderDataflowLevel(layout, focus);

    applyCamera();
    renderMiniMap();
    renderBreadcrumbs();
  }

  function renderAtlasLayerCard(node) {
    const g = svgEl('g', { class: 'svg-node' });
    const color = node.layer.color;
    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 16, fill: 'var(--surface-card)', stroke: color, 'stroke-width': 1.5, 'stroke-opacity': 0.55, filter: 'url(#card-shadow)' }));
    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: 7, rx: 4, fill: color }));
    g.appendChild(svgEl('text', { x: node.x + 18, y: node.y + 34, fill: color, 'font-size': 11, 'font-weight': 700, 'letter-spacing': '0.08em' }, `LAYER 0${node.layer.order + 1}`));
    g.appendChild(svgEl('text', { x: node.x + 18, y: node.y + 56, fill: 'var(--text-strong)', 'font-size': 16.5, 'font-weight': 750 }, node.layer.label));
    g.appendChild(svgEl('text', { x: node.x + 18, y: node.y + 74, fill: 'var(--text-muted)', 'font-size': 11 }, trunc(node.layer.subtitle, 36)));

    const stats = [{ lbl: 'MODULES', val: node.mods.length }, { lbl: 'FUNCTIONS', val: node.fnCount }, { lbl: 'LINES', val: node.lines }];
    stats.forEach((st, i) => {
      const tx = node.x + 18 + i * 78;
      const ty = node.y + 92;
      g.appendChild(svgEl('rect', { x: tx, y: ty, width: 70, height: 48, rx: 8, fill: 'var(--surface-elevated)', stroke: 'var(--border)' }));
      g.appendChild(svgEl('text', { x: tx + 35, y: ty + 23, 'text-anchor': 'middle', fill: 'var(--text-strong)', 'font-size': 16, 'font-weight': 750, 'font-family': 'var(--font-mono)' }, st.val));
      g.appendChild(svgEl('text', { x: tx + 35, y: ty + 39, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 8.5, 'letter-spacing': '0.06em' }, st.lbl));
    });

    const extraMods = node.mods.length > 3 ? ` +${node.mods.length - 3} more` : '';
    const preview = node.mods.slice(0, 3).map((m) => m.name).join(' · ') + extraMods;
    g.appendChild(svgEl('text', { x: node.x + 18, y: node.y + 166, fill: 'var(--text-muted)', 'font-size': 11, 'font-family': 'var(--font-mono)' }, trunc(preview, 34)));
    g.appendChild(svgEl('text', { x: node.x + 18, y: node.y + 198, fill: color, 'font-size': 11, 'font-weight': 600 }, 'Click to inspect circuit →'));

    if (node.diagCount > 0) {
      g.appendChild(svgEl('rect', { x: node.x + node.w - 74, y: node.y + 182, width: 58, height: 22, rx: 11, fill: 'rgba(251, 113, 133, 0.16)', stroke: 'var(--accent-critical)', 'stroke-width': 1 }));
      g.appendChild(svgEl('text', { x: node.x + node.w - 45, y: node.y + 196.5, 'text-anchor': 'middle', fill: 'var(--accent-critical)', 'font-size': 10.5, 'font-weight': 700 }, `⚠ ${node.diagCount}`));
    }

    g.appendChild(svgEl('circle', { cx: node.inPin.x, cy: node.inPin.y, r: 5, fill: 'var(--bg)', stroke: color, 'stroke-width': 2 }));
    g.appendChild(svgEl('circle', { cx: node.outPin.x, cy: node.outPin.y, r: 5, fill: color }));
    g.addEventListener('click', (e) => { e.stopPropagation(); setSemanticZoom(2, true); });
    el.layerNodes.appendChild(g);
  }

  function renderAtlasLibsCard(node) {
    const g = svgEl('g', { class: 'svg-node' });
    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 14, fill: 'var(--surface-card)', stroke: '#c084fc', 'stroke-width': 1.2, 'stroke-dasharray': '5 4', 'stroke-opacity': 0.6 }));
    g.appendChild(svgEl('text', { x: node.x + 20, y: node.y + 28, fill: '#c084fc', 'font-size': 11.5, 'font-weight': 700, 'letter-spacing': '0.07em' }, `EXTERNAL LIBRARY BUS · ${DATA.libraries.length} PACKAGES`));
    let px = node.x + 20;
    let shown = 0;
    const moreReserve = 86;
    for (let i = 0; i < DATA.libraries.length; i++) {
      const lib = DATA.libraries[i];
      const lw = Math.min(132, Math.max(74, lib.name.length * 7.8 + 26));
      const remainingAfter = DATA.libraries.length - (i + 1);
      const limitX = node.x + node.w - 20 - (remainingAfter > 0 ? moreReserve : 0);
      if (px + lw > limitX) break;
      g.appendChild(svgEl('rect', { x: px, y: node.y + 44, width: lw, height: 34, rx: 8, fill: 'var(--surface-elevated)', stroke: LIB_COLORS[lib.category] || '#c084fc', 'stroke-opacity': 0.55 }));
      g.appendChild(svgEl('text', { x: px + lw / 2, y: node.y + 65, 'text-anchor': 'middle', fill: 'var(--text-strong)', 'font-size': 11.5, 'font-family': 'var(--font-mono)', 'font-weight': 600 }, trunc(lib.name, 14)));
      px += lw + 10;
      shown++;
    }
    if (shown < DATA.libraries.length) {
      const rest = DATA.libraries.length - shown;
      const mw = 74;
      g.appendChild(svgEl('rect', { x: px, y: node.y + 44, width: mw, height: 34, rx: 8, fill: 'rgba(192, 132, 252, 0.14)', stroke: '#c084fc', 'stroke-dasharray': '3 2' }));
      g.appendChild(svgEl('text', { x: px + mw / 2, y: node.y + 65, 'text-anchor': 'middle', fill: '#c084fc', 'font-size': 11, 'font-family': 'var(--font-mono)', 'font-weight': 700 }, `+${rest} more`));
    }
    g.addEventListener('click', (e) => { e.stopPropagation(); setSemanticZoom(2, true); });
    el.layerNodes.appendChild(g);
  }

  function renderAtlasLevel(layout) {
    for (const edge of layout.edges) {
      const { d, labelX, labelY } = computeWirePath(edge.fromNode, edge.toNode, edge.isCycle);
      const g = svgEl('g', { class: 'svg-edge' });
      const stroke = edge.isCycle ? 'var(--accent-critical)' : 'var(--accent-signal)';
      g.appendChild(svgEl('path', {
        d, fill: 'none', stroke, 'stroke-width': Math.max(2.5, Math.min(11, 2 + edge.edgeCount * 1.6)),
        'stroke-opacity': edge.isCycle ? 0.85 : 0.42, 'stroke-linecap': 'round',
        class: edge.isCycle ? 'wire-cycle' : '', 'marker-end': edge.isCycle ? 'url(#arrow-cycle)' : 'url(#arrow-active)'
      }));
      g.appendChild(svgEl('rect', { x: labelX - 34, y: labelY - 11, width: 68, height: 22, rx: 11, fill: 'var(--wire-label-bg)', stroke: edge.isCycle ? 'var(--accent-critical)' : 'var(--wire-label-border)', 'stroke-width': 1 }));
      g.appendChild(svgEl('text', { x: labelX, y: labelY + 3.5, 'text-anchor': 'middle', fill: edge.isCycle ? 'var(--accent-critical)' : 'var(--text-strong)', 'font-size': 10.5, 'font-family': 'var(--font-mono)', 'font-weight': 650 }, `${edge.edgeCount} link${edge.edgeCount === 1 ? '' : 's'}${edge.isCycle ? ' ↻' : ''}`));
      el.layerEdges.appendChild(g);
    }

    for (const node of layout.nodes.values()) {
      if (node.kind === 'atlasLayer') renderAtlasLayerCard(node);
      else if (node.kind === 'atlasLibs') renderAtlasLibsCard(node);
    }
  }

  function renderCircuitEdge(edge, focus, sameColOffset) {
    const isFocused = !focus.hasFocus || focus.activeEdges.has(edge.id);
    const isHighlighted = focus.hasFocus && focus.activeEdges.has(edge.id);
    const { d, labelX, labelY } = computeWirePath(edge.fromNode, edge.toNode, edge.isCycle, sameColOffset);

    const g = svgEl('g', { class: `svg-edge${!isFocused ? ' dimmed' : ''}`, 'data-edge-id': edge.id });
    const stroke = edge.isCycle ? 'var(--accent-critical)' : isHighlighted ? 'var(--accent-signal)' : 'var(--wire-stroke)';

    g.appendChild(svgEl('path', {
      d, fill: 'none', stroke,
      'stroke-width': edge.isCycle ? 2.4 : isHighlighted ? 2.6 : Math.min(3, 1.3 + edge.callCount * 0.25),
      class: edge.isCycle ? 'wire-cycle' : isHighlighted ? 'wire-animated' : '',
      filter: isHighlighted ? 'url(#glow-cyan)' : null,
      'marker-end': edge.isCycle ? 'url(#arrow-cycle)' : isHighlighted ? 'url(#arrow-active)' : 'url(#arrow-default)'
    }));

    const hit = svgEl('path', { d, class: 'wire-hit' });
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('modEdge', edge.id); });
    hit.addEventListener('mouseenter', (ev) => {
      showTooltip(ev, `${modById.get(edge.from)?.name} → ${modById.get(edge.to)?.name}`,
        edge.symbols.length ? `Imports: ${edge.symbols.slice(0, 5).join(', ')}` : `${edge.callCount || 1} link(s)`);
    });
    hit.addEventListener('mouseleave', hideTooltip);
    g.appendChild(hit);

    if ((isHighlighted || edge.isCycle) && edge.symbols.length > 0) {
      const lbl = trunc(edge.symbols.slice(0, 2).join(', ') + (edge.symbols.length > 2 ? ` +${edge.symbols.length - 2}` : ''), 26);
      const pw = Math.max(54, lbl.length * 6.4 + 16);
      const pill = svgEl('g', { style: 'pointer-events:none' });
      pill.appendChild(svgEl('rect', { x: labelX - pw / 2, y: labelY - 10, width: pw, height: 20, rx: 10, fill: 'var(--wire-label-bg)', stroke: edge.isCycle ? 'var(--accent-critical)' : 'var(--accent-signal)', 'stroke-width': 1 }));
      pill.appendChild(svgEl('text', { x: labelX, y: labelY + 3.5, 'text-anchor': 'middle', fill: 'var(--text-strong)', 'font-size': 10, 'font-family': 'var(--font-mono)' }, lbl));
      el.layerOverlays.appendChild(pill);
    }
    el.layerEdges.appendChild(g);
  }

  function renderSelectedLibWires(layout) {
    const activeTarget = state.selection || state.hover;
    if (!activeTarget || (activeTarget.type !== 'library' && activeTarget.type !== 'module')) return;
    const pairs = [];
    if (activeTarget.type === 'library') {
      for (const mId of libById.get(activeTarget.id)?.moduleIds || []) pairs.push([mId, activeTarget.id]);
    } else {
      for (const libName of modById.get(activeTarget.id)?.libraries || []) pairs.push([activeTarget.id, `lib::${libName}`]);
    }
    for (const [mId, libId] of pairs) {
      const mn = layout.nodes.get(mId);
      const ln = layout.nodes.get(libId);
      if (!mn || !ln) continue;
      const x1 = mn.x + mn.w / 2;
      const y1 = mn.y + mn.h;
      const midY = (y1 + ln.inPin.y) / 2;
      el.layerEdges.appendChild(svgEl('path', {
        d: `M ${x1} ${y1} C ${x1} ${midY}, ${ln.inPin.x} ${midY}, ${ln.inPin.x} ${ln.inPin.y}`,
        fill: 'none', stroke: 'var(--accent-lib)', 'stroke-width': 2, 'stroke-opacity': 0.85,
        class: 'wire-animated', 'marker-end': 'url(#arrow-lib)'
      }));
    }
  }

  function renderModuleCard(node, isFocused, isSelected) {
    const mod = node.mod;
    const color = LAYER_COLORS[mod.layer] || '#38bdf8';
    const sev = mod.metrics.maxSeverity;
    const showRiskGlow = (state.riskLens || sev === 'critical') && sev;
    const g = svgEl('g', { class: `svg-node${!isFocused ? ' dimmed' : ''}`, 'data-node-id': mod.id });

    if (state.riskLens && sev) {
      g.appendChild(svgEl('rect', { x: node.x - 4, y: node.y - 4, width: node.w + 8, height: node.h + 8, rx: 14, fill: 'none', stroke: SEV_COLORS[sev], 'stroke-width': 2.5, class: 'risk-ring-pulse', filter: 'url(#glow-risk)' }));
    }
    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 11, fill: 'var(--surface-card)', stroke: isSelected ? 'var(--accent-signal)' : showRiskGlow ? SEV_COLORS[sev] : 'var(--border-strong)', 'stroke-width': isSelected ? 2.2 : 1.1, filter: 'url(#card-shadow)' }));
    g.appendChild(svgEl('rect', { x: node.x, y: node.y + 8, width: 4, height: node.h - 16, rx: 2, fill: color }));
    g.appendChild(svgEl('rect', { x: node.x + 14, y: node.y + 12, width: 28, height: 17, rx: 4, fill: color, 'fill-opacity': 0.16 }));
    g.appendChild(svgEl('text', { x: node.x + 28, y: node.y + 24, 'text-anchor': 'middle', fill: color, 'font-size': 9.5, 'font-weight': 750, 'font-family': 'var(--font-mono)' }, langShort(mod.language)));

    if (mod.isEntryPoint) {
      g.appendChild(svgEl('rect', { x: node.x + 48, y: node.y + 12, width: 46, height: 17, rx: 4, fill: 'rgba(56, 189, 248, 0.16)' }));
      g.appendChild(svgEl('text', { x: node.x + 71, y: node.y + 24, 'text-anchor': 'middle', fill: 'var(--accent-entry)', 'font-size': 9, 'font-weight': 700 }, 'ENTRY'));
    }
    if (mod.metrics.diagnosticCount > 0) {
      const sc = SEV_COLORS[sev];
      g.appendChild(svgEl('rect', { x: node.x + node.w - 44, y: node.y + 11, width: 34, height: 18, rx: 9, fill: sc, 'fill-opacity': 0.18, stroke: sc, 'stroke-width': 0.9 }));
      g.appendChild(svgEl('text', { x: node.x + node.w - 27, y: node.y + 23.5, 'text-anchor': 'middle', fill: sc, 'font-size': 10, 'font-weight': 750 }, `⚠${mod.metrics.diagnosticCount}`));
    }

    g.appendChild(svgEl('text', { x: node.x + 14, y: node.y + 47, fill: 'var(--text-strong)', 'font-size': 13.5, 'font-weight': 700, 'font-family': 'var(--font-mono)' }, trunc(mod.name, 25)));
    const modSub = state.plainEnglishMode && mod.explanation?.shortIntent
      ? mod.explanation.shortIntent
      : (mod.dir === '.' ? mod.summary : `${mod.dir} · ${mod.summary}`);
    g.appendChild(svgEl('text', { x: node.x + 14, y: node.y + 63, fill: state.plainEnglishMode ? 'var(--accent-domain)' : 'var(--text-muted)', 'font-size': 10.5 }, trunc(modSub, 34)));

    const avgC = mod.metrics.complexity / Math.max(1, mod.functionIds.length);
    g.appendChild(svgEl('rect', { x: node.x + 14, y: node.y + 78, width: 86, height: 5, rx: 2.5, fill: 'rgba(148,163,184,0.16)' }));
    g.appendChild(svgEl('rect', { x: node.x + 14, y: node.y + 78, width: Math.max(8, 86 * complexityRatio(avgC)), height: 5, rx: 2.5, fill: complexityColor(avgC) }));

    const glyphs = formatGlyphs(getModFlags(mod));
    if (glyphs) g.appendChild(svgEl('text', { x: node.x + node.w - 14, y: node.y + 84, 'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': 11 }, glyphs));

    g.appendChild(svgEl('circle', { cx: node.inPin.x, cy: node.inPin.y, r: 4.5, fill: 'var(--bg)', stroke: mod.metrics.fanIn > 0 ? color : 'var(--border-strong)', 'stroke-width': 2 }));
    g.appendChild(svgEl('circle', { cx: node.outPin.x, cy: node.outPin.y, r: 4.5, fill: mod.metrics.fanOut > 0 ? color : 'var(--bg)', stroke: color, 'stroke-width': 1.5 }));

    g.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('module', mod.id); });
    g.addEventListener('dblclick', (ev) => { ev.stopPropagation(); setSemanticZoom(3, false); focusNodeInView(mod.functionIds[0] || mod.id); });
    g.addEventListener('mouseenter', (ev) => {
      if (!state.selection && !state.activeTrace && !state.riskLens) { state.hover = { type: 'module', id: mod.id }; applyHoverSpotlight(); }
      const tt = mod.explanation?.summary || `${mod.lines} lines · ${mod.functionIds.length} functions`;
      showTooltip(ev, mod.id, tt);
    });
    g.addEventListener('mouseleave', () => {
      hideTooltip();
      if (state.hover) { state.hover = null; applyHoverSpotlight(); }
    });
    el.layerNodes.appendChild(g);
  }

  function renderLibraryCard(node, isFocused, isSelected) {
    const lib = node.lib;
    const lc = LIB_COLORS[lib.category] || '#c084fc';
    const g = svgEl('g', { class: `svg-node${!isFocused ? ' dimmed' : ''}`, 'data-node-id': lib.id });
    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 10, fill: 'var(--surface-card)', stroke: isSelected ? 'var(--accent-lib)' : lc, 'stroke-width': isSelected ? 2.2 : 1.1, 'stroke-dasharray': isSelected ? null : '4 2', 'stroke-opacity': isSelected ? 1 : 0.65 }));
    g.appendChild(svgEl('circle', { cx: node.x + 14, cy: node.y + 20, r: 4, fill: lc }));
    g.appendChild(svgEl('text', { x: node.x + 25, y: node.y + 24, fill: 'var(--text-strong)', 'font-size': 12, 'font-weight': 650, 'font-family': 'var(--font-mono)' }, trunc(lib.name, 16)));
    g.appendChild(svgEl('text', { x: node.x + 14, y: node.y + 41, fill: 'var(--text-muted)', 'font-size': 10 }, `${lib.category} · ${lib.moduleIds.length} mod${lib.moduleIds.length === 1 ? '' : 's'}`));
    g.appendChild(svgEl('circle', { cx: node.inPin.x, cy: node.inPin.y, r: 4, fill: lc }));

    g.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('library', lib.id); });
    g.addEventListener('mouseenter', (ev) => {
      if (!state.selection && !state.activeTrace && !state.riskLens) { state.hover = { type: 'library', id: lib.id }; applyHoverSpotlight(); }
      showTooltip(ev, lib.name, `${lib.category} package · Used by ${lib.moduleIds.length} module(s)`);
    });
    g.addEventListener('mouseleave', () => {
      hideTooltip();
      if (state.hover) { state.hover = null; applyHoverSpotlight(); }
    });
    el.layerNodes.appendChild(g);
  }

  function renderCircuitLevel(layout, focus) {
    for (const z of layout.zones) {
      const g = svgEl('g');
      g.appendChild(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 16, fill: z.layer.color, 'fill-opacity': 0.045, stroke: z.layer.color, 'stroke-opacity': 0.25, 'stroke-width': 1.2, 'stroke-dasharray': z.id === 'zone::libraries' ? '6 4' : null }));
      g.appendChild(svgEl('text', { x: z.x + 16, y: z.y + 24, fill: z.layer.color, 'font-size': 11, 'font-weight': 750, 'letter-spacing': '0.08em' }, z.layer.label.toUpperCase()));
      g.appendChild(svgEl('text', { x: z.x + 16, y: z.y + 39, fill: 'var(--text-muted)', 'font-size': 10.5 }, z.layer.subtitle));
      el.layerZones.appendChild(g);
    }

    let sameColCounter = 0;
    for (const edge of layout.edges) {
      const sameCol = edge.fromNode.colIndex === edge.toNode.colIndex;
      renderCircuitEdge(edge, focus, sameCol ? sameColCounter++ : 0);
    }

    renderSelectedLibWires(layout);

    for (const node of layout.nodes.values()) {
      const isFocused = !focus.hasFocus || focus.activeNodes.has(node.id);
      const isSelected = state.selection?.id === node.id;
      if (node.kind === 'module') renderModuleCard(node, isFocused, isSelected);
      else if (node.kind === 'library') renderLibraryCard(node, isFocused, isSelected);
    }
  }

  function renderDataflowWire(edge, focus, showAllPills, currentHopEdgeId, sameColOffset) {
    const isFocused = !focus.hasFocus || focus.activeEdges.has(edge.id);
    const isHighlighted = focus.hasFocus && focus.activeEdges.has(edge.id);
    const isCurrentHop = Boolean(currentHopEdgeId && edge.id === currentHopEdgeId);
    const { d, labelX, labelY } = computeWirePath(edge.fromNode, edge.toNode, edge.isCycle, sameColOffset);

    const g = svgEl('g', { class: `svg-edge${!isFocused ? ' dimmed' : ''}`, 'data-edge-id': edge.id });
    const stroke = edge.isCycle ? 'var(--accent-critical)' : isCurrentHop ? '#22d3ee' : isHighlighted ? 'var(--accent-signal)' : 'var(--wire-stroke)';

    g.appendChild(svgEl('path', {
      d, fill: 'none', stroke,
      'stroke-width': isCurrentHop ? 3.5 : isHighlighted || edge.isCycle ? 2.4 : 1.4,
      class: isHighlighted ? 'wire-animated' : edge.isCycle ? 'wire-cycle' : '',
      filter: isCurrentHop || isHighlighted ? 'url(#glow-cyan)' : null,
      'marker-end': edge.isCycle ? 'url(#arrow-cycle)' : isHighlighted ? 'url(#arrow-active)' : 'url(#arrow-default)'
    }));

    const hit = svgEl('path', { d, class: 'wire-hit' });
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('callEdge', edge.id); });
    hit.addEventListener('mouseenter', (ev) => {
      const payload = edge.args.length ? `(${edge.args.join(', ')})` : '()';
      showTooltip(ev, `${fnById.get(edge.from)?.name} → ${fnById.get(edge.to)?.name}`, `Passes: ${payload}${edge.assignedTo ? ` → ${edge.assignedTo}` : ''}`);
    });
    hit.addEventListener('mouseleave', hideTooltip);
    g.appendChild(hit);

    if (isCurrentHop || isHighlighted || (showAllPills && !focus.hasFocus)) {
      const rawPayload = edge.args.length ? edge.args.slice(0, 2).join(', ') + (edge.args.length > 2 ? ', …' : '') : 'call';
      const pillText = (edge.isAsync ? '⚡ ' : '') + trunc(rawPayload, 24);
      const pw = Math.max(46, pillText.length * 6.3 + 14);
      const pg = svgEl('g', { style: 'cursor:pointer' });
      pg.appendChild(svgEl('rect', { x: labelX - pw / 2, y: labelY - 10, width: pw, height: 20, rx: 10, fill: isCurrentHop ? 'var(--accent-signal)' : 'var(--wire-label-bg)', stroke: isCurrentHop ? '#fff' : edge.isCycle ? 'var(--accent-critical)' : 'var(--wire-label-border)', 'stroke-width': isCurrentHop ? 1.5 : 1 }));
      pg.appendChild(svgEl('text', { x: labelX, y: labelY + 3.5, 'text-anchor': 'middle', fill: isCurrentHop ? '#04131c' : 'var(--text-strong)', 'font-size': 9.8, 'font-family': 'var(--font-mono)', 'font-weight': isCurrentHop ? 750 : 600 }, pillText));
      pg.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('callEdge', edge.id); });
      el.layerOverlays.appendChild(pg);
    }
    el.layerEdges.appendChild(g);
  }

  function renderFunctionChip(node, focus, activeHopFnId) {
    const fn = node.fn;
    const color = LAYER_COLORS[node.layer.id] || '#38bdf8';
    const isFocused = !focus.hasFocus || focus.activeNodes.has(fn.id);
    const isSelected = state.selection?.id === fn.id;
    const isCurrentHop = activeHopFnId === fn.id;
    const sev = fn.metrics.maxSeverity;

    const g = svgEl('g', { class: `svg-node${!isFocused ? ' dimmed' : ''}`, 'data-node-id': fn.id });
    if (isCurrentHop) {
      g.appendChild(svgEl('rect', { x: node.x - 5, y: node.y - 5, width: node.w + 10, height: node.h + 10, rx: 14, fill: 'none', stroke: 'var(--accent-signal)', 'stroke-width': 2.6, filter: 'url(#glow-cyan)' }));
    } else if (state.riskLens && sev) {
      g.appendChild(svgEl('rect', { x: node.x - 4, y: node.y - 4, width: node.w + 8, height: node.h + 8, rx: 13, fill: 'none', stroke: SEV_COLORS[sev], 'stroke-width': 2.3, class: 'risk-ring-pulse', filter: 'url(#glow-risk)' }));
    }

    g.appendChild(svgEl('rect', { x: node.x, y: node.y, width: node.w, height: node.h, rx: 10, fill: 'var(--surface-card)', stroke: isCurrentHop || isSelected ? 'var(--accent-signal)' : sev && state.riskLens ? SEV_COLORS[sev] : 'var(--border-strong)', 'stroke-width': isCurrentHop || isSelected ? 2 : 1, filter: 'url(#card-shadow)' }));

    const kindTag = fn.kind === 'route' ? 'ROUTE' : fn.isAsync ? 'ASYNC' : fn.kind === 'method' ? 'MTHD' : fn.kind === 'component' ? 'UI' : 'FN';
    g.appendChild(svgEl('rect', { x: node.x + 10, y: node.y + 9, width: 40, height: 16, rx: 4, fill: color, 'fill-opacity': 0.16 }));
    g.appendChild(svgEl('text', { x: node.x + 30, y: node.y + 20.5, 'text-anchor': 'middle', fill: color, 'font-size': 8.5, 'font-weight': 750, 'font-family': 'var(--font-mono)' }, kindTag));
    g.appendChild(svgEl('text', { x: node.x + 56, y: node.y + 21.5, fill: 'var(--text-strong)', 'font-size': 12.5, 'font-weight': 700, 'font-family': 'var(--font-mono)' }, trunc(fn.qualName, 24)));
    if (fn.metrics.diagnosticCount > 0) g.appendChild(svgEl('circle', { cx: node.x + node.w - 14, cy: node.y + 17, r: 5, fill: SEV_COLORS[sev] }));

    const inLabel = fn.params.length ? fn.params.map((p) => p.name).join(', ') : '∅';
    const outLabel = fn.returnType || fn.returnExprs[0] || 'void';
    if (state.plainEnglishMode && fn.explanation?.shortIntent) {
      g.appendChild(svgEl('text', { x: node.x + 11, y: node.y + 42, fill: 'var(--accent-domain)', 'font-size': 10.4, 'font-weight': 550 }, trunc(fn.explanation.shortIntent, 38)));
    } else {
      g.appendChild(svgEl('text', { x: node.x + 11, y: node.y + 42, fill: 'var(--accent-entry)', 'font-size': 10, 'font-family': 'var(--font-mono)' }, `in: ${trunc(inLabel, 18)}`));
      g.appendChild(svgEl('text', { x: node.x + node.w - 11, y: node.y + 42, 'text-anchor': 'end', fill: 'var(--accent-domain)', 'font-size': 10, 'font-family': 'var(--font-mono)' }, `→ ${trunc(outLabel, 16)}`));
    }

    const bx = node.x + 11;
    const by = node.y + 57;
    g.appendChild(svgEl('rect', { x: bx, y: by, width: 78, height: 4.5, rx: 2, fill: 'rgba(148,163,184,0.16)' }));
    g.appendChild(svgEl('rect', { x: bx, y: by, width: Math.max(8, 78 * complexityRatio(fn.complexity)), height: 4.5, rx: 2, fill: complexityColor(fn.complexity) }));
    g.appendChild(svgEl('text', { x: bx + 86, y: by + 5, fill: 'var(--text-dim)', 'font-size': 9.5, 'font-family': 'var(--font-mono)' }, `${fn.steps.length} steps`));

    const glyphs = formatGlyphs(fn.flags);
    if (glyphs) g.appendChild(svgEl('text', { x: node.x + node.w - 11, y: by + 5, 'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': 10.5 }, glyphs));

    g.appendChild(svgEl('circle', { cx: node.inPin.x, cy: node.inPin.y, r: 4.5, fill: 'var(--bg)', stroke: 'var(--accent-entry)', 'stroke-width': 2 }));
    g.appendChild(svgEl('circle', { cx: node.outPin.x, cy: node.outPin.y, r: 4.5, fill: 'var(--accent-domain)', stroke: 'var(--bg)', 'stroke-width': 1.2 }));

    g.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('function', fn.id); });
    g.addEventListener('mouseenter', (ev) => {
      const tip = fn.explanation?.plainEnglish || `${fn.lines} lines · Complexity ${fn.complexity}`;
      showTooltip(ev, `${fn.qualName}(${inLabel})`, tip);
    });
    g.addEventListener('mouseleave', hideTooltip);
    el.layerNodes.appendChild(g);
  }

  function renderDataflowLevel(layout, focus) {
    for (const z of layout.zones) {
      if (z.kind === 'layerZone') {
        const g = svgEl('g');
        g.appendChild(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 16, fill: z.layer.color, 'fill-opacity': 0.035, stroke: z.layer.color, 'stroke-opacity': 0.22, 'stroke-width': 1.1 }));
        g.appendChild(svgEl('text', { x: z.x + 16, y: z.y + 24, fill: z.layer.color, 'font-size': 11, 'font-weight': 750, 'letter-spacing': '0.08em' }, z.layer.label.toUpperCase()));
        el.layerZones.appendChild(g);
      } else if (z.kind === 'moduleBox') {
        const mod = z.mod;
        const dimBox = focus.hasFocus && !focus.activeNodes.has(mod.id) && !mod.functionIds.some((id) => focus.activeNodes.has(id));
        const g = svgEl('g', { class: `svg-node${dimBox ? ' dimmed' : ''}` });
        g.appendChild(svgEl('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 12, fill: 'var(--surface-solid)', 'fill-opacity': 0.72, stroke: 'var(--border-strong)', 'stroke-width': 1 }));
        g.appendChild(svgEl('text', { x: z.x + 14, y: z.y + 25, fill: z.layer.color, 'font-size': 12, 'font-weight': 700, 'font-family': 'var(--font-mono)' }, mod.name));
        g.appendChild(svgEl('text', { x: z.x + z.w - 14, y: z.y + 25, 'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': 10 }, `${mod.functionIds.length} fn${mod.functionIds.length === 1 ? '' : 's'}`));
        g.addEventListener('click', (ev) => { ev.stopPropagation(); selectEntity('module', mod.id); });
        el.layerZones.appendChild(g);
      }
    }

    const showAllPills = layout.edges.length <= 28;
    const currentHopEdgeId = state.activeTrace ? state.activeTrace.hops[state.traceHop]?.edgeId : null;
    let sameColOffset = 0;
    for (const edge of layout.edges) {
      renderDataflowWire(edge, focus, showAllPills, currentHopEdgeId, edge.fromNode.colIndex === edge.toNode.colIndex ? sameColOffset++ : 0);
    }

    const activeHopFnId = state.activeTrace ? state.activeTrace.hops[state.traceHop]?.toFunctionId : null;
    for (const node of layout.nodes.values()) renderFunctionChip(node, focus, activeHopFnId);
  }

  // =========================================================================
  // 5. CAMERA, PAN/ZOOM, SMOOTH ANIMATION & SPATIAL MINI-MAP
  // =========================================================================

  function applyCamera() {
    const { x, y, k } = state.camera;
    el.viewport.setAttribute('transform', `translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${k.toFixed(4)})`);
    el.zoomPct.textContent = `${Math.round(k * 100)}%`;
    renderMiniMap();
  }

  function fitToViewport(animate = false) {
    if (!state.layout) return;
    const rect = el.stage.getBoundingClientRect();
    const b = state.layout.bounds;
    const worldW = Math.max(100, b.maxX - b.minX);
    const worldH = Math.max(100, b.maxY - b.minY);
    const pad = 56;
    const k = Math.max(0.22, Math.min(1.18, Math.min((rect.width - pad * 2) / worldW, (rect.height - pad * 2) / worldH)));
    const x = (rect.width - worldW * k) / 2 - b.minX * k;
    const y = (rect.height - worldH * k) / 2 - b.minY * k + 14;
    if (animate) animateCamera({ x, y, k });
    else {
      state.camera = { x, y, k };
      applyCamera();
    }
  }

  function focusNodeInView(nodeId, desiredScale = 1.0) {
    if (!state.layout) return;
    const n = state.layout.nodes.get(nodeId);
    if (!n) return;
    const rect = el.stage.getBoundingClientRect();
    const k = Math.max(0.55, Math.min(1.25, desiredScale));
    const cx = n.x + n.w / 2;
    const cy = n.y + n.h / 2;
    animateCamera({ x: rect.width / 2 - cx * k, y: rect.height / 2 - cy * k, k });
  }

  function animateCamera(target) {
    if (state.animFrame) cancelAnimationFrame(state.animFrame);
    const start = { ...state.camera };
    const t0 = performance.now();
    const dur = 320;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      state.camera = {
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
        k: start.k + (target.k - start.k) * ease
      };
      applyCamera();
      if (p < 1) state.animFrame = requestAnimationFrame(step);
    };
    state.animFrame = requestAnimationFrame(step);
  }

  function renderMiniMap() {
    if (!state.layout) return;
    const b = state.layout.bounds;
    const worldW = Math.max(100, b.maxX - b.minX);
    const worldH = Math.max(100, b.maxY - b.minY);
    const mw = 180;
    const mh = 110;
    const scale = Math.min((mw - 12) / worldW, (mh - 12) / worldH);
    const ox = (mw - worldW * scale) / 2 - b.minX * scale;
    const oy = (mh - worldH * scale) / 2 - b.minY * scale;

    el.minimap.innerHTML = '';
    for (const n of state.layout.nodes.values()) {
      const fill = n.layer?.color || (n.kind === 'library' ? '#c084fc' : LAYER_COLORS[n.mod?.layer] || '#38bdf8');
      el.minimap.appendChild(svgEl('rect', {
        x: ox + n.x * scale,
        y: oy + n.y * scale,
        width: Math.max(3, n.w * scale),
        height: Math.max(2.5, n.h * scale),
        rx: 1.5,
        fill,
        'fill-opacity': 0.72
      }));
    }

    // Current viewport frame
    const rect = el.stage.getBoundingClientRect();
    const vx = -state.camera.x / state.camera.k;
    const vy = -state.camera.y / state.camera.k;
    const vw = rect.width / state.camera.k;
    const vh = rect.height / state.camera.k;
    el.minimap.appendChild(svgEl('rect', {
      x: ox + vx * scale,
      y: oy + vy * scale,
      width: Math.max(10, vw * scale),
      height: Math.max(8, vh * scale),
      rx: 2,
      fill: 'rgba(34, 211, 238, 0.12)',
      stroke: '#22d3ee',
      'stroke-width': 1.2
    }));

    el.minimap._meta = { ox, oy, scale };
  }

  // =========================================================================
  // 6. VISUAL-FIRST INSPECTOR DRAWER ("GLASSBOX X-RAY")
  // =========================================================================

  function selectEntity(type, id) {
    state.selection = { type, id };
    el.inspector.classList.remove('collapsed');
    renderInspector();
    renderCanvas();
  }

  function closeInspector() {
    state.selection = null;
    el.inspector.classList.add('collapsed');
    renderCanvas();
  }

  function setActiveInspectorTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.insp-tab').forEach((t) => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabName);
    });
    el.inspExplain.classList.toggle('hidden', tabName !== 'explain');
    el.inspVisual.classList.toggle('hidden', tabName !== 'visual');
    el.inspSource.classList.toggle('hidden', tabName !== 'source');
  }

  function renderInspector() {
    if (!state.selection) return;
    const { type, id } = state.selection;
    el.inspBadges.textContent = '';
    el.inspActions.textContent = '';
    el.inspExplain.textContent = '';
    el.inspVisual.textContent = '';
    el.inspSource.textContent = '';
    el.inspExplain.scrollTop = 0;
    el.inspVisual.scrollTop = 0;
    el.inspSource.scrollTop = 0;

    if (type === 'function') {
      const fn = fnById.get(id);
      renderFunctionExplain(fn);
      renderFunctionInspector(fn);
    } else if (type === 'module') {
      const mod = modById.get(id);
      renderModuleExplain(mod);
      renderModuleInspector(mod);
    } else if (type === 'library') {
      const lib = libById.get(id);
      renderLibraryExplain(lib);
      renderLibraryInspector(lib);
    } else if (type === 'callEdge') {
      const edge = callEdgeById.get(id);
      renderEdgeExplain(edge, 'call');
      renderCallEdgeInspector(edge);
    } else if (type === 'modEdge') {
      const edge = modEdgeById.get(id);
      renderEdgeExplain(edge, 'module');
      renderModEdgeInspector(edge);
    }
  }

  function makeExplainHero(label, text, tags = []) {
    const box = document.createElement('div');
    box.className = 'explain-hero';
    const lbl = document.createElement('div');
    lbl.className = 'explain-hero-label';
    lbl.textContent = label;
    const p = document.createElement('div');
    p.className = 'explain-hero-text';
    p.textContent = text;
    box.append(lbl, p);
    if (tags.length) {
      const row = document.createElement('div');
      row.className = 'intent-tags';
      for (const t of tags) {
        const pill = document.createElement('span');
        pill.className = 'intent-tag';
        pill.textContent = t;
        row.appendChild(pill);
      }
      box.appendChild(row);
    }
    return box;
  }

  function makeSection(title) {
    const sec = document.createElement('div');
    sec.className = 'insp-section';
    const h = document.createElement('div');
    h.className = 'insp-section-title';
    h.textContent = title;
    sec.appendChild(h);
    return sec;
  }

  function renderFunctionExplain(fn) {
    if (!fn) return;
    const exp = fn.explanation;
    if (!exp) return;

    el.inspExplain.appendChild(makeExplainHero('In Plain English', exp.plainEnglish, exp.tags));

    // Step-by-step interactive storyboard
    const stepSec = makeSection(`How It Works (${exp.narratedSteps.length} steps)`);
    const board = document.createElement('div');
    board.className = 'storyboard';
    const kindColors = { guard: '#fbbf24', branch: '#f59e0b', transform: '#818cf8', call: '#38bdf8', io: '#22d3ee', loop: '#a78bfa', error: '#fb7185', output: '#34d399' };

    if (exp.narratedSteps.length) {
      exp.narratedSteps.forEach((st, idx) => {
        const card = document.createElement('div');
        card.className = `story-step${st.targetFunctionId ? ' clickable' : ''}`;
        card.style.borderLeftColor = kindColors[st.kind] || '#38bdf8';
        const num = document.createElement('span');
        num.className = 'step-num';
        num.textContent = String(idx + 1);
        const content = document.createElement('div');
        content.className = 'step-content';
        const cap = document.createElement('div');
        cap.className = 'step-caption';
        cap.textContent = st.caption;
        const meta = document.createElement('div');
        meta.className = 'step-meta';
        meta.textContent = `${st.kind.toUpperCase()} · L${st.line}${st.targetFunctionId ? ' · Click to jump →' : ''}`;
        content.append(cap, meta);
        card.append(num, content);
        if (st.targetFunctionId) {
          card.addEventListener('click', () => {
            if (state.zoomLevel !== 3) setSemanticZoom(3, false);
            selectEntity('function', st.targetFunctionId);
            focusNodeInView(st.targetFunctionId, 0.95);
          });
        }
        board.appendChild(card);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'Direct single-expression computation.';
      board.appendChild(empty);
    }
    stepSec.appendChild(board);
    el.inspExplain.appendChild(stepSec);

    // Data Journey Ledger
    const dj = exp.dataJourney;
    if (dj) {
      const ledgerSec = makeSection('Data Transformation & Assumptions');
      const grid = document.createElement('div');
      grid.className = 'ledger-grid';

      if (dj.inputs.length) {
        const inBox = document.createElement('div');
        inBox.className = 'ledger-box';
        for (const inp of dj.inputs) {
          const row = document.createElement('div');
          row.className = 'ledger-row';
          const left = document.createElement('span');
          left.className = 'ledger-var';
          left.textContent = inp.name;
          const right = document.createElement('span');
          right.className = 'muted';
          right.textContent = inp.role;
          row.append(left, right);
          inBox.appendChild(row);
        }
        grid.appendChild(inBox);
      }

      const summaryBox = document.createElement('div');
      summaryBox.className = 'ledger-box';
      const lines = [
        ['OUTPUT', dj.outputs],
        ['SIDE EFFECTS', dj.sideEffects.join('; ')],
        ['EDGE CASES', dj.edgeCases.join(' · ')]
      ];
      for (const [k, v] of lines) {
        const row = document.createElement('div');
        row.className = 'ledger-row';
        const lbl = document.createElement('span');
        lbl.className = 'muted';
        lbl.style.fontWeight = '700';
        lbl.textContent = k;
        const val = document.createElement('span');
        val.style.textAlign = 'right';
        val.textContent = v;
        row.append(lbl, val);
        summaryBox.appendChild(row);
      }
      grid.appendChild(summaryBox);
      ledgerSec.appendChild(grid);
      el.inspExplain.appendChild(ledgerSec);
    }
  }

  function renderModuleExplain(mod) {
    if (!mod || !mod.explanation) return;
    el.inspExplain.appendChild(makeExplainHero('Module Role', mod.explanation.summary, mod.explanation.tags));

    const fns = mod.functionIds.map((id) => fnById.get(id)).filter(Boolean);
    const fnSec = makeSection(`What Each Function Does (${fns.length})`);
    const list = document.createElement('div');
    list.className = 'chip-list';
    for (const f of fns) {
      const btn = document.createElement('button');
      btn.className = 'nav-chip';
      const wrap = document.createElement('div');
      const main = document.createElement('div');
      main.className = 'nav-chip-main';
      main.textContent = `${f.isAsync ? '⚡ ' : ''}${f.qualName}()`;
      const sub = document.createElement('div');
      sub.className = 'nav-chip-sub';
      sub.textContent = f.explanation?.shortIntent || `L${f.startLine}`;
      wrap.append(main, sub);
      btn.appendChild(wrap);
      btn.addEventListener('click', () => selectEntity('function', f.id));
      list.appendChild(btn);
    }
    if (!fns.length) {
      const m = document.createElement('div');
      m.className = 'muted';
      m.textContent = 'Top-level script or configuration module.';
      list.appendChild(m);
    }
    fnSec.appendChild(list);
    el.inspExplain.appendChild(fnSec);
  }

  function renderLibraryExplain(lib) {
    if (!lib) return;
    el.inspExplain.appendChild(makeExplainHero(
      'External Dependency Role',
      `"${lib.name}" is a ${lib.category} package wired into ${lib.moduleIds.length} module(s). Clicking any connected module reveals how data enters or leaves this boundary.`,
      [lib.category]
    ));
  }

  function renderEdgeExplain(edge, kind) {
    if (!edge) return;
    const text = kind === 'call'
      ? (edge.explanation || 'Direct function invocation passing arguments across chips.')
      : `"${modById.get(edge.from)?.name}" depends on "${modById.get(edge.to)?.name}" importing ${edge.symbols.join(', ') || 'module exports'}.`;
    el.inspExplain.appendChild(makeExplainHero(kind === 'call' ? 'What Crosses This Wire' : 'Why These Modules Connect', text));
  }

  function renderSystemStory() {
    const story = DATA.systemStory;
    if (!story) return;
    el.storyArchetype.textContent = story.archetype;
    el.storyHeadline.textContent = story.headline;

    el.storyConcepts.textContent = '';
    for (const c of story.keyConcepts || []) {
      const pill = document.createElement('span');
      pill.className = 'concept-pill';
      pill.textContent = c;
      el.storyConcepts.appendChild(pill);
    }

    el.storySections.textContent = '';
    for (const sec of story.sections || []) {
      const card = document.createElement('div');
      card.className = 'story-card';
      const head = document.createElement('div');
      head.className = 'story-card-head';
      const ic = document.createElement('span');
      ic.className = 'story-card-icon';
      ic.style.background = `${sec.color}22`;
      ic.style.color = sec.color;
      ic.textContent = sec.icon;
      const title = document.createElement('span');
      title.textContent = sec.title;
      head.append(ic, title);

      const txt = document.createElement('div');
      txt.className = 'story-card-text';
      txt.textContent = sec.text;
      card.append(head, txt);

      if (sec.links?.length) {
        const links = document.createElement('div');
        links.className = 'story-links';
        for (const lk of sec.links) {
          const btn = document.createElement('button');
          btn.className = 'story-link-btn';
          btn.textContent = lk.label;
          btn.addEventListener('click', () => {
            toggleSystemStory(false);
            const targetLevel = lk.type === 'function' ? 3 : 2;
            if (state.zoomLevel !== targetLevel) setSemanticZoom(targetLevel, false);
            selectEntity(lk.type, lk.id);
            focusNodeInView(lk.id, 0.95);
          });
          links.appendChild(btn);
        }
        card.appendChild(links);
      }
      el.storySections.appendChild(card);
    }
  }

  function toggleSystemStory(force) {
    state.storyOpen = force !== undefined ? force : !state.storyOpen;
    el.storyPanel.classList.toggle('hidden', !state.storyOpen);
    el.btnStory.classList.toggle('active-explain', state.storyOpen);
    if (state.storyOpen) renderSystemStory();
  }

  function renderFunctionInspector(fn) {
    if (!fn) return;
    const mod = modById.get(fn.moduleId);
    const layerColor = LAYER_COLORS[mod?.layer] || '#38bdf8';

    el.inspBadges.innerHTML = `
      <span class="badge" style="color:${layerColor};border-color:${layerColor}44">${escHtml(fn.kind)}</span>
      ${fn.isAsync ? '<span class="badge" style="color:#22d3ee">⚡ async</span>' : ''}
      ${fn.flags.hasIO ? '<span class="badge" style="color:#34d399">⇄ I/O</span>' : ''}
      <span class="badge">Complexity ${fn.complexity}</span>
    `;
    el.inspTitle.textContent = fn.qualName;
    el.inspSubtitle.textContent = `${fn.moduleId} · lines ${fn.startLine}–${fn.endLine} (${fn.lines} lines)`;

    // Quick Action Buttons
    el.inspActions.innerHTML = `
      <button class="trace-btn trace-btn-primary" id="act-trace-fn">▶ Trace Signal From Here</button>
      <button class="trace-btn" id="act-open-mod">Open Parent Module</button>
    `;
    document.getElementById('act-trace-fn').onclick = () => startDynamicTrace(fn.id);
    document.getElementById('act-open-mod').onclick = () => selectEntity('module', fn.moduleId);

    // 1. Visual Internal Processing Schematic (SVG!)
    const pipelineHtml = buildFunctionPipelineSvg(fn, false);
    const callers = DATA.callEdges.filter((e) => e.to === fn.id);
    const callees = DATA.callEdges.filter((e) => e.from === fn.id);
    const diags = diagsByFn.get(fn.id) || [];

    el.inspVisual.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">Internal Data Processing Schematic (${fn.steps.length} step${fn.steps.length === 1 ? '' : 's'})</div>
        <div class="pipeline-box" id="fn-pipeline-box">${pipelineHtml}</div>
        ${fn.steps.length > 12 ? `<button class="expand-more-btn" id="btn-toggle-steps" data-expanded="0">Show all ${fn.steps.length} steps (+${fn.steps.length - 12} more)</button>` : ''}
      </div>

      ${diags.length ? `
      <div class="insp-section">
        <div class="insp-section-title">Bug Radar Findings (${diags.length})</div>
        <div class="chip-list">
          ${diags.map((d) => `
            <div class="risk-card sev-${d.severity}" data-jump-line="${d.line || fn.startLine}" title="Click to inspect line in Source X-Ray">
              <div class="risk-card-body">
                <div class="risk-card-title">${escHtml(d.title)}</div>
                <div class="risk-card-msg">${escHtml(d.message)}</div>
                ${d.suggestion ? `<div class="risk-card-fix">Fix: ${escHtml(d.suggestion)}</div>` : ''}
              </div>
              <span class="risk-loc">L${d.line || fn.startLine} ↗</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="insp-section">
        <div class="insp-section-title">Upstream Callers (${callers.length}) — Data Entering</div>
        <div class="chip-list" id="insp-callers">
          ${callers.length ? callers.map((e) => {
            const c = fnById.get(e.from);
            return `<button class="nav-chip" data-jump-fn="${escHtml(e.from)}">
              <div><div class="nav-chip-main">${escHtml(c?.qualName || e.from)}</div><div class="nav-chip-sub">${escHtml(e.fromModule)} : L${e.line}</div></div>
              <span class="payload-tag">(${escHtml(e.args.join(', ') || '∅')})</span>
            </button>`;
          }).join('') : '<div class="muted">No internal callers detected (entry point or external API)</div>'}
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Downstream Callees (${callees.length}) — Data Sent Out</div>
        <div class="chip-list" id="insp-callees">
          ${callees.length ? callees.map((e) => {
            const c = fnById.get(e.to);
            return `<button class="nav-chip" data-jump-fn="${escHtml(e.to)}">
              <div><div class="nav-chip-main">${e.isAsync ? '⚡ ' : ''}${escHtml(c?.qualName || e.to)}</div><div class="nav-chip-sub">${escHtml(e.toModule)} · ${e.assignedTo ? `→ ${escHtml(e.assignedTo)}` : `L${e.line}`}</div></div>
              <span class="payload-tag">(${escHtml(e.args.join(', ') || '∅')})</span>
            </button>`;
          }).join('') : '<div class="muted">Leaf function (no internal downstream calls)</div>'}
        </div>
      </div>
    `;

    const toggleStepsBtn = document.getElementById('btn-toggle-steps');
    if (toggleStepsBtn) {
      toggleStepsBtn.addEventListener('click', () => {
        const nextExpanded = toggleStepsBtn.getAttribute('data-expanded') !== '1';
        toggleStepsBtn.setAttribute('data-expanded', nextExpanded ? '1' : '0');
        document.getElementById('fn-pipeline-box').innerHTML = buildFunctionPipelineSvg(fn, nextExpanded);
        toggleStepsBtn.textContent = nextExpanded
          ? 'Show first 12 steps'
          : `Show all ${fn.steps.length} steps (+${fn.steps.length - 12} more)`;
      });
    }

    el.inspVisual.querySelectorAll('[data-jump-line]').forEach((card) => {
      card.addEventListener('click', () => {
        const ln = Number(card.getAttribute('data-jump-line'));
        jumpToSourceLine(mod.source, fn.startLine, fn.endLine, diags.map((d) => d.line), ln, mod.lines);
      });
    });

    el.inspVisual.querySelectorAll('[data-jump-fn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fid = btn.getAttribute('data-jump-fn');
        if (state.zoomLevel !== 3) setSemanticZoom(3, false);
        selectEntity('function', fid);
        focusNodeInView(fid);
      });
    });

    // 2. Source X-Ray Tab
    mountSourceViewer(mod.source, fn.startLine, fn.endLine, diags.map((d) => d.line), mod.lines);
  }

  /**
   * Generates a crisp inline SVG schematic of how data enters, transforms, branches, and exits a function!
   */
  function buildFunctionPipelineSvg(fn, showAll = false) {
    const W = 368;
    const STEP_H = 44;
    const GAP = 14;
    const stepColors = {
      guard: '#fbbf24',
      branch: '#f59e0b',
      transform: '#818cf8',
      call: '#38bdf8',
      io: '#22d3ee',
      loop: '#a78bfa',
      error: '#fb7185',
      output: '#34d399'
    };
    const stepIcons = {
      guard: '🛡', branch: '⑂', transform: '⚙', call: '→', io: '⇄', loop: '↻', error: '!', output: '↩'
    };

    const steps = fn.steps.length
      ? (showAll ? fn.steps : fn.steps.slice(0, 12))
      : [{ kind: 'output', label: `Return ${fn.returnType || fn.returnExprs[0] || 'void'}`, inputs: [], output: 'return', line: fn.startLine }];

    const headerH = 44;
    const totalH = headerH + 16 + steps.length * (STEP_H + GAP) + 12;
    let svg = `<svg viewBox="0 0 ${W} ${totalH}" width="100%" height="${totalH}" xmlns="http://www.w3.org/2000/svg">`;

    // Input Ports Capsule
    const inText = fn.params.length
      ? fn.params.map((p) => p.type ? `${p.name}: ${p.type}` : p.name).join(', ')
      : 'no inputs ( )';
    svg += `
      <rect x="8" y="6" width="${W - 16}" height="34" rx="8" fill="rgba(56,189,248,0.12)" stroke="#38bdf8" stroke-opacity="0.5"/>
      <text x="18" y="20" fill="#38bdf8" font-size="9" font-weight="700" letter-spacing="0.07em">INPUTS</text>
      <text x="18" y="33" fill="var(--text-strong)" font-size="11" font-family="var(--font-mono)">${escHtml(trunc(inText, 44))}</text>
    `;

    let prevY = 40;
    steps.forEach((st, idx) => {
      const y = headerH + 16 + idx * (STEP_H + GAP);
      const col = stepColors[st.kind] || '#94a3b8';
      const ic = stepIcons[st.kind] || '•';

      // Connecting signal wire
      svg += `<line x1="${W / 2}" y1="${prevY}" x2="${W / 2}" y2="${y}" stroke="${col}" stroke-opacity="0.5" stroke-width="1.5"/>`;
      svg += `<polygon points="${W / 2 - 3.5},${y - 5} ${W / 2 + 3.5},${y - 5} ${W / 2},${y}" fill="${col}" fill-opacity="0.8"/>`;

      // Step block
      svg += `<rect x="14" y="${y}" width="${W - 28}" height="${STEP_H}" rx="8" fill="var(--surface-elevated)" stroke="${col}" stroke-opacity="0.5"/>`;
      svg += `<rect x="14" y="${y + 6}" width="3.5" height="${STEP_H - 12}" rx="2" fill="${col}"/>`;

      // Kind badge
      svg += `<text x="26" y="${y + 17}" fill="${col}" font-size="9.5" font-weight="700" letter-spacing="0.06em">${ic} ${escHtml(st.kind.toUpperCase())}${st.isAsync ? ' · ⚡ASYNC' : ''}</text>`;
      svg += `<text x="${W - 22}" y="${y + 17}" text-anchor="end" fill="var(--text-dim)" font-size="9.5" font-family="var(--font-mono)">L${st.line}</text>`;

      // Step label + output binding
      const rightTag = st.output && st.output !== 'return' ? `→ ${trunc(st.output, 14)}` : '';
      svg += `<text x="26" y="${y + 34}" fill="var(--text-strong)" font-size="11" font-family="var(--font-mono)">${escHtml(trunc(st.label, rightTag ? 30 : 44))}</text>`;
      if (rightTag) {
        svg += `<text x="${W - 22}" y="${y + 34}" text-anchor="end" fill="#34d399" font-size="10.5" font-family="var(--font-mono)" font-weight="650">${escHtml(rightTag)}</text>`;
      }

      prevY = y + STEP_H;
    });

    svg += `</svg>`;
    return svg;
  }

  function renderModuleInspector(mod) {
    if (!mod) return;
    const color = LAYER_COLORS[mod.layer] || '#38bdf8';
    const fns = mod.functionIds.map((id) => fnById.get(id)).filter(Boolean);
    const diags = diagsByMod.get(mod.id) || [];
    const incoming = DATA.moduleEdges.filter((e) => e.to === mod.id);
    const outgoing = DATA.moduleEdges.filter((e) => e.from === mod.id);

    el.inspBadges.innerHTML = `
      <span class="badge" style="color:${color};border-color:${color}44">${escHtml(mod.layer)}</span>
      <span class="badge">${escHtml(mod.language)}</span>
      ${mod.isEntryPoint ? '<span class="badge" style="color:#38bdf8">Entrypoint</span>' : ''}
    `;
    el.inspTitle.textContent = mod.name;
    el.inspSubtitle.textContent = `${mod.id} · ${mod.lines} lines · ${fns.length} functions`;

    el.inspActions.innerHTML = `
      <button class="trace-btn trace-btn-primary" id="act-drill-mod">Zoom Into Functions (L3)</button>
    `;
    document.getElementById('act-drill-mod').onclick = () => {
      setSemanticZoom(3, false);
      if (mod.functionIds[0]) focusNodeInView(mod.functionIds[0]);
    };

    el.inspVisual.innerHTML = `
      ${mod.exports.length ? `
      <div class="insp-section">
        <div class="insp-section-title">Exported Surface Ports (${mod.exports.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${mod.exports.map((ex) => `<span class="payload-tag" style="color:var(--accent-domain);background:rgba(52,211,153,0.14)">${escHtml(ex)}</span>`).join('')}
        </div>
      </div>` : ''}

      ${diags.length ? `
      <div class="insp-section">
        <div class="insp-section-title">Bug Radar Findings (${diags.length})</div>
        <div class="chip-list">
          ${diags.map((d) => `
            <div class="risk-card sev-${d.severity}" data-jump-line="${d.line || 1}" title="Click to inspect line in Source X-Ray">
              <div class="risk-card-body">
                <div class="risk-card-title">${escHtml(d.title)}</div>
                <div class="risk-card-msg">${escHtml(d.message)}</div>
                ${d.suggestion ? `<div class="risk-card-fix">Fix: ${escHtml(d.suggestion)}</div>` : ''}
              </div>
              <span class="risk-loc">L${d.line || 1} ↗</span>
            </div>
          `).join('')}
        </div>
      </div>` : ''}

      <div class="insp-section">
        <div class="insp-section-title">Functions Inside This Module (${fns.length})</div>
        <div class="chip-list">
          ${fns.length ? fns.map((f) => `
            <button class="nav-chip" data-jump-fn="${escHtml(f.id)}">
              <div>
                <div class="nav-chip-main">${f.isAsync ? '⚡ ' : ''}${escHtml(f.qualName)}(${escHtml(f.params.map((p) => p.name).join(', '))})</div>
                <div class="nav-chip-sub">L${f.startLine} · ${f.steps.length} steps · Complexity ${f.complexity} ${formatGlyphs(f.flags)}</div>
              </div>
              <span class="payload-tag">${escHtml(f.returnType || f.returnExprs[0] || 'void')}</span>
            </button>
          `).join('') : '<div class="muted">Top-level script or configuration module</div>'}
        </div>
      </div>

      ${mod.libraries.length ? `
      <div class="insp-section">
        <div class="insp-section-title">External Libraries Wired (${mod.libraries.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${mod.libraries.map((l) => `<button class="trace-btn" data-jump-lib="lib::${escHtml(l)}" style="color:var(--accent-lib)">${escHtml(l)}</button>`).join('')}
        </div>
      </div>` : ''}

      <div class="insp-section">
        <div class="insp-section-title">Module Wiring (${incoming.length} in · ${outgoing.length} out)</div>
        <div class="chip-list">
          ${outgoing.map((e) => `
            <button class="nav-chip" data-jump-mod="${escHtml(e.to)}">
              <div><div class="nav-chip-main">→ ${escHtml(modById.get(e.to)?.name || e.to)}</div><div class="nav-chip-sub">${escHtml(e.symbols.slice(0, 4).join(', ') || 'module import')}</div></div>
              ${e.isCycle ? '<span class="badge" style="color:var(--accent-critical)">↻ CYCLE</span>' : ''}
            </button>
          `).join('')}
          ${incoming.map((e) => `
            <button class="nav-chip" data-jump-mod="${escHtml(e.from)}">
              <div><div class="nav-chip-main">← ${escHtml(modById.get(e.from)?.name || e.from)}</div><div class="nav-chip-sub">imports ${escHtml(e.symbols.slice(0, 4).join(', ') || 'this module')}</div></div>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    el.inspVisual.querySelectorAll('[data-jump-line]').forEach((card) => {
      card.addEventListener('click', () => {
        const ln = Number(card.getAttribute('data-jump-line'));
        jumpToSourceLine(mod.source, 1, mod.lines, diags.map((d) => d.line), ln, mod.lines);
      });
    });
    el.inspVisual.querySelectorAll('[data-jump-fn]').forEach((b) => b.addEventListener('click', () => {
      const fid = b.getAttribute('data-jump-fn');
      selectEntity('function', fid);
    }));
    el.inspVisual.querySelectorAll('[data-jump-mod]').forEach((b) => b.addEventListener('click', () => {
      const mid = b.getAttribute('data-jump-mod');
      selectEntity('module', mid);
      focusNodeInView(mid);
    }));
    el.inspVisual.querySelectorAll('[data-jump-lib]').forEach((b) => b.addEventListener('click', () => {
      selectEntity('library', b.getAttribute('data-jump-lib'));
    }));

    mountSourceViewer(mod.source, 1, Math.min(mod.lines, 240), diags.map((d) => d.line), mod.lines);
  }

  function renderLibraryInspector(lib) {
    if (!lib) return;
    const lc = LIB_COLORS[lib.category] || '#c084fc';
    el.inspBadges.innerHTML = `
      <span class="badge" style="color:${lc};border-color:${lc}55">External Package</span>
      <span class="badge">${escHtml(lib.category)}</span>
    `;
    el.inspTitle.textContent = lib.name;
    el.inspSubtitle.textContent = `Imported by ${lib.moduleIds.length} module(s) across the codebase`;

    el.inspVisual.innerHTML = `
      ${lib.importedSymbols.length ? `
      <div class="insp-section">
        <div class="insp-section-title">Imported APIs / Symbols</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${lib.importedSymbols.map((s) => `<span class="payload-tag" style="color:${lc};background:rgba(192,132,252,0.14)">${escHtml(s)}</span>`).join('')}
        </div>
      </div>` : ''}
      <div class="insp-section">
        <div class="insp-section-title">Modules Wired to ${escHtml(lib.name)} (${lib.moduleIds.length})</div>
        <div class="chip-list">
          ${lib.moduleIds.map((mId) => {
            const m = modById.get(mId);
            return `<button class="nav-chip" data-jump-mod="${escHtml(mId)}">
              <div><div class="nav-chip-main">${escHtml(m?.name || mId)}</div><div class="nav-chip-sub">${escHtml(mId)}</div></div>
              <span class="badge">${escHtml(m?.layer || '')}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    el.inspVisual.querySelectorAll('[data-jump-mod]').forEach((b) => b.addEventListener('click', () => {
      const mid = b.getAttribute('data-jump-mod');
      selectEntity('module', mid);
      focusNodeInView(mid);
    }));
    el.inspSource.innerHTML = `<div class="muted" style="padding:12px">External library "${escHtml(lib.name)}" — select a connected module to inspect its import and usage lines.</div>`;
  }

  function setBadgeChips(chips) {
    el.inspBadges.textContent = '';
    for (const c of chips) {
      const span = document.createElement('span');
      span.className = 'badge';
      if (c.color) span.style.color = c.color;
      if (c.borderColor) span.style.borderColor = c.borderColor;
      span.textContent = c.text;
      el.inspBadges.appendChild(span);
    }
  }

  function renderCallEdgeInspector(edge) {
    if (!edge) return;
    const fromFn = fnById.get(edge.from);
    const toFn = fnById.get(edge.to);
    const fromMod = modById.get(edge.fromModule);

    const badges = [{ text: 'Dataflow Wire', color: 'var(--accent-signal)' }];
    if (edge.isAsync) badges.push({ text: '⚡ async', color: '#22d3ee' });
    if (edge.isCycle) badges.push({ text: '↻ cycle', color: 'var(--accent-critical)' });
    setBadgeChips(badges);
    el.inspTitle.textContent = `${fromFn?.name} → ${toFn?.name}`;
    el.inspSubtitle.textContent = `Invoked at ${edge.fromModule} : line ${edge.line}`;

    el.inspVisual.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">Data Packet Transmitted Across Wire</div>
        <div class="pipeline-box" style="display:flex;flex-direction:column;gap:8px;font-family:var(--font-mono);font-size:12px">
          <div><span class="muted">ARGUMENTS PASSED →</span></div>
          ${edge.args.length ? edge.args.map((arg, idx) => {
            const targetParam = toFn?.params[idx];
            return `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;background:var(--surface-elevated)">
              <span style="color:var(--accent-entry)">${escHtml(arg)}</span>
              <span class="muted">↦ ${escHtml(targetParam ? targetParam.name + (targetParam.type ? ': ' + targetParam.type : '') : `arg[${idx}]`)}</span>
            </div>`;
          }).join('') : '<div class="muted">No arguments passed ()</div>'}
          <div style="margin-top:4px"><span class="muted">RETURN BINDING ←</span></div>
          <div style="padding:6px 8px;border-radius:6px;background:rgba(52,211,153,0.12);color:var(--accent-domain)">
            ${escHtml(edge.assignedTo ? `${edge.assignedTo} ← ${edge.returnHint || 'result'}` : edge.returnHint || 'void / unused return')}
          </div>
        </div>
      </div>

      <div class="insp-section">
        <div class="insp-section-title">Connected Chips</div>
        <div class="chip-list">
          <button class="nav-chip" data-jump-fn="${escHtml(edge.from)}"><div><div class="nav-chip-main">Caller: ${escHtml(fromFn?.qualName)}</div><div class="nav-chip-sub">${escHtml(edge.fromModule)}</div></div></button>
          <button class="nav-chip" data-jump-fn="${escHtml(edge.to)}"><div><div class="nav-chip-main">Callee: ${escHtml(toFn?.qualName)}</div><div class="nav-chip-sub">${escHtml(edge.toModule)}</div></div></button>
        </div>
      </div>
    `;
    el.inspVisual.querySelectorAll('[data-jump-fn]').forEach((b) => b.addEventListener('click', () => {
      const fid = b.getAttribute('data-jump-fn');
      selectEntity('function', fid);
      focusNodeInView(fid);
    }));

    if (fromMod) {
      mountSourceViewer(fromMod.source, Math.max(1, edge.line - 8), Math.min(fromMod.lines, edge.line + 10), [edge.line], fromMod.lines);
    } else {
      el.inspSource.innerHTML = '';
    }
  }

  function renderModEdgeInspector(edge) {
    if (!edge) return;
    const mf = modById.get(edge.from);
    const mt = modById.get(edge.to);
    const calls = DATA.callEdges.filter((c) => c.fromModule === edge.from && c.toModule === edge.to);

    const badges = [{ text: 'Module Cable', color: 'var(--accent-signal)' }];
    if (edge.isCycle) badges.push({ text: '↻ Circular Dependency', color: 'var(--accent-critical)' });
    setBadgeChips(badges);
    el.inspTitle.textContent = `${mf?.name} → ${mt?.name}`;
    el.inspSubtitle.textContent = `${edge.symbols.length} imported symbol(s) · ${calls.length} function call wire(s)`;

    el.inspVisual.innerHTML = `
      <div class="insp-section">
        <div class="insp-section-title">Symbols Crossed</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          ${edge.symbols.length ? edge.symbols.map((s) => `<span class="payload-tag">${escHtml(s)}</span>`).join('') : '<span class="muted">Side-effect / default import</span>'}
        </div>
      </div>
      <div class="insp-section">
        <div class="insp-section-title">Function Calls Across This Boundary (${calls.length})</div>
        <div class="chip-list">
          ${calls.length ? calls.map((c) => `
            <button class="nav-chip" data-jump-ce="${escHtml(c.id)}">
              <div><div class="nav-chip-main">${escHtml(fnById.get(c.from)?.name)} → ${escHtml(fnById.get(c.to)?.name)}</div><div class="nav-chip-sub">Line ${c.line}</div></div>
              <span class="payload-tag">(${escHtml(c.args.join(', ') || '∅')})</span>
            </button>
          `).join('') : '<div class="muted">Type-only or constant import</div>'}
        </div>
      </div>
    `;
    el.inspVisual.querySelectorAll('[data-jump-ce]').forEach((b) => b.addEventListener('click', () => {
      setSemanticZoom(3, false);
      selectEntity('callEdge', b.getAttribute('data-jump-ce'));
    }));
    if (mf) mountSourceViewer(mf.source, 1, Math.min(mf.lines, 40), [], mf.lines);
    else el.inspSource.innerHTML = '';
  }

  // Zero-dependency lightweight syntax highlighter for Source X-Ray
  function highlightLine(raw) {
    const escaped = escHtml(raw);
    return escaped
      .replace(/(\/\/.*$|#[^!].*$)/g, '<span class="tok-cmt">$1</span>')
      .replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, '<span class="tok-str">$1</span>')
      .replace(/\b(import|export|from|const|let|var|function|async|await|return|if|else|for|while|try|catch|throw|class|new|def|elif|except|raise|with|as|pass|yield|pub|fn|struct|impl|package|func|interface|type)\b/g, '<span class="tok-kw">$1</span>')
      .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  }

  function renderCodeViewer(source, startLine, endLine, riskLines = [], jumpLine = null) {
    const riskSet = new Set(riskLines.filter(Boolean));
    const lines = source.split('\n');
    const from = Math.max(1, startLine - 2);
    const to = Math.min(lines.length, endLine + 2);
    let html = '<div class="code-viewer">';
    for (let ln = from; ln <= to; ln++) {
      const inRange = ln >= startLine && ln <= endLine;
      const isRisk = riskSet.has(ln);
      const isJump = jumpLine === ln;
      const cls = isJump ? 'code-line hl-jump' : isRisk ? 'code-line hl-risk' : inRange ? 'code-line hl-focus' : 'code-line';
      html += `<div class="${cls}" data-ln="${ln}"><span class="code-ln">${ln}</span><span class="code-txt">${highlightLine(lines[ln - 1] || '')}</span></div>`;
    }
    html += '</div>';
    return html;
  }

  function mountSourceViewer(source, startLine, endLine, riskLines = [], totalLines = null, jumpLine = null) {
    const lineCount = totalLines || source.split('\n').length;
    const isTruncated = startLine > 1 || endLine < lineCount;
    const truncBar = isTruncated
      ? `<div class="code-trunc-bar">
          <span>Showing lines ${startLine}–${Math.min(endLine, lineCount)} of ${lineCount}</span>
          <button class="panel-action-btn" id="btn-show-full-source">Show Full File (${lineCount} lines)</button>
        </div>`
      : '';
    el.inspSource.innerHTML = truncBar + renderCodeViewer(source, startLine, endLine, riskLines, jumpLine);
    const fullBtn = document.getElementById('btn-show-full-source');
    if (fullBtn) {
      fullBtn.addEventListener('click', () => {
        mountSourceViewer(source, 1, lineCount, riskLines, lineCount, jumpLine);
      });
    }
  }

  function jumpToSourceLine(source, startLine, endLine, riskLines, targetLine, totalLines) {
    const lineCount = totalLines || source.split('\n').length;
    const showStart = targetLine < startLine ? 1 : startLine;
    const showEnd = targetLine > endLine ? lineCount : endLine;
    mountSourceViewer(source, showStart, showEnd, riskLines, lineCount, targetLine);
    setActiveInspectorTab('source');
    requestAnimationFrame(() => {
      const row = el.inspSource.querySelector(`[data-ln="${targetLine}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // =========================================================================
  // 7. PLAYABLE SIGNAL TRACER ("FOLLOW THE DATA")
  // =========================================================================

  function startTrace(flow) {
    if (!flow) return;
    stopTracePlay();
    state.riskLens = false;
    el.riskDock.classList.add('hidden');
    el.btnRisk.classList.remove('active-risk');
    state.activeTrace = flow;
    state.traceHop = 0;

    el.btnFlows.classList.add('active-signal');
    el.flowPopover.classList.add('hidden');
    el.traceDock.classList.remove('hidden');

    if (state.zoomLevel !== 3) setSemanticZoom(3, false);
    updateTraceView();
  }

  function startDynamicTrace(fnId) {
    const startFn = fnById.get(fnId);
    if (!startFn) return;
    const hops = [];
    const fnSet = new Set([fnId]);
    const modSet = new Set([startFn.moduleId]);

    hops.push({
      stepIndex: 0,
      fromFunctionId: null,
      toFunctionId: fnId,
      edgeId: null,
      payload: startFn.params.length ? `(${startFn.params.map((p) => p.name).join(', ')})` : '()',
      outputHint: startFn.returnType || startFn.returnExprs[0] || 'void',
      isAsync: startFn.isAsync,
      depth: 0
    });

    const visited = new Set([fnId]);
    function walk(id, depth) {
      if (depth >= 5 || hops.length >= 14) return;
      const outs = DATA.callEdges.filter((e) => e.from === id).sort((a, b) => a.line - b.line);
      for (const e of outs) {
        if (hops.length >= 14) break;
        const t = fnById.get(e.to);
        if (!t) continue;
        hops.push({
          stepIndex: hops.length,
          fromFunctionId: id,
          toFunctionId: e.to,
          edgeId: e.id,
          payload: e.args.length ? `(${e.args.join(', ')})` : '()',
          outputHint: e.assignedTo ? `→ ${e.assignedTo}` : e.returnHint || 'void',
          isAsync: e.isAsync,
          depth: depth + 1
        });
        fnSet.add(e.to);
        modSet.add(t.moduleId);
        if (!visited.has(e.to)) {
          visited.add(e.to);
          walk(e.to, depth + 1);
        }
      }
    }
    walk(fnId, 0);

    startTrace({
      id: `dyn::${fnId}`,
      title: `Trace: ${startFn.qualName}()`,
      entryFunctionId: fnId,
      entryModuleId: startFn.moduleId,
      hops,
      functionIds: [...fnSet],
      moduleIds: [...modSet]
    });
  }

  function updateTraceView() {
    const flow = state.activeTrace;
    if (!flow) return;
    const hop = flow.hops[state.traceHop];
    const fn = fnById.get(hop.toFunctionId);

    el.traceTitle.textContent = flow.title;
    el.traceHopCounter.textContent = `Hop ${state.traceHop + 1} / ${flow.hops.length}`;

    el.traceBeads.innerHTML = flow.hops.map((h, idx) => {
      const target = fnById.get(h.toFunctionId);
      return `${idx > 0 ? '<span class="bead-arrow">→</span>' : ''}<button class="bead${idx === state.traceHop ? ' active' : ''}" data-hop="${idx}">${idx + 1}. ${escHtml(target?.name || h.toFunctionId)}</button>`;
    }).join('');

    el.traceBeads.querySelectorAll('[data-hop]').forEach((b) => {
      b.addEventListener('click', () => {
        state.traceHop = Number(b.getAttribute('data-hop'));
        updateTraceView();
      });
    });
    const activeBead = el.traceBeads.querySelector('.bead.active');
    if (activeBead) activeBead.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    el.tracePacket.innerHTML = `
      <span class="muted">IN</span>
      <span class="pkt-pill">${escHtml(hop.payload)}</span>
      <span class="muted">▶</span>
      <strong style="color:var(--text-strong)">${hop.isAsync ? '⚡ ' : ''}${escHtml(fn?.qualName || hop.toFunctionId)}</strong>
      <span class="muted">OUT</span>
      <span class="pkt-out">${escHtml(hop.outputHint)}</span>
      <span class="muted" style="margin-left:auto">${escHtml(fn?.moduleId || '')}</span>
    `;

    el.traceNarration.textContent = hop.narration || fn?.explanation?.plainEnglish || '';

    state.selection = { type: 'function', id: hop.toFunctionId };
    el.inspector.classList.remove('collapsed');
    renderInspector();
    renderCanvas();
    focusNodeInView(hop.toFunctionId, 0.92);
  }

  function toggleTracePlay() {
    if (!state.activeTrace) return;
    if (state.traceTimer) {
      stopTracePlay();
      return;
    }
    el.tracePlay.textContent = '⏸ Pause';
    state.traceTimer = setInterval(() => {
      if (!state.activeTrace) return stopTracePlay();
      state.traceHop = (state.traceHop + 1) % state.activeTrace.hops.length;
      updateTraceView();
    }, 1750);
  }

  function stopTracePlay() {
    if (state.traceTimer) {
      clearInterval(state.traceTimer);
      state.traceTimer = null;
    }
    el.tracePlay.textContent = '▶ Play';
  }

  function exitTrace() {
    stopTracePlay();
    state.activeTrace = null;
    el.traceDock.classList.add('hidden');
    el.btnFlows.classList.remove('active-signal');
    renderCanvas();
  }

  // =========================================================================
  // 8. BUG RADAR / RISK LENS
  // =========================================================================

  function getFilteredDiagnostics() {
    if (state.riskFilter === 'all') return DATA.diagnostics;
    if (['critical', 'warning', 'info'].includes(state.riskFilter)) {
      return DATA.diagnostics.filter((d) => d.severity === state.riskFilter);
    }
    return DATA.diagnostics.filter((d) => d.category === state.riskFilter);
  }

  function toggleRiskLens(force) {
    state.riskLens = force !== undefined ? force : !state.riskLens;
    if (state.riskLens) {
      exitTrace();
      el.btnRisk.classList.add('active-risk');
      el.riskDock.classList.remove('hidden');
      renderRiskDock();
    } else {
      el.btnRisk.classList.remove('active-risk');
      el.riskDock.classList.add('hidden');
    }
    renderCanvas();
  }

  function toggleRiskExpanded(force) {
    state.riskExpanded = force !== undefined ? force : !state.riskExpanded;
    el.riskDock.classList.toggle('expanded', state.riskExpanded);
    el.btnExpandRisk.classList.toggle('active', state.riskExpanded);
    el.btnExpandRisk.setAttribute('aria-expanded', String(state.riskExpanded));
    el.btnExpandRisk.textContent = state.riskExpanded ? '⤡ Compact' : '⤢ Expand';
    updateRiskFooter();
  }

  function updateRiskFooter() {
    const count = getFilteredDiagnostics().length;
    if (count <= 2) {
      el.riskDockFooter.classList.add('hidden');
      return;
    }
    el.riskDockFooter.classList.remove('hidden');
    const actionLabel = state.riskExpanded ? 'Compact view' : 'Expand to see more';
    el.riskDockFooter.innerHTML = `
      <span>Showing ${count} finding${count === 1 ? '' : 's'} — scroll to browse all</span>
      <button class="panel-action-btn" id="btn-footer-expand-risk">${actionLabel}</button>
    `;
    document.getElementById('btn-footer-expand-risk').onclick = () => toggleRiskExpanded();
  }

  function renderRiskDock() {
    const s = DATA.meta.stats;
    el.riskDockSummary.textContent = `${s.criticalCount} critical · ${s.warningCount} warning · ${s.infoCount} info`;

    const catCount = (cat) => DATA.diagnostics.filter((d) => d.category === cat).length;
    const filters = [
      { id: 'all', label: `All (${DATA.diagnostics.length})` },
      ...(s.criticalCount > 0 ? [{ id: 'critical', label: `Critical (${s.criticalCount})` }] : []),
      ...(s.warningCount > 0 ? [{ id: 'warning', label: `Warning (${s.warningCount})` }] : []),
      ...(s.infoCount > 0 ? [{ id: 'info', label: `Info (${s.infoCount})` }] : []),
      { id: 'ai-antipattern', label: `AI Smells (${catCount('ai-antipattern')})` },
      { id: 'security', label: `Security (${catCount('security')})` },
      { id: 'architecture', label: `Architecture (${catCount('architecture')})` },
      ...(catCount('reliability') > 0 ? [{ id: 'reliability', label: `Reliability (${catCount('reliability')})` }] : []),
      { id: 'dead-code', label: `Orphan Code (${catCount('dead-code')})` }
    ];
    el.riskFilters.textContent = '';
    for (const f of filters) {
      const btn = document.createElement('button');
      btn.className = `rf-btn${state.riskFilter === f.id ? ' active' : ''}`;
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        state.riskFilter = f.id;
        renderRiskDock();
        renderCanvas();
      });
      el.riskFilters.appendChild(btn);
    }

    const list = getFilteredDiagnostics();
    el.riskList.innerHTML = list.length ? list.map((d) => `
      <div class="risk-card sev-${d.severity}" data-diag="${escHtml(d.id)}">
        <div class="risk-card-body">
          <div class="risk-card-title">${escHtml(d.title)}</div>
          <div class="risk-card-msg">${escHtml(d.message)}</div>
          ${d.suggestion ? `<div class="risk-card-fix">Fix: ${escHtml(d.suggestion)}</div>` : ''}
        </div>
        <span class="risk-loc">${escHtml(d.moduleId.split('/').pop())}${d.line ? `:${d.line}` : ''}</span>
      </div>
    `).join('') : '<div class="muted" style="padding:10px">No findings in this filter — clean circuit!</div>';
    el.riskList.scrollTop = 0;

    el.riskList.querySelectorAll('[data-diag]').forEach((card) => {
      card.addEventListener('click', () => {
        const d = DATA.diagnostics.find((x) => x.id === card.getAttribute('data-diag'));
        if (!d) return;
        if (d.functionId) {
          if (state.zoomLevel !== 3) setSemanticZoom(3, false);
          selectEntity('function', d.functionId);
          focusNodeInView(d.functionId, 0.95);
        } else {
          if (state.zoomLevel !== 2) setSemanticZoom(2, false);
          selectEntity('module', d.moduleId);
          focusNodeInView(d.moduleId, 0.95);
        }
      });
    });

    updateRiskFooter();
  }

  // =========================================================================
  // 9. GUIDED 60-SECOND CODEBASE TOUR
  // =========================================================================

  function startTour() {
    if (!DATA.tour || !DATA.tour.length) return;
    state.tourIndex = 0;
    el.tourCard.classList.remove('hidden');
    applyTourStop();
  }

  function closeTour() {
    state.tourIndex = -1;
    el.tourCard.classList.add('hidden');
  }

  function applyTourStop() {
    const stop = DATA.tour[state.tourIndex];
    if (!stop) return closeTour();
    el.tourTitle.textContent = stop.title;
    el.tourCaption.textContent = stop.caption;
    el.tourDots.textContent = '';
    DATA.tour.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = `tour-dot${i === state.tourIndex ? ' active' : ''}`;
      el.tourDots.appendChild(dot);
    });
    el.tourNext.textContent = state.tourIndex === DATA.tour.length - 1 ? 'Finish ✓' : 'Next →';

    if (stop.focusType === 'overview') {
      exitTrace();
      toggleRiskLens(false);
      closeInspector();
      setSemanticZoom(1, true);
    } else if (stop.focusType === 'flow' && stop.targetId) {
      const fl = flowById.get(stop.targetId);
      if (fl) startTrace(fl);
    } else if (stop.focusType === 'module' && stop.targetId) {
      exitTrace();
      toggleRiskLens(false);
      setSemanticZoom(2, false);
      selectEntity('module', stop.targetId);
      focusNodeInView(stop.targetId, 0.95);
    } else if (stop.focusType === 'library' && stop.targetId) {
      exitTrace();
      toggleRiskLens(false);
      setSemanticZoom(2, false);
      selectEntity('library', stop.targetId);
      focusNodeInView(stop.targetId, 0.95);
    } else if (stop.focusType === 'risk') {
      exitTrace();
      setSemanticZoom(stop.zoomLevel || 2, false);
      toggleRiskLens(true);
      if (stop.targetId) {
        const isFn = fnById.has(stop.targetId);
        selectEntity(isFn ? 'function' : 'module', stop.targetId);
        focusNodeInView(stop.targetId, 0.95);
      }
    }
  }

  // =========================================================================
  // 10. COMMAND PALETTE SEARCH (/)
  // =========================================================================

  const searchIndex = [
    ...DATA.modules.map((m) => ({ kind: 'Module', title: m.name, sub: m.id, type: 'module', id: m.id, level: 2 })),
    ...DATA.functions.map((f) => ({ kind: 'Function', title: f.qualName, sub: `${f.moduleId} : L${f.startLine}`, type: 'function', id: f.id, level: 3 })),
    ...DATA.libraries.map((l) => ({ kind: 'Library', title: l.name, sub: `${l.category} · ${l.moduleIds.length} modules`, type: 'library', id: l.id, level: 2 })),
    ...DATA.flows.map((fl) => ({ kind: 'Flow', title: fl.title, sub: `${fl.hops.length} hops`, type: 'flow', id: fl.id, level: 3 })),
    ...DATA.diagnostics.map((d) => ({ kind: d.severity, title: d.title, sub: `${d.moduleId}${d.line ? ':' + d.line : ''}`, type: 'diag', id: d.id, diag: d }))
  ];

  function openSearch() {
    el.searchModal.classList.remove('hidden');
    el.searchInput.value = '';
    state.searchShowAll = false;
    state.searchSelectedIndex = 0;
    renderSearchResults('');
    setTimeout(() => el.searchInput.focus(), 10);
  }

  function closeSearch() {
    el.searchModal.classList.add('hidden');
  }

  function updateSearchSelection(nextIdx) {
    const hits = el.searchResults._hits || [];
    if (!hits.length) return;
    state.searchSelectedIndex = ((nextIdx % hits.length) + hits.length) % hits.length;
    el.searchResults.querySelectorAll('.search-item').forEach((btn, idx) => {
      const sel = idx === state.searchSelectedIndex;
      btn.classList.toggle('selected', sel);
      if (sel) btn.scrollIntoView({ block: 'nearest' });
    });
  }

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    const allHits = q
      ? searchIndex.filter((item) => item.title.toLowerCase().includes(q) || item.sub.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q))
      : searchIndex;
    const limit = state.searchShowAll ? allHits.length : 25;
    const hits = allHits.slice(0, limit);
    state.searchSelectedIndex = 0;

    const metaBar = allHits.length > 0
      ? `<div class="search-meta-bar"><span>Showing ${hits.length} of ${allHits.length} result${allHits.length === 1 ? '' : 's'}</span><span>↑↓ navigate · Enter open</span></div>`
      : '';
    const moreBtn = allHits.length > hits.length
      ? `<button class="expand-more-btn" id="btn-search-show-all" style="margin-top:6px">Show all ${allHits.length} matches (+${allHits.length - hits.length} more)</button>`
      : '';

    el.searchResults.innerHTML = hits.length ? metaBar + hits.map((h, i) => `
      <button class="search-item${i === 0 ? ' selected' : ''}" data-sidx="${i}">
        <div style="min-width:0;flex:1">
          <div style="font-weight:650;font-family:var(--font-mono);color:var(--text-strong);word-break:break-word">${escHtml(h.title)}</div>
          <div class="muted" style="word-break:break-word">${escHtml(h.sub)}</div>
        </div>
        <span class="search-kind">${escHtml(h.kind)}</span>
      </button>
    `).join('') + moreBtn : '<div class="muted" style="padding:14px">No matching symbols found.</div>';

    el.searchResults._hits = hits;
    el.searchResults.querySelectorAll('.search-item').forEach((btn) => {
      btn.addEventListener('click', () => activateSearchHit(hits[Number(btn.getAttribute('data-sidx'))]));
    });
    const showAllBtn = document.getElementById('btn-search-show-all');
    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        state.searchShowAll = true;
        renderSearchResults(el.searchInput.value);
      });
    }
  }

  function activateSearchHit(hit) {
    if (!hit) return;
    closeSearch();
    if (hit.type === 'flow') {
      startTrace(flowById.get(hit.id));
    } else if (hit.type === 'diag') {
      toggleRiskLens(true);
      const d = hit.diag;
      const isFn = Boolean(d.functionId);
      setSemanticZoom(isFn ? 3 : 2, false);
      selectEntity(isFn ? 'function' : 'module', d.functionId || d.moduleId);
      focusNodeInView(d.functionId || d.moduleId, 0.95);
    } else {
      setSemanticZoom(hit.level, false);
      selectEntity(hit.type, hit.id);
      focusNodeInView(hit.id, 0.95);
    }
  }

  // =========================================================================
  // 11. SEMANTIC ZOOM, BREADCRUMBS, TOOLTIPS & INTERACTION WIRING
  // =========================================================================

  function setSemanticZoom(level, shouldFit = true) {
    state.zoomLevel = level;
    document.querySelectorAll('.zoom-pill').forEach((p) => {
      p.classList.toggle('active', Number(p.getAttribute('data-level')) === level);
    });
    renderCanvas();
    if (shouldFit) fitToViewport(true);
  }

  function renderBreadcrumbs() {
    const lvlNames = { 1: 'Atlas', 2: 'Circuit', 3: 'Dataflow' };
    el.breadcrumbs.textContent = '';
    const rootBtn = document.createElement('button');
    rootBtn.className = 'crumb-btn';
    rootBtn.textContent = DATA.meta.projectName;
    rootBtn.addEventListener('click', () => {
      exitTrace();
      closeInspector();
      fitToViewport(true);
    });
    const sep1 = document.createElement('span');
    sep1.textContent = '/';
    const lvlSpan = document.createElement('span');
    lvlSpan.style.color = 'var(--accent-signal)';
    lvlSpan.style.fontWeight = '650';
    lvlSpan.textContent = lvlNames[state.zoomLevel];
    el.breadcrumbs.append(rootBtn, sep1, lvlSpan);

    if (state.selection) {
      const { type, id } = state.selection;
      const label = type === 'module' ? modById.get(id)?.name
        : type === 'function' ? fnById.get(id)?.qualName
        : type === 'library' ? libById.get(id)?.name
        : 'Wire';
      const sep2 = document.createElement('span');
      sep2.textContent = '/';
      const selSpan = document.createElement('span');
      selSpan.style.color = 'var(--text-strong)';
      selSpan.style.fontFamily = 'var(--font-mono)';
      selSpan.textContent = label || id;
      el.breadcrumbs.append(sep2, selSpan);
    }
  }

  function showTooltip(ev, title, sub) {
    el.tooltip.innerHTML = `<div class="tt-title">${escHtml(title)}</div><div class="tt-sub">${escHtml(sub)}</div>`;
    el.tooltip.classList.remove('hidden');
    const tw = el.tooltip.offsetWidth || 280;
    const th = el.tooltip.offsetHeight || 72;
    const left = Math.max(8, Math.min(window.innerWidth - tw - 12, ev.clientX + 14));
    const top = Math.max(8, Math.min(window.innerHeight - th - 12, ev.clientY + 14));
    el.tooltip.style.left = `${left}px`;
    el.tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    el.tooltip.classList.add('hidden');
  }

  function initHud() {
    const s = DATA.meta.stats;
    el.projectTitle.textContent = DATA.meta.projectName;
    el.projectMeta.textContent = `${s.totalFiles} files · ${s.totalFunctions} fns · ${s.totalCallEdges} wires · ${s.totalLibraries} libs`;
    el.flowCount.textContent = DATA.flows.length;
    el.riskCount.textContent = s.totalDiagnostics;

    // Health ring gauge
    el.healthScoreVal.textContent = s.healthScore;
    const offset = 66 * (1 - s.healthScore / 100);
    el.healthRingFg.setAttribute('stroke-dashoffset', offset.toFixed(1));
    const hColor = s.healthScore >= 80 ? '#34d399' : s.healthScore >= 55 ? '#fbbf24' : '#fb7185';
    el.healthRingFg.style.stroke = hColor;
    el.healthScoreVal.style.color = hColor;

    // Populate Trace Signal popover
    if (DATA.flows.length > 0) {
      el.flowPopover.innerHTML = `
        <div class="popover-header">Discovered Execution Signals (${DATA.flows.length})</div>
        ${DATA.flows.map((fl) => `
          <button class="popover-item" data-flow="${escHtml(fl.id)}">
            <span class="popover-item-title">▶ ${escHtml(fl.title)}</span>
            <span class="popover-item-sub">${fl.hops.length} hops across ${fl.moduleIds.length} module(s) · ${escHtml(fl.entryModuleId)}</span>
          </button>
        `).join('')}
      `;
      el.flowPopover.querySelectorAll('[data-flow]').forEach((b) => {
        b.addEventListener('click', () => startTrace(flowById.get(b.getAttribute('data-flow'))));
      });
    } else {
      el.flowPopover.innerHTML = '<div class="muted" style="padding:10px">Click any function chip in Dataflow (L3) and press "Trace Signal From Here".</div>';
    }
  }

  const OVERLAY_SELECTOR = '.trace-dock, .risk-dock, .story-panel, .tour-card, .viewport-hud, .floating-top-left';

  function bindStagePanZoom() {
    let dragging = false;
    let dragMoved = false;
    let dragOrigin = { x: 0, y: 0 };
    let dragStart = { x: 0, y: 0 };

    el.stage.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || ev.target.closest(OVERLAY_SELECTOR)) return;
      dragging = true;
      dragMoved = false;
      dragOrigin = { x: ev.clientX, y: ev.clientY };
      dragStart = { x: ev.clientX - state.camera.x, y: ev.clientY - state.camera.y };
      el.stage.classList.add('panning');
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      if (Math.hypot(ev.clientX - dragOrigin.x, ev.clientY - dragOrigin.y) > 4) dragMoved = true;
      state.camera.x = ev.clientX - dragStart.x;
      state.camera.y = ev.clientY - dragStart.y;
      applyCamera();
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
      el.stage.classList.remove('panning');
    });

    el.svg.addEventListener('click', () => {
      if (dragMoved) { dragMoved = false; return; }
      if (state.selection && !state.activeTrace) closeInspector();
      el.flowPopover.classList.add('hidden');
    });

    el.stage.addEventListener('wheel', (ev) => {
      if (ev.target.closest(OVERLAY_SELECTOR)) return;
      ev.preventDefault();
      const rect = el.stage.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      const newK = Math.max(0.2, Math.min(2.6, state.camera.k * (ev.deltaY < 0 ? 1.12 : 0.89)));
      const ratio = newK / state.camera.k;
      state.camera.x = mx - (mx - state.camera.x) * ratio;
      state.camera.y = my - (my - state.camera.y) * ratio;
      state.camera.k = newK;
      applyCamera();
    }, { passive: false });

    el.minimap.addEventListener('click', (ev) => {
      const m = el.minimap._meta;
      if (!m) return;
      const r = el.minimap.getBoundingClientRect();
      const wx = ((ev.clientX - r.left) / r.width * 180 - m.ox) / m.scale;
      const wy = ((ev.clientY - r.top) / r.height * 110 - m.oy) / m.scale;
      const sr = el.stage.getBoundingClientRect();
      animateCamera({ x: sr.width / 2 - wx * state.camera.k, y: sr.height / 2 - wy * state.camera.k, k: state.camera.k });
    });

    const zoomBy = (mult) => {
      const r = el.stage.getBoundingClientRect();
      const nk = Math.max(0.22, Math.min(2.4, state.camera.k * mult));
      const ratio = nk / state.camera.k;
      animateCamera({ x: r.width / 2 - (r.width / 2 - state.camera.x) * ratio, y: r.height / 2 - (r.height / 2 - state.camera.y) * ratio, k: nk });
    };
    document.getElementById('btn-zoom-in').onclick = () => zoomBy(1.25);
    document.getElementById('btn-zoom-out').onclick = () => zoomBy(0.8);
    document.getElementById('btn-zoom-fit').onclick = () => fitToViewport(true);
  }

  function bindHudAndPanels() {
    document.querySelectorAll('.zoom-pill').forEach((pill) => {
      pill.addEventListener('click', () => setSemanticZoom(Number(pill.getAttribute('data-level')), true));
    });
    window.addEventListener('click', (ev) => {
      if (!ev.target.closest('.flow-menu-wrap')) el.flowPopover.classList.add('hidden');
    });

    el.btnStory.onclick = () => toggleSystemStory();
    el.btnExpandStory.onclick = () => {
      state.storyExpanded = !state.storyExpanded;
      el.storyPanel.classList.toggle('expanded', state.storyExpanded);
      el.btnExpandStory.classList.toggle('active', state.storyExpanded);
      el.btnExpandStory.setAttribute('aria-expanded', String(state.storyExpanded));
      el.btnExpandStory.textContent = state.storyExpanded ? '⤡ Compact' : '⤢ Expand';
    };
    document.getElementById('story-close').onclick = () => toggleSystemStory(false);
    el.btnPlainMode.onclick = () => {
      state.plainEnglishMode = !state.plainEnglishMode;
      el.btnPlainMode.classList.toggle('active-explain', state.plainEnglishMode);
      renderCanvas();
    };

    el.btnFlows.onclick = (e) => { e.stopPropagation(); el.flowPopover.classList.toggle('hidden'); };
    el.btnRisk.onclick = () => toggleRiskLens();
    el.btnExpandRisk.onclick = () => toggleRiskExpanded();
    el.healthPill.onclick = () => toggleRiskLens(true);
    document.getElementById('btn-close-risk').onclick = () => toggleRiskLens(false);
    el.btnTour.onclick = () => startTour();
    el.btnSearch.onclick = () => openSearch();

    el.btnTheme.onclick = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', state.theme);
      el.themeGlyph.textContent = state.theme === 'dark' ? '☀' : '☾';
    };

    el.btnExpandInspector.onclick = () => {
      state.inspectorExpanded = !state.inspectorExpanded;
      el.inspector.classList.toggle('expanded', state.inspectorExpanded);
      el.btnExpandInspector.setAttribute('aria-expanded', String(state.inspectorExpanded));
      el.btnExpandInspector.textContent = state.inspectorExpanded ? '⤡' : '⤢';
      el.btnExpandInspector.title = state.inspectorExpanded ? 'Narrow Inspector' : 'Expand Inspector';
      setTimeout(() => renderMiniMap(), 240);
    };
    document.getElementById('insp-close').onclick = closeInspector;
    document.querySelectorAll('.insp-tab').forEach((tab) => {
      tab.addEventListener('click', () => setActiveInspectorTab(tab.getAttribute('data-tab')));
    });

    document.getElementById('trace-prev').onclick = () => stepTrace(-1);
    document.getElementById('trace-next').onclick = () => stepTrace(1);
    el.tracePlay.onclick = toggleTracePlay;
    document.getElementById('trace-close').onclick = exitTrace;

    document.getElementById('tour-close').onclick = closeTour;
    document.getElementById('tour-prev').onclick = () => { if (state.tourIndex > 0) { state.tourIndex--; applyTourStop(); } };
    el.tourNext.onclick = () => { if (state.tourIndex < DATA.tour.length - 1) { state.tourIndex++; applyTourStop(); } else closeTour(); };

    el.searchModal.addEventListener('click', (e) => { if (e.target === el.searchModal) closeSearch(); });
    el.searchInput.addEventListener('input', (e) => {
      state.searchShowAll = false;
      renderSearchResults(e.target.value);
    });
    el.searchInput.addEventListener('keydown', (e) => {
      const hits = el.searchResults._hits || [];
      if (e.key === 'ArrowDown') { e.preventDefault(); updateSearchSelection(state.searchSelectedIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); updateSearchSelection(state.searchSelectedIndex - 1); }
      else if (e.key === 'Enter' && hits[state.searchSelectedIndex]) activateSearchHit(hits[state.searchSelectedIndex]);
      else if (e.key === 'Escape') closeSearch();
    });
  }

  function stepTrace(delta) {
    if (!state.activeTrace) return;
    stopTracePlay();
    const n = state.activeTrace.hops.length;
    state.traceHop = (state.traceHop + delta + n) % n;
    updateTraceView();
  }

  function bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (((e.metaKey || e.ctrlKey) && key === 'k') || e.key === '/') { e.preventDefault(); openSearch(); return; }
      if (e.key === '1' || e.key === '2' || e.key === '3') { setSemanticZoom(Number(e.key), true); return; }
      if (key === 's') { toggleSystemStory(); return; }
      if (key === 'e') { el.btnPlainMode.click(); return; }
      if (key === 'r') { toggleRiskLens(); return; }
      if (key === 't') { startTour(); return; }
      if (key === 'f') { fitToViewport(true); return; }
      if (e.key === ' ' && state.activeTrace) { e.preventDefault(); toggleTracePlay(); return; }
      if (e.key === 'ArrowRight' && state.activeTrace) { stepTrace(1); return; }
      if (e.key === 'ArrowLeft' && state.activeTrace) { stepTrace(-1); return; }
      if (e.key === 'Escape') {
        closeSearch();
        el.flowPopover.classList.add('hidden');
        if (state.storyOpen) toggleSystemStory(false);
        else if (state.activeTrace) exitTrace();
        else if (state.tourIndex >= 0) closeTour();
        else if (state.riskLens) toggleRiskLens(false);
        else closeInspector();
      }
    });
    window.addEventListener('resize', () => renderMiniMap());
  }

  function bindEvents() {
    bindStagePanZoom();
    bindHudAndPanels();
    bindKeyboardShortcuts();
  }

  // Bootstrap!
  initHud();
  bindEvents();
  renderCanvas();
  requestAnimationFrame(() => fitToViewport(false));
})();
