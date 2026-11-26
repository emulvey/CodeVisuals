/**
 * Glassbox V2 Semantic Code Explainer Engine
 * Synthesizes grounded, plain-English explanations at every zoom level
 * (System Story -> Module Role -> Function Narrative & Step Storyboard -> Wire & Flow Narration)
 * purely from AST, dataflow, docstrings, identifier semantics, and library knowledge.
 */

const KNOWN_LIB_ROLES = {
  express: 'HTTP routing & REST API endpoints',
  fastify: 'high-performance HTTP API routing',
  fastapi: 'Python async HTTP API endpoints',
  flask: 'Python web routes',
  django: 'web framework & ORM',
  axios: 'outbound HTTP API requests',
  'node-fetch': 'outbound HTTP requests',
  requests: 'outbound Python HTTP requests',
  httpx: 'async Python HTTP requests',
  stripe: 'payment & card charging via Stripe',
  pg: 'PostgreSQL database queries',
  prisma: 'type-safe database ORM',
  mongoose: 'MongoDB document persistence',
  redis: 'in-memory Redis caching',
  sqlite3: 'embedded SQLite database storage',
  sqlalchemy: 'SQL database modeling & queries',
  nodemailer: 'transactional email delivery',
  'node:fs': 'local filesystem reading & writing',
  fs: 'local filesystem reading & writing',
  'node:path': 'cross-platform file path resolution',
  path: 'cross-platform file path resolution',
  'node:http': 'local HTTP server hosting',
  'node:child_process': 'spawning external processes',
  'node:crypto': 'cryptographic hashing & UUID generation',
  crypto: 'cryptographic utilities & IDs',
  react: 'interactive UI components',
  zod: 'runtime schema validation',
  pydantic: 'Python data validation & schemas',
  ast: 'Python Abstract Syntax Tree parsing',
  json: 'JSON serialization & parsing',
  math: 'mathematical computations',
  hashlib: 'cryptographic hashing',
  re: 'regular-expression pattern matching',
  sys: 'system stdin/stdout & runtime access',
  subprocess: 'external subprocess execution',
  openai: 'OpenAI LLM inference',
  anthropic: 'Anthropic Claude inference'
};

const VERB_MAP = {
  get: 'retrieves', fetch: 'fetches', load: 'loads', read: 'reads', find: 'finds', lookup: 'looks up', query: 'queries',
  set: 'sets', save: 'saves', store: 'stores', write: 'writes', insert: 'inserts', persist: 'persists', record: 'records',
  create: 'creates', build: 'builds', make: 'constructs', generate: 'generates', init: 'initializes', synthesize: 'synthesizes',
  update: 'updates', edit: 'modifies', patch: 'patches', apply: 'applies', toggle: 'toggles', switch: 'switches',
  delete: 'deletes', remove: 'removes', clear: 'clears', close: 'closes', exit: 'exits', stop: 'stops',
  validate: 'validates', verify: 'verifies', check: 'checks', inspect: 'inspects', audit: 'audits', guard: 'guards',
  calculate: 'calculates', compute: 'computes', calc: 'calculates', score: 'scores', evaluate: 'evaluates', estimate: 'estimates',
  parse: 'parses', tokenize: 'tokenizes', extract: 'extracts', split: 'splits', slice: 'slices', format: 'formats', normalize: 'normalizes',
  render: 'renders', draw: 'draws', show: 'displays', hide: 'hides', highlight: 'highlights', animate: 'animates', layout: 'lays out',
  run: 'orchestrates', execute: 'executes', process: 'processes', handle: 'handles', dispatch: 'dispatches', start: 'starts',
  send: 'sends', emit: 'emits', publish: 'publishes', notify: 'notifies', charge: 'charges',
  resolve: 'resolves', link: 'links', bind: 'wires up', register: 'registers', index: 'indexes', walk: 'traverses',
  analyze: 'analyzes', collect: 'collects', filter: 'filters', order: 'orders', sort: 'sorts', classify: 'classifies', assign: 'assigns',
  focus: 'focuses', fit: 'fits', select: 'selects', open: 'opens', activate: 'activates', step: 'advances',
  is: 'checks whether', has: 'checks if', can: 'checks whether', try: 'attempts to'
};

const INTENT_TAG_RULES = [
  { tag: 'HTTP Routes', re: /\b(route|router|endpoint|GET |POST |PUT |DELETE |express|fastapi)\b/i },
  { tag: 'Validates', re: /\b(validat|verif|guard|check|schema|sanitize)\b/i },
  { tag: 'Calculates', re: /\b(calc|comput|price|pricing|total|discount|tax|score|metric|estimate)\b/i },
  { tag: 'Persists DB', re: /\b(sql|postgres|pg|sqlite|mongo|prisma|repo|repository|saveOrder|insert|query)\b/i },
  { tag: 'External API', re: /\b(axios|fetch|http|stripe|gateway|webhook|client|bridge)\b/i },
  { tag: 'Notifies', re: /\b(email|mail|nodemailer|notify|notification|sms|alert)\b/i },
  { tag: 'Parses AST', re: /\b(parse|token|ast|lex|syntax|scanner)\b/i },
  { tag: 'Graph & Flow', re: /\b(graph|edge|cycle|flow|trace|layer|layout|barycenter)\b/i },
  { tag: 'Audits Risks', re: /\b(diag|risk|bug|secret|sink|orphan|duplicate|audit)\b/i },
  { tag: 'Renders UI', re: /\b(render|svg|canvas|inspector|modal|tooltip|minimap|breadcrumb|hud)\b/i },
  { tag: 'Orchestrates', re: /\b(pipeline|orchestrat|workflow|coordinator|controller|handler|main)\b/i }
];

function humanizeIdent(name) {
  if (!name) return '';
  const cleaned = name.replace(/^[A-Z]+ \//, '').replace(/\([^)]*\)$/, '').trim();
  return cleaned
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function phraseFromFnName(fn) {
  if (fn.kind === 'route') {
    const m = fn.name.match(/^(GET|POST|PUT|PATCH|DELETE|USE)\s+(\S+)/i);
    if (m) return `Handles ${m[1].toUpperCase()} requests to ${m[2]}`;
  }
  const baseName = fn.name.includes('.') ? fn.name.split('.').pop() : fn.name;
  const words = humanizeIdent(baseName).split(' ').filter(Boolean);
  if (!words.length) return `Executes ${fn.name}`;
  const first = words[0];
  const rest = words.slice(1).join(' ');
  if (VERB_MAP[first]) {
    return capitalize(rest ? `${VERB_MAP[first]} ${rest}` : `${VERB_MAP[first]} data`);
  }
  return capitalize(`Handles ${words.join(' ')}`);
}

function inferIntentTags(text) {
  const tags = [];
  for (const rule of INTENT_TAG_RULES) {
    if (rule.re.test(text) && tags.length < 4) tags.push(rule.tag);
  }
  return tags;
}

function narrateStep(step, callEdgesByLine, fnById) {
  const edge = callEdgesByLine.get(step.line);
  const targetFn = edge ? fnById.get(edge.to) : null;

  if (step.kind === 'guard') {
    return {
      ...step,
      caption: `Checks guard condition (${step.detail}) and exits or rejects early if triggered.`,
      targetFunctionId: null
    };
  }
  if (step.kind === 'branch') {
    return {
      ...step,
      caption: `Branches execution based on whether (${step.detail}) holds.`,
      targetFunctionId: null
    };
  }
  if (step.kind === 'loop') {
    return {
      ...step,
      caption: `Iterates over ${step.inputs.length ? step.inputs.join(', ') : 'items'} (${step.detail}).`,
      targetFunctionId: null
    };
  }
  if (step.kind === 'error') {
    return {
      ...step,
      caption: step.label.startsWith('Throw') || step.label.startsWith('Raise')
        ? `Aborts normal flow and raises an error: ${step.detail}.`
        : `Catches and handles runtime error (${step.detail || 'recovery block'}).`,
      targetFunctionId: null
    };
  }
  if (step.kind === 'output') {
    return {
      ...step,
      caption: step.detail && step.detail !== 'void' && step.detail !== 'None'
        ? `Returns ${step.detail} to the caller.`
        : 'Completes execution without returning a value.',
      targetFunctionId: null
    };
  }
  if (step.kind === 'transform') {
    const src = step.inputs.length ? `from ${step.inputs.slice(0, 3).join(', ')}` : '';
    return {
      ...step,
      caption: `Derives \`${step.output || 'value'}\` ${src} (${step.detail}).`.replace(/\s+/g, ' '),
      targetFunctionId: null
    };
  }
  if (step.kind === 'io') {
    const outPart = step.output && step.output !== 'return' ? ` and stores the response in \`${step.output}\`` : '';
    const asyncWord = step.isAsync ? 'Asynchronously performs' : 'Performs';
    return {
      ...step,
      caption: `${asyncWord} external I/O via \`${step.label}\`${outPart}.`,
      targetFunctionId: targetFn ? targetFn.id : null
    };
  }
  // Regular function call
  const asyncWord = step.isAsync ? 'Awaits' : 'Calls';
  const argsText = step.inputs.length ? ` passing ${step.inputs.slice(0, 3).join(', ')}` : '';
  const outPart = step.output && step.output !== 'return' ? ` → saves result as \`${step.output}\`` : '';
  const purpose = targetFn ? ` (${phraseFromFnName(targetFn).toLowerCase()})` : '';
  return {
    ...step,
    caption: `${asyncWord} \`${step.targetCallee || step.label}()\`${argsText}${purpose}${outPart}.`,
    targetFunctionId: targetFn ? targetFn.id : null
  };
}

function buildDataJourney(fn, fnCalls, fnDiags) {
  const inputs = fn.params.map((p) => {
    const passedTo = fnCalls
      .filter((e) => e.args.some((a) => a.includes(p.name)))
      .map((e) => e.calleeLabel);
    const usedInSteps = fn.steps
      .filter((s) => (s.inputs || []).some((inp) => inp.includes(p.name)))
      .map((s) => s.kind);
    let role = 'Used in local computation';
    if (passedTo.length) role = `Passed downstream to ${[...new Set(passedTo)].slice(0, 2).join(', ')}`;
    else if (usedInSteps.includes('guard')) role = 'Validated by an early guard check';
    else if (usedInSteps.includes('io')) role = 'Sent to an external I/O boundary';
    else if (usedInSteps.includes('branch')) role = 'Controls conditional branching';
    return { name: p.name, type: p.type || (p.optional ? 'optional' : 'value'), role };
  });

  const sideEffects = [];
  if (fn.flags.hasIO) sideEffects.push('Performs external I/O (network, database, email, or filesystem)');
  if (fn.flags.hasMutation) sideEffects.push('Mutates state, properties, or collections in place');
  if (fn.isAsync) sideEffects.push('Executes asynchronously and returns a Promise / coroutine');
  if (!sideEffects.length) sideEffects.push('Pure local transformation (no detected I/O or state mutation)');

  const outputs = fn.returnExprs.length
    ? `Returns ${fn.returnExprs.slice(0, 2).join(' or ')}${fn.returnType ? ` (${fn.returnType})` : ''}`
    : fn.returnType
    ? `Produces ${fn.returnType}`
    : 'No explicit return value (side-effect or void)';

  const edgeCases = [];
  const hasGuard = fn.steps.some((s) => s.kind === 'guard');
  if (hasGuard) edgeCases.push('Contains explicit early guard checks for invalid/edge inputs');
  if (!hasGuard && fn.flags.hasIO && fn.params.length > 0) {
    edgeCases.push('No early validation guard detected before external I/O — verify caller sanitizes inputs');
  }
  for (const d of fnDiags.slice(0, 3)) {
    edgeCases.push(`⚠ ${d.title}: ${d.suggestion}`);
  }
  if (!edgeCases.length) edgeCases.push('Straightforward control flow with no detected structural hazards');

  return { inputs, sideEffects, outputs, edgeCases };
}

function explainFunction(fn, mod, outCallEdges, fnDiags, fnById) {
  const shortIntent = phraseFromFnName(fn);
  const callEdgesByLine = new Map();
  const fnCalls = outCallEdges.map((e) => {
    callEdgesByLine.set(e.line, e);
    return { ...e, calleeLabel: fnById.get(e.to)?.name || e.to };
  });

  const narratedSteps = fn.steps.map((s) => narrateStep(s, callEdgesByLine, fnById));
  const dataJourney = buildDataJourney(fn, fnCalls, fnDiags);

  // Build crisp 1-2 sentence plain-English summary
  const paramStr = fn.params.length ? `Takes ${fn.params.map((p) => `\`${p.name}\``).slice(0, 4).join(', ')}` : 'Takes no inputs';
  const actions = [];
  if (fn.steps.some((s) => s.kind === 'guard')) actions.push('validates inputs');
  if (outCallEdges.length > 0) {
    const targets = [...new Set(outCallEdges.map((e) => fnById.get(e.to)?.name).filter(Boolean))].slice(0, 3);
    actions.push(`delegates to ${targets.map((t) => `\`${t}()\``).join(', ')}`);
  }
  if (fn.flags.hasIO) actions.push('performs external I/O');
  if (fn.flags.hasLoop) actions.push('iterates over data');
  if (fn.flags.hasBranch && !fn.steps.some((s) => s.kind === 'guard')) actions.push('applies conditional logic');

  const actionClause = actions.length ? `, ${actions.join(', ')},` : '';
  const retClause = fn.returnExprs[0]
    ? ` and returns \`${fn.returnExprs[0].slice(0, 44)}\`.`
    : fn.returnType
    ? ` and produces \`${fn.returnType}\`.`
    : '.';

  const plainEnglish = fn.docComment
    ? `${fn.docComment} ${paramStr}${actionClause}${retClause}`
    : `${shortIntent}. ${paramStr}${actionClause}${retClause}`;

  const tagCorpus = `${fn.qualName} ${mod.id} ${fn.steps.map((s) => s.label).join(' ')}`;
  return {
    shortIntent,
    plainEnglish,
    docComment: fn.docComment || null,
    tags: inferIntentTags(tagCorpus),
    narratedSteps,
    dataJourney
  };
}

function explainModule(mod, modFns, inEdges, outEdges) {
  const libRoles = mod.libraries.map((l) => KNOWN_LIB_ROLES[l] || l).slice(0, 3);
  const fnIntents = modFns.slice(0, 3).map((f) => f.explanation?.shortIntent?.toLowerCase() || humanizeIdent(f.name));

  // Short crisp intent for Plain-English Canvas Mode
  let shortIntent = '';
  if (mod.entryReason && modFns.some((f) => f.kind === 'route')) {
    const routes = modFns.filter((f) => f.kind === 'route').length;
    shortIntent = `Exposes ${routes} HTTP API endpoint${routes === 1 ? '' : 's'}`;
  } else if (fnIntents.length === 1) {
    shortIntent = capitalize(fnIntents[0]);
  } else if (mod.layer === 'orchestration') {
    shortIntent = `Orchestrates ${humanizeIdent(mod.name.replace(/\.[^.]+$/, ''))}`;
  } else if (mod.layer === 'data' && libRoles.length) {
    shortIntent = `Handles ${libRoles[0]}`;
  } else if (fnIntents.length > 0) {
    shortIntent = capitalize(fnIntents[0]);
  } else {
    shortIntent = `${capitalize(mod.layer)} module (${mod.language})`;
  }

  const parts = [];
  if (mod.docComment) {
    parts.push(mod.docComment);
  } else {
    const layerDesc = {
      entry: 'Entry-layer interface',
      orchestration: 'Orchestration coordinator',
      domain: 'Domain processing module',
      data: 'Data & infrastructure module'
    }[mod.layer] || 'Code module';
    parts.push(`${layerDesc} responsible for ${fnIntents.length ? fnIntents.join('; ') : humanizeIdent(mod.name)}.`);
  }

  if (libRoles.length) parts.push(`Powered by ${mod.libraries.slice(0, 3).map((l) => `\`${l}\``).join(', ')} (${libRoles[0]}).`);
  if (inEdges.length || outEdges.length) {
    parts.push(`Receives calls from ${inEdges.length} module${inEdges.length === 1 ? '' : 's'} and delegates to ${outEdges.length} downstream module${outEdges.length === 1 ? '' : 's'}.`);
  }

  const tagCorpus = `${mod.id} ${mod.libraries.join(' ')} ${modFns.map((f) => f.qualName).join(' ')}`;
  return {
    shortIntent: shortIntent.slice(0, 56),
    summary: parts.join(' '),
    tags: inferIntentTags(tagCorpus),
    docComment: mod.docComment || null
  };
}

function buildSystemStory(ir) {
  const langs = Object.keys(ir.meta.languages);
  const hasRoutes = ir.functions.some((f) => f.kind === 'route');
  const hasCli = ir.modules.some((m) => m.entryReason === 'CLI Entrypoint');
  const hasUi = ir.modules.some((m) => /ui|app\.js|component/i.test(m.id));
  const hasParsers = ir.modules.some((m) => /parser|ast/i.test(m.id));

  let archetype = 'Modular Software System';
  if (hasRoutes && langs.length > 1) archetype = 'Polyglot API & Microservice Architecture';
  else if (hasRoutes) archetype = 'Web API & Backend Service';
  else if (hasParsers && hasUi) archetype = 'Static Analysis & Visual Tooling Engine';
  else if (hasCli) archetype = 'Command-Line Automation Tool';
  else if (hasUi) archetype = 'Interactive Web Application';

  const entryMods = ir.modules.filter((m) => m.isEntryPoint || m.layer === 'entry').slice(0, 4);
  const coreHubs = [...ir.modules].sort((a, b) => (b.metrics.fanIn + b.metrics.fanOut) - (a.metrics.fanIn + a.metrics.fanOut)).slice(0, 3);
  const notableLibs = ir.libraries.filter((l) => KNOWN_LIB_ROLES[l.name]).slice(0, 5);

  // Extract domain concept pills from filenames
  const stopWords = new Set(['index', 'main', 'app', 'src', 'lib', 'util', 'utils', 'test', 'js', 'ts', 'py', 'mjs', 'tsx', 'jsx', 'service', 'client', 'config', 'routes', 'pipeline', 'repository', 'bridge']);
  const conceptCounts = new Map();
  for (const m of ir.modules) {
    for (const w of humanizeIdent(m.name.replace(/\.[^.]+$/, '')).split(' ')) {
      if (w.length >= 3 && !stopWords.has(w)) conceptCounts.set(w, (conceptCounts.get(w) || 0) + 1);
    }
  }
  const keyConcepts = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => capitalize(w));

  const headline = `${ir.meta.projectName} is a ${archetype.toLowerCase()} spanning ${ir.meta.stats.totalFiles} ${langs.join('/')} modules (${ir.meta.stats.totalFunctions} functions) organized across ${ir.layers.filter((l) => l.moduleIds.length > 0).length} architectural layers.`;

  const sections = [
    {
      id: 'entry',
      icon: '→',
      color: '#38bdf8',
      title: 'How Work Enters',
      text: entryMods.length
        ? `Execution begins through ${entryMods.map((m) => m.name).join(', ')}, exposing ${ir.flows.length} traceable end-to-end signal path${ir.flows.length === 1 ? '' : 's'}.`
        : `Work enters via exported module APIs across ${ir.modules.length} files.`,
      links: entryMods.map((m) => ({ type: 'module', id: m.id, label: m.name }))
    },
    {
      id: 'core',
      icon: '⚙',
      color: '#34d399',
      title: 'Core Processing Spine',
      text: coreHubs.length
        ? `Central processing flows through ${coreHubs.map((m) => `${m.name} (${m.explanation.shortIntent.toLowerCase()})`).join(', ')}.`
        : 'Logic is distributed evenly across independent helper modules.',
      links: coreHubs.map((m) => ({ type: 'module', id: m.id, label: m.name }))
    },
    {
      id: 'libs',
      icon: '⇄',
      color: '#c084fc',
      title: 'External Integrations & Capabilities',
      text: notableLibs.length
        ? `Integrates with ${notableLibs.map((l) => `${l.name} (${KNOWN_LIB_ROLES[l.name]})`).join(', ')}.`
        : ir.libraries.length
        ? `Uses ${ir.libraries.length} external/standard packages (${ir.libraries.slice(0, 4).map((l) => l.name).join(', ')}).`
        : 'Zero external runtime dependencies — self-contained standard code.',
      links: (notableLibs.length ? notableLibs : ir.libraries.slice(0, 4)).map((l) => ({ type: 'library', id: l.id, label: l.name }))
    },
    {
      id: 'risk',
      icon: ir.meta.stats.totalDiagnostics > 0 ? '⚠' : '✓',
      color: ir.meta.stats.criticalCount > 0 ? '#fb7185' : ir.meta.stats.warningCount > 0 ? '#fbbf24' : '#34d399',
      title: 'Health & AI-Code Risk Posture',
      text: ir.meta.stats.totalDiagnostics > 0
        ? `Health score ${ir.meta.stats.healthScore}/100 — Bug Radar flagged ${ir.meta.stats.criticalCount} critical issue(s) and ${ir.meta.stats.warningCount} warning(s), led by "${ir.diagnostics[0].title}" in ${ir.diagnostics[0].moduleId}.`
        : `Health score ${ir.meta.stats.healthScore}/100 — clean circuit with zero detected circular dependencies, silent catches, contract mismatches, or security sinks.`,
      links: ir.diagnostics.slice(0, 3).map((d) => ({
        type: d.functionId ? 'function' : 'module',
        id: d.functionId || d.moduleId,
        label: d.title
      }))
    }
  ];

  return { archetype, headline, keyConcepts, sections };
}

/**
 * Enrich a complete GlassboxIR object with grounded plain-English explanations
 * for every function, module, wire, flow hop, and the overall system story.
 */
export function enrichWithExplanations(ir) {
  const fnById = new Map(ir.functions.map((f) => [f.id, f]));
  const modById = new Map(ir.modules.map((m) => [m.id, m]));

  const outCallsByFn = new Map();
  for (const e of ir.callEdges) {
    if (!outCallsByFn.has(e.from)) outCallsByFn.set(e.from, []);
    outCallsByFn.get(e.from).push(e);
  }
  const diagsByFn = new Map();
  for (const d of ir.diagnostics) {
    if (!d.functionId) continue;
    if (!diagsByFn.has(d.functionId)) diagsByFn.set(d.functionId, []);
    diagsByFn.get(d.functionId).push(d);
  }

  // 1. Explain every function
  for (const fn of ir.functions) {
    const mod = modById.get(fn.moduleId);
    fn.explanation = explainFunction(fn, mod, outCallsByFn.get(fn.id) || [], diagsByFn.get(fn.id) || [], fnById);
  }

  // 2. Explain every module
  for (const mod of ir.modules) {
    const modFns = mod.functionIds.map((id) => fnById.get(id)).filter(Boolean);
    const inEdges = ir.moduleEdges.filter((e) => e.to === mod.id);
    const outEdges = ir.moduleEdges.filter((e) => e.from === mod.id);
    mod.explanation = explainModule(mod, modFns, inEdges, outEdges);
  }

  // 3. Explain every dataflow call wire
  for (const edge of ir.callEdges) {
    const fromFn = fnById.get(edge.from);
    const toFn = fnById.get(edge.to);
    const argsTxt = edge.args.length ? `\`${edge.args.join(', ')}\`` : 'no arguments';
    const intent = toFn?.explanation?.shortIntent?.toLowerCase() || `run ${toFn?.name}`;
    const assignTxt = edge.assignedTo ? `, binding the result to \`${edge.assignedTo}\`` : '';
    edge.explanation = `${fromFn?.name || 'Caller'} passes ${argsTxt} to \`${toFn?.name}()\` to ${intent}${assignTxt}.`;
  }

  // 4. Narrate every hop in every playable execution flow
  for (const flow of ir.flows) {
    const hopSummaries = [];
    for (const hop of flow.hops) {
      const target = fnById.get(hop.toFunctionId);
      const caller = hop.fromFunctionId ? fnById.get(hop.fromFunctionId) : null;
      const intent = target?.explanation?.shortIntent || `Runs ${target?.name || hop.toFunctionId}`;
      if (!caller) {
        hop.narration = `Entry: ${intent} with ${hop.payload}.`;
      } else {
        hop.narration = `${caller.name} hands ${hop.payload} to ${target?.name} → ${intent.toLowerCase()} (${hop.outputHint}).`;
      }
      hopSummaries.push(intent.toLowerCase());
    }
    flow.storySummary = `Starts at ${flow.title}: ${hopSummaries.slice(0, 5).join(' → ')}.`;
  }

  // 5. Synthesize System Story
  ir.systemStory = buildSystemStory(ir);
  return ir;
}
