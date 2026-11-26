/**
 * Glassbox Bug Radar & AI-Code Anti-Pattern Diagnostics Engine
 * Combines local AST detections with cross-file structural & contract checks:
 * - Circular dependencies (module & function)
 * - Unhandled async function calls (missing await)
 * - Call-site arity mismatches (classic AI refactor break)
 * - Duplicate copy-paste logic across functions
 * - Orphan / unreachable dead code
 * - God functions (high cyclomatic complexity / length)
 * - Broken relative imports
 */

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

function collectLocalAndImportIssues(rawFiles, graph, add) {
  for (const rf of rawFiles) {
    const modFns = graph.functions.filter((f) => f.moduleId === rf.id);
    for (const issue of rf.parsed.issues || []) {
      const fn = issue.functionName
        ? modFns.find((f) => f.qualName === issue.functionName || f.name === issue.functionName)
        : null;
      add({
        code: issue.code,
        severity: issue.severity,
        category: issue.category,
        title: issue.title,
        message: issue.message,
        suggestion: issue.suggestion,
        moduleId: rf.id,
        functionId: fn ? fn.id : null,
        line: issue.line || null
      });
    }
  }

  for (const bi of graph.brokenImports) {
    add({
      code: 'BROKEN_IMPORT',
      severity: 'critical',
      category: 'reliability',
      title: `Unresolved Internal Import (\`${bi.source}\`)`,
      message: `"${bi.moduleId}" imports "${bi.source}" on line ${bi.line}, which does not resolve to any file in the analyzed codebase.`,
      suggestion: 'Verify the relative path, file extension, or whether an AI edit renamed/removed the target file.',
      moduleId: bi.moduleId,
      functionId: null,
      line: bi.line
    });
  }

  for (const group of graph.modCycles) {
    const chain = [...group, group[0]].map((id) => id.split('/').pop()).join(' → ');
    add({
      code: 'CIRCULAR_DEP',
      severity: 'warning',
      category: 'architecture',
      title: `Circular Module Dependency (${group.length} files)`,
      message: `Tight coupling cycle detected: ${chain}. Circular imports cause initialization order bugs and make AI-generated code brittle.`,
      suggestion: 'Extract shared types/interfaces or invert control into a dedicated lower-layer module.',
      moduleId: group[0],
      functionId: null,
      line: 1,
      relatedIds: group
    });
  }
}

function checkCallContracts(graph, modById, fnById, add) {
  for (const edge of graph.callEdges) {
    const caller = fnById.get(edge.from);
    const callee = fnById.get(edge.to);
    if (!caller || !callee) continue;

    if (callee.isAsync && !edge.awaited && !edge.assignedTo && caller.kind !== 'route') {
      add({
        code: 'UNHANDLED_ASYNC',
        severity: 'warning',
        category: 'ai-antipattern',
        title: `Unawaited Async Call to \`${callee.name}()\``,
        message: `"${caller.qualName}" invokes async function "${callee.qualName}" on line ${edge.line} without \`await\` or capturing the Promise—errors may vanish silently.`,
        suggestion: `Await \`${callee.name}()\` or explicitly attach error handling (\`.catch()\`).`,
        moduleId: caller.moduleId,
        functionId: caller.id,
        line: edge.line,
        relatedIds: [callee.id]
      });
    }

    const calleeMod = modById.get(callee.moduleId);
    const hasStrictContract =
      calleeMod?.language === 'python' ||
      calleeMod?.language === 'typescript' ||
      callee.params.some((p) => Boolean(p.type));
    const requiredParams = callee.params.filter((p) => !p.optional && !p.name.startsWith('...') && !p.name.startsWith('*'));
    const hasSpreadArg = edge.args.some((a) => a.startsWith('...') || a.startsWith('*'));

    if (hasStrictContract && !hasSpreadArg && requiredParams.length > 0 && edge.args.length < requiredParams.length) {
      add({
        code: 'ARITY_MISMATCH',
        severity: 'critical',
        category: 'ai-antipattern',
        title: `Parameter Contract Mismatch calling \`${callee.name}()\``,
        message: `"${caller.qualName}" passes ${edge.args.length} argument(s) to "${callee.qualName}" on line ${edge.line}, but ${requiredParams.length} required parameter(s) (${requiredParams.map((p) => p.name).join(', ')}) are declared.`,
        suggestion: 'Pass all required parameters or make trailing parameters optional with explicit defaults.',
        moduleId: caller.moduleId,
        functionId: caller.id,
        line: edge.line,
        relatedIds: [callee.id]
      });
    }
  }
}

function checkComplexityAndDuplicates(graph, add) {
  for (const fn of graph.functions) {
    if (fn.complexity >= 18 || fn.lines >= 120) {
      add({
        code: 'GOD_FUNCTION',
        severity: fn.complexity >= 26 || fn.lines >= 180 ? 'warning' : 'info',
        category: 'architecture',
        title: `High-Complexity Function (\`${fn.qualName}\`)`,
        message: `"${fn.qualName}" spans ${fn.lines} lines with cyclomatic complexity ${fn.complexity}. Overloaded functions dramatically increase review cognitive load.`,
        suggestion: 'Decompose into focused single-responsibility helper chips with explicit input/output contracts.',
        moduleId: fn.moduleId,
        functionId: fn.id,
        line: fn.startLine
      });
    }
  }

  const fpGroups = new Map();
  for (const fn of graph.functions) {
    if (!fn.bodyFingerprint || fn.lines < 6) continue;
    if (!fpGroups.has(fn.bodyFingerprint)) fpGroups.set(fn.bodyFingerprint, []);
    fpGroups.get(fn.bodyFingerprint).push(fn);
  }
  for (const group of fpGroups.values()) {
    if (group.length >= 2) {
      const names = group.map((f) => `${f.moduleId.split('/').pop()}:${f.qualName}`).join(' & ');
      add({
        code: 'DUPLICATE_LOGIC',
        severity: 'warning',
        category: 'ai-antipattern',
        title: `Duplicated Function Logic (${group.length} copies)`,
        message: `Structurally identical implementations detected in ${names}—a frequent AI copy-paste pattern that causes divergent bug fixes.`,
        suggestion: 'Consolidate into one shared domain helper and wire both callers to it.',
        moduleId: group[0].moduleId,
        functionId: group[0].id,
        line: group[0].startLine,
        relatedIds: group.map((f) => f.id)
      });
    }
  }
}

function checkOrphanFunctions(rawFiles, graph, add) {
  const topLevelRefs = new Map();
  for (const rf of rawFiles) {
    topLevelRefs.set(rf.id, new Set(rf.parsed.topLevelRefs || []));
  }

  for (const fn of graph.functions) {
    if (fn.isEntryPoint || fn.exported || fn.kind === 'route' || fn.kind === 'component' || fn.name === 'constructor' || fn.name === '__init__') {
      continue;
    }
    const referencedAtTopLevel = topLevelRefs.get(fn.moduleId)?.has(fn.name);
    if (fn.metrics.fanIn === 0 && !referencedAtTopLevel && fn.lines >= 4) {
      add({
        code: 'ORPHAN_CODE',
        severity: 'info',
        category: 'dead-code',
        title: `Potentially Unreachable / Orphan Function (\`${fn.qualName}\`)`,
        message: `"${fn.qualName}" in "${fn.moduleId}" is unexported and has 0 detected callers. AI iterations frequently leave stale helpers behind.`,
        suggestion: 'Confirm whether it is invoked dynamically; otherwise remove to reduce noise.',
        moduleId: fn.moduleId,
        functionId: fn.id,
        line: fn.startLine
      });
    }
  }
}

export function runDiagnostics(rawFiles, graph) {
  const diagnostics = [];
  const modById = new Map(graph.modules.map((m) => [m.id, m]));
  const fnById = new Map(graph.functions.map((f) => [f.id, f]));

  const add = (d) => {
    diagnostics.push({ id: `diag::${diagnostics.length + 1}`, ...d, relatedIds: d.relatedIds || [] });
  };

  collectLocalAndImportIssues(rawFiles, graph, add);
  checkCallContracts(graph, modById, fnById, add);
  checkComplexityAndDuplicates(graph, add);
  checkOrphanFunctions(rawFiles, graph, add);

  for (const d of diagnostics) {
    const mod = modById.get(d.moduleId);
    if (mod) {
      mod.metrics.diagnosticCount++;
      if (!mod.metrics.maxSeverity || SEVERITY_RANK[d.severity] > SEVERITY_RANK[mod.metrics.maxSeverity]) {
        mod.metrics.maxSeverity = d.severity;
      }
    }
    if (d.functionId) {
      const fn = fnById.get(d.functionId);
      if (fn) {
        fn.metrics.diagnosticCount++;
        if (!fn.metrics.maxSeverity || SEVERITY_RANK[d.severity] > SEVERITY_RANK[fn.metrics.maxSeverity]) {
          fn.metrics.maxSeverity = d.severity;
        }
      }
    }
  }

  diagnostics.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const criticalCount = diagnostics.filter((d) => d.severity === 'critical').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const infoCount = diagnostics.filter((d) => d.severity === 'info').length;

  const scale = Math.max(1, Math.sqrt(graph.modules.length));
  const penalty = (criticalCount * 14 + warningCount * 5 + infoCount * 1.5) / Math.max(1, scale * 0.55);
  const healthScore = Math.max(12, Math.min(100, Math.round(100 - penalty)));

  return { diagnostics, summary: { criticalCount, warningCount, infoCount, healthScore } };
}
