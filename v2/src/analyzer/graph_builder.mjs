import path from 'node:path';

const LIB_CATEGORIES = [
  { cat: 'web', re: /^(express|fastify|koa|hono|flask|fastapi|django|aiohttp|gin|actix|axum|next|nuxt|http|https|net|ws|socket\.io|cors|helmet|starlette|uvicorn)/i },
  { cat: 'ui', re: /^(react|vue|svelte|solid|angular|preact|tailwind|framer|lucide|radix|mui|antd|d3|three|canvas)/i },
  { cat: 'data', re: /^(prisma|drizzle|typeorm|sequelize|mongoose|knex|pg|mysql|sqlite|sqlite3|redis|ioredis|sqlalchemy|psycopg|pymongo|pandas|numpy|polars|pydantic|zod|joi|yup|dataclasses)/i },
  { cat: 'ai', re: /^(openai|anthropic|@google\/genai|langchain|llamaindex|transformers|torch|tensorflow|sklearn|scikit|tiktoken|chromadb|pinecone)/i },
  { cat: 'crypto', re: /^(crypto|bcrypt|argon2|jsonwebtoken|jose|hashlib|hmac|secrets|jwt|oauth|passport)/i },
  { cat: 'io', re: /^(fs|node:fs|path|node:path|os|sys|subprocess|child_process|node:child_process|axios|got|node-fetch|requests|httpx|urllib|boto3|@aws-sdk|stripe|twilio|nodemailer|shutil|pathlib|json|csv|yaml)/i },
  { cat: 'stdlib', re: /^(node:|re$|math$|time$|datetime$|logging$|typing$|collections$|itertools$|functools$|asyncio$|uuid$|enum$|abc$|ast$|inspect$|util$|events$|stream$|url$)/i }
];

function classifyLibrary(name) {
  for (const { cat, re } of LIB_CATEGORIES) {
    if (re.test(name)) return cat;
  }
  return 'util';
}

function normalizeExternalLibName(spec) {
  if (spec.startsWith('node:')) return spec;
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0].split('.')[0];
}

function resolvePythonImport(fromDir, spec, moduleIdSet) {
  const candidates = [];
  if (spec.startsWith('.')) {
    let dots = 0;
    while (spec[dots] === '.') dots++;
    let baseDir = fromDir;
    for (let d = 1; d < dots; d++) baseDir = path.posix.dirname(baseDir);
    const rest = spec.slice(dots).replace(/\./g, '/');
    const joined = baseDir === '.' ? rest : path.posix.normalize(path.posix.join(baseDir, rest));
    candidates.push(rest ? `${joined}.py` : `${baseDir}/__init__.py`);
    if (rest) candidates.push(`${joined}/__init__.py`);
  } else {
    const asPath = spec.replace(/\./g, '/');
    candidates.push(`${asPath}.py`, `${asPath}/__init__.py`);
    if (fromDir !== '.') candidates.push(path.posix.normalize(path.posix.join(fromDir, `${asPath}.py`)));
    for (const id of moduleIdSet) {
      if (id.endsWith(`/${asPath}.py`) || id === `${asPath}.py` || id.endsWith(`/${asPath}/__init__.py`)) {
        return { resolved: id, isRelative: true };
      }
    }
  }
  for (const c of candidates) {
    const clean = c.replace(/^\.\//, '');
    if (moduleIdSet.has(clean)) return { resolved: clean, isRelative: true };
  }
  return { resolved: null, isRelative: spec.startsWith('.') };
}

function resolveImport(fromModuleId, spec, language, moduleIdSet) {
  const fromDir = path.posix.dirname(fromModuleId);
  if (language === 'python') return resolvePythonImport(fromDir, spec, moduleIdSet);

  const isRelative = spec.startsWith('.') || spec.startsWith('/');
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

  if (!isRelative) {
    if (spec.startsWith('@/') || spec.startsWith('~/')) {
      const stripped = spec.slice(2);
      for (const prefix of ['', 'src/']) {
        for (const ext of exts) {
          const cand = `${prefix}${stripped}${ext}`;
          if (moduleIdSet.has(cand)) return { resolved: cand, isRelative: true };
        }
      }
    }
    return { resolved: null, isRelative: false };
  }

  const base = path.posix.normalize(path.posix.join(fromDir, spec));
  const withoutExt = base.replace(/\.(js|mjs|cjs|ts|tsx|jsx)$/, '');
  for (const b of [base, withoutExt]) {
    for (const ext of exts) {
      const cand = `${b}${ext}`.replace(/^\.\//, '');
      if (moduleIdSet.has(cand)) return { resolved: cand, isRelative: true };
    }
  }
  return { resolved: null, isRelative: true };
}

function findCycleEdges(nodeIds, edges) {
  const adj = new Map(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (e.from !== e.to && adj.has(e.from)) adj.get(e.from).push(e.to);
  }

  let index = 0;
  const indices = new Map();
  const lowlink = new Map();
  const stack = [];
  const onStack = new Set();
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlink.set(v, index++);
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) || []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v), lowlink.get(w)));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v), indices.get(w)));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(new Set(comp));
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) strongConnect(id);
  }

  const cycleEdgeIds = new Set();
  const cycleGroups = [];
  for (const scc of sccs) {
    cycleGroups.push([...scc]);
    for (const e of edges) {
      if (scc.has(e.from) && scc.has(e.to)) cycleEdgeIds.add(e.id);
    }
  }
  return { cycleEdgeIds, cycleGroups };
}

function assignArchitecturalLayer(mod, fanIn, fanOut) {
  const p = mod.id.toLowerCase();
  if (mod.isEntryPoint || /(^|\/)(routes?|endpoints?|api|cli|bin|main|server|app)\b/.test(p)) return 'entry';
  if (/(store|repo|repository|db|database|model|schema|entity|cache|storage|config|env|util|helper|lib|common|shared|types|constants|parser|client|adapter|gateway)\b/.test(p)) return 'data';
  if (/(pipeline|workflow|orchestrat|controller|handler|coordinator|manager|scheduler|job|worker|dispatcher)\b/.test(p)) return 'orchestration';
  if (/(service|engine|processor|domain|core|analyzer|generator|validator|pricing|fraud|payment|auth|billing|checkout|order|calc|compute|transform)\b/.test(p)) return 'domain';
  if (fanIn === 0 && fanOut > 0) return 'entry';
  if (fanOut === 0 && fanIn > 0) return 'data';
  return fanOut > fanIn ? 'orchestration' : 'domain';
}

function registerExternalLibrary(libraryMap, libName, modId, symbols) {
  if (!libraryMap.has(libName)) {
    libraryMap.set(libName, {
      id: `lib::${libName}`,
      name: libName,
      category: classifyLibrary(libName),
      moduleIds: new Set(),
      usageCount: 0,
      importedSymbols: new Set()
    });
  }
  const entry = libraryMap.get(libName);
  entry.moduleIds.add(modId);
  entry.usageCount++;
  for (const s of symbols) {
    if (s.name && s.name !== '*' && s.name !== 'default') entry.importedSymbols.add(s.name);
  }
}

function indexModulesAndFunctions(rawFiles, moduleIdSet) {
  const modules = [];
  const functions = [];
  const fnById = new Map();
  const fnsByModule = new Map();
  const fnsBySimpleName = new Map();
  const libraryMap = new Map();
  const brokenImports = [];

  for (const rf of rawFiles) {
    const modFns = rf.parsed.functions.map((fn) => {
      const record = {
        id: `${rf.id}::${fn.qualName}`,
        moduleId: rf.id,
        ...fn,
        metrics: { fanIn: 0, fanOut: 0, diagnosticCount: 0, maxSeverity: null }
      };
      functions.push(record);
      fnById.set(record.id, record);
      if (!fnsBySimpleName.has(fn.name)) fnsBySimpleName.set(fn.name, []);
      fnsBySimpleName.get(fn.name).push(record);
      return record;
    });
    fnsByModule.set(rf.id, modFns);

    const resolvedImports = [];
    const libsUsed = new Set();

    for (const imp of rf.parsed.imports) {
      const { resolved, isRelative } = resolveImport(rf.id, imp.source, rf.language, moduleIdSet);
      if (resolved) {
        resolvedImports.push({ source: imp.source, resolvedModuleId: resolved, isExternal: false, symbols: imp.symbols, line: imp.line });
      } else if (isRelative) {
        resolvedImports.push({ source: imp.source, resolvedModuleId: null, isExternal: false, symbols: imp.symbols, line: imp.line });
        brokenImports.push({ moduleId: rf.id, source: imp.source, line: imp.line });
      } else {
        const libName = normalizeExternalLibName(imp.source);
        if (libName) {
          libsUsed.add(libName);
          registerExternalLibrary(libraryMap, libName, rf.id, imp.symbols);
        }
        resolvedImports.push({ source: imp.source, resolvedModuleId: null, isExternal: true, symbols: imp.symbols, line: imp.line });
      }
    }

    const hasEntryFn = modFns.some((f) => f.isEntryPoint);
    modules.push({
      id: rf.id,
      name: path.posix.basename(rf.id),
      dir: path.posix.dirname(rf.id),
      language: rf.language,
      layer: 'domain',
      lines: rf.parsed.lines,
      isEntryPoint: Boolean(rf.parsed.entryReason || hasEntryFn),
      entryReason: rf.parsed.entryReason || (hasEntryFn ? 'Exported Entry Handler' : null),
      imports: resolvedImports,
      exports: rf.parsed.exports,
      libraries: [...libsUsed],
      functionIds: modFns.map((f) => f.id),
      source: rf.source,
      docComment: rf.parsed.docComment || null,
      summary: '',
      metrics: { complexity: modFns.reduce((s, f) => s + f.complexity, 0), fanIn: 0, fanOut: 0, diagnosticCount: 0, maxSeverity: null }
    });
  }

  return { modules, functions, fnById, fnsByModule, fnsBySimpleName, libraryMap, brokenImports };
}

function buildModuleEdgeMap(modules) {
  const modEdgeMap = new Map();
  for (const mod of modules) {
    for (const imp of mod.imports) {
      if (!imp.resolvedModuleId || imp.resolvedModuleId === mod.id) continue;
      const key = `${mod.id}-->${imp.resolvedModuleId}`;
      if (!modEdgeMap.has(key)) {
        modEdgeMap.set(key, { id: `me::${key}`, from: mod.id, to: imp.resolvedModuleId, symbols: new Set(), weight: 0, isCycle: false, callCount: 0 });
      }
      const edge = modEdgeMap.get(key);
      edge.weight += Math.max(1, imp.symbols.length);
      for (const s of imp.symbols) edge.symbols.add(s.name === 'default' ? s.alias : s.name);
    }
  }
  return modEdgeMap;
}

function resolveCalleeTarget(call, caller, ctx) {
  const { namespaceMap, importedSymbolMap, importedModules, sameModFns, sameModByName, fnsByModule, fnsBySimpleName } = ctx;

  if (call.qualifier && namespaceMap.has(call.qualifier)) {
    return (fnsByModule.get(namespaceMap.get(call.qualifier)) || []).find((f) => f.name === call.calleeName) || null;
  }
  if ((call.qualifier === 'this' || call.qualifier === 'self') && caller.className) {
    return sameModFns.find((f) => f.className === caller.className && f.name === call.calleeName) || null;
  }
  if (!call.qualifier && importedSymbolMap.has(call.calleeName)) {
    const info = importedSymbolMap.get(call.calleeName);
    const tFns = fnsByModule.get(info.targetModuleId) || [];
    return tFns.find((f) => f.name === info.origName || f.className === info.origName) || (info.origName === 'default' && tFns.length === 1 ? tFns[0] : null);
  }
  if (call.qualifier && importedSymbolMap.has(call.qualifier)) {
    const tFns = fnsByModule.get(importedSymbolMap.get(call.qualifier).targetModuleId) || [];
    const hit = tFns.find((f) => f.name === call.calleeName);
    if (hit) return hit;
  }
  if (!call.qualifier && sameModByName.has(call.calleeName)) return sameModByName.get(call.calleeName);

  if (call.qualifier) {
    for (const impModId of importedModules) {
      const match = (fnsByModule.get(impModId) || []).find((f) => f.name === call.calleeName);
      if (match) return match;
    }
  }
  const candidates = fnsBySimpleName.get(call.calleeName) || [];
  const inImported = candidates.filter((f) => importedModules.has(f.moduleId));
  if (inImported.length === 1) return inImported[0];
  if (!call.qualifier && candidates.length === 1 && candidates[0].exported) return candidates[0];
  return null;
}

function buildCallEdges(modules, fnsByModule, fnsBySimpleName, modEdgeMap) {
  const callEdges = [];
  const seenCallKey = new Set();

  for (const mod of modules) {
    const importedSymbolMap = new Map();
    const namespaceMap = new Map();
    const importedModules = new Set();

    for (const imp of mod.imports) {
      if (!imp.resolvedModuleId) continue;
      importedModules.add(imp.resolvedModuleId);
      for (const sym of imp.symbols) {
        if (sym.name === '*') namespaceMap.set(sym.alias, imp.resolvedModuleId);
        else importedSymbolMap.set(sym.alias, { targetModuleId: imp.resolvedModuleId, origName: sym.name });
      }
    }

    const sameModFns = fnsByModule.get(mod.id) || [];
    const sameModByName = new Map();
    for (const f of sameModFns) {
      sameModByName.set(f.name, f);
      sameModByName.set(f.qualName, f);
    }

    const ctx = { namespaceMap, importedSymbolMap, importedModules, sameModFns, sameModByName, fnsByModule, fnsBySimpleName };
    for (const caller of sameModFns) {
      for (const call of caller.calls) {
        const targetFn = resolveCalleeTarget(call, caller, ctx);
        if (!targetFn || targetFn.id === caller.id) continue;

        const edgeKey = `${caller.id}-->${targetFn.id}@${call.line}`;
        if (seenCallKey.has(edgeKey)) continue;
        seenCallKey.add(edgeKey);

        callEdges.push({
          id: `ce::${callEdges.length + 1}`,
          from: caller.id,
          to: targetFn.id,
          fromModule: caller.moduleId,
          toModule: targetFn.moduleId,
          args: call.args,
          assignedTo: call.assignedTo,
          returnHint: targetFn.returnType || targetFn.returnExprs[0] || null,
          isAsync: call.isAsync || targetFn.isAsync,
          awaited: call.isAsync,
          isCycle: false,
          line: call.line
        });

        if (caller.moduleId !== targetFn.moduleId) {
          const mKey = `${caller.moduleId}-->${targetFn.moduleId}`;
          if (!modEdgeMap.has(mKey)) {
            modEdgeMap.set(mKey, { id: `me::${mKey}`, from: caller.moduleId, to: targetFn.moduleId, symbols: new Set([targetFn.name]), weight: 1, isCycle: false, callCount: 0 });
          }
          const mEdge = modEdgeMap.get(mKey);
          mEdge.callCount++;
          mEdge.symbols.add(targetFn.name);
        }
      }
    }
  }
  return callEdges;
}

function synthesizeExecutionFlows(functions, callEdges, fnById) {
  const outCallsByFn = new Map();
  for (const e of callEdges) {
    if (!outCallsByFn.has(e.from)) outCallsByFn.set(e.from, []);
    outCallsByFn.get(e.from).push(e);
  }
  for (const list of outCallsByFn.values()) list.sort((a, b) => a.line - b.line);

  const flowRoots = functions
    .filter((f) => (f.isEntryPoint || f.metrics.fanIn === 0) && (outCallsByFn.get(f.id)?.length || 0) > 0)
    .sort((a, b) => {
      const score = (x) => (x.isEntryPoint ? 10 : 0) + (x.kind === 'route' ? 8 : 0) + x.metrics.fanOut;
      return score(b) - score(a);
    })
    .slice(0, 8);

  const flows = [];
  for (const root of flowRoots) {
    const hops = [{
      stepIndex: 0,
      fromFunctionId: null,
      toFunctionId: root.id,
      edgeId: null,
      payload: root.params.length ? `(${root.params.map((p) => p.name).join(', ')})` : '(entry)',
      outputHint: root.returnType || root.returnExprs[0] || 'void',
      isAsync: root.isAsync,
      depth: 0
    }];
    const visited = new Set([root.id]);
    const fnSet = new Set([root.id]);
    const modSet = new Set([root.moduleId]);

    const trace = (fnId, depth) => {
      if (depth >= 6 || hops.length >= 16) return;
      for (const edge of outCallsByFn.get(fnId) || []) {
        if (hops.length >= 16) break;
        const target = fnById.get(edge.to);
        if (!target) continue;
        hops.push({
          stepIndex: hops.length,
          fromFunctionId: fnId,
          toFunctionId: edge.to,
          edgeId: edge.id,
          payload: edge.args.length ? `(${edge.args.join(', ')})` : '()',
          outputHint: edge.assignedTo ? `→ ${edge.assignedTo}${edge.returnHint ? ` : ${edge.returnHint}` : ''}` : edge.returnHint || 'void',
          isAsync: edge.isAsync,
          depth: depth + 1
        });
        fnSet.add(edge.to);
        modSet.add(target.moduleId);
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          trace(edge.to, depth + 1);
        }
      }
    };

    trace(root.id, 0);
    if (hops.length >= 2) {
      flows.push({
        id: `flow::${flows.length + 1}`,
        title: root.kind === 'route' ? root.name : `${root.qualName}()`,
        entryFunctionId: root.id,
        entryModuleId: root.moduleId,
        hops,
        functionIds: [...fnSet],
        moduleIds: [...modSet]
      });
    }
  }
  return flows;
}

function assignLayersAndSummaries(modules, fnsByModule) {
  const layerMeta = {
    entry: { id: 'entry', label: 'Entry & Interface', subtitle: 'Routes, CLI, UI & public entrypoints', color: '#38bdf8', order: 0, moduleIds: [] },
    orchestration: { id: 'orchestration', label: 'Orchestration & Flow', subtitle: 'Pipelines, controllers & coordinators', color: '#818cf8', order: 1, moduleIds: [] },
    domain: { id: 'domain', label: 'Domain & Processing', subtitle: 'Core business logic & transformations', color: '#34d399', order: 2, moduleIds: [] },
    data: { id: 'data', label: 'Data & Infrastructure', subtitle: 'Stores, schemas, adapters & utilities', color: '#fbbf24', order: 3, moduleIds: [] }
  };

  for (const mod of modules) {
    mod.layer = assignArchitecturalLayer(mod, mod.metrics.fanIn, mod.metrics.fanOut);
    layerMeta[mod.layer].moduleIds.push(mod.id);
    const modFns = fnsByModule.get(mod.id) || [];
    const bits = [`${modFns.length} fn${modFns.length === 1 ? '' : 's'}`];
    if (modFns.some((f) => f.isAsync)) bits.push('async');
    if (modFns.some((f) => f.flags.hasIO)) bits.push('I/O');
    if (mod.libraries.length) bits.push(`${mod.libraries.length} lib${mod.libraries.length === 1 ? '' : 's'}`);
    mod.summary = bits.join(' · ');
  }
  return Object.values(layerMeta).sort((a, b) => a.order - b.order);
}

export function buildCodeGraph(rawFiles) {
  const moduleIdSet = new Set(rawFiles.map((f) => f.id));
  const indexed = indexModulesAndFunctions(rawFiles, moduleIdSet);
  const { modules, functions, fnById, fnsByModule, fnsBySimpleName, libraryMap, brokenImports } = indexed;
  const modById = new Map(modules.map((m) => [m.id, m]));

  const modEdgeMap = buildModuleEdgeMap(modules);
  const callEdges = buildCallEdges(modules, fnsByModule, fnsBySimpleName, modEdgeMap);
  const moduleEdges = [...modEdgeMap.values()].map((e) => ({ ...e, symbols: [...e.symbols].slice(0, 10) }));

  for (const e of moduleEdges) {
    if (modById.has(e.from)) modById.get(e.from).metrics.fanOut++;
    if (modById.has(e.to)) modById.get(e.to).metrics.fanIn++;
  }
  for (const e of callEdges) {
    if (fnById.has(e.from)) fnById.get(e.from).metrics.fanOut++;
    if (fnById.has(e.to)) fnById.get(e.to).metrics.fanIn++;
  }

  const modCycles = findCycleEdges(modules.map((m) => m.id), moduleEdges);
  for (const e of moduleEdges) if (modCycles.cycleEdgeIds.has(e.id)) e.isCycle = true;

  const fnCycles = findCycleEdges(functions.map((f) => f.id), callEdges);
  for (const e of callEdges) if (fnCycles.cycleEdgeIds.has(e.id)) e.isCycle = true;

  const layers = assignLayersAndSummaries(modules, fnsByModule);
  const flows = synthesizeExecutionFlows(functions, callEdges, fnById);
  const libraries = [...libraryMap.values()]
    .map((l) => ({ ...l, moduleIds: [...l.moduleIds], importedSymbols: [...l.importedSymbols].slice(0, 12) }))
    .sort((a, b) => b.moduleIds.length - a.moduleIds.length || a.name.localeCompare(b.name));

  return {
    layers, modules, functions, libraries, moduleEdges, callEdges, flows, brokenImports,
    modCycles: modCycles.cycleGroups,
    fnCycles: fnCycles.cycleGroups
  };
}
