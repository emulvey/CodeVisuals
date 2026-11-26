import fs from 'node:fs';
import path from 'node:path';
import { parseJsTsFile } from './parsers/js_ts_parser.mjs';
import { parsePythonBatch } from './parsers/python_bridge.mjs';
import { parseGenericFile } from './parsers/generic_parser.mjs';
import { buildCodeGraph } from './graph_builder.mjs';
import { runDiagnostics } from './diagnostics.mjs';
import { enrichWithExplanations } from './explainer.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'env', '.pytest_cache', '.mypy_cache',
  'coverage', 'target', 'vendor', '.idea', '.vscode', '.cache', 'tmp'
]);

const EXT_TO_LANG = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp'
};

const MAX_FILE_BYTES = 512 * 1024; // Skip giant generated/minified bundles

function walkCodeFiles(rootDir, maxFiles = 250) {
  const results = [];

  function walk(dir) {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') && entry.name !== '.env') {
        if (entry.isDirectory()) continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        if (/\.min\.(js|css)$/i.test(entry.name) || /\.d\.ts$/i.test(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const lang = EXT_TO_LANG[ext];
        if (!lang) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_BYTES) continue;
        } catch {
          continue;
        }
        const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
        results.push({ absPath: fullPath, id: rel, language: lang });
      }
    }
  }

  walk(rootDir);
  return results;
}

function buildGuidedTour(graph, diagnostics) {
  const tour = [];

  // Stop 1: High-level System Atlas
  const activeLayers = graph.layers.filter((l) => l.moduleIds.length > 0);
  tour.push({
    id: 'tour::1',
    title: '1. System Atlas (Left-to-Right Signal Flow)',
    caption: `This codebase spans ${graph.modules.length} modules across ${activeLayers.length} architectural layers. Read left-to-right: inputs enter on the left, pass through orchestration & domain chips, and terminate in data stores or external libraries on the right/bottom.`,
    zoomLevel: 1,
    focusType: 'overview',
    targetId: null
  });

  // Stop 2: Primary Playable Execution Flow
  if (graph.flows.length > 0) {
    const primaryFlow = graph.flows[0];
    tour.push({
      id: 'tour::2',
      title: `2. Follow the Signal: ${primaryFlow.title}`,
      caption: `This end-to-end execution path traverses ${primaryFlow.hops.length} hops across ${primaryFlow.moduleIds.length} module(s). Use the bottom Signal Stepper to watch exact data payloads flow from chip to chip.`,
      zoomLevel: 3,
      focusType: 'flow',
      targetId: primaryFlow.id
    });
  }

  // Stop 3: Most Connected Core Hub Module
  const hubMod = [...graph.modules].sort((a, b) => (b.metrics.fanIn + b.metrics.fanOut) - (a.metrics.fanIn + a.metrics.fanOut))[0];
  if (hubMod) {
    tour.push({
      id: 'tour::3',
      title: `3. Architectural Hub: ${hubMod.name}`,
      caption: `"${hubMod.id}" is a central junction (${hubMod.metrics.fanIn} incoming, ${hubMod.metrics.fanOut} outgoing module links, ${hubMod.functionIds.length} functions). Click any function inside to inspect its visual processing schematic.`,
      zoomLevel: 2,
      focusType: 'module',
      targetId: hubMod.id
    });
  }

  // Stop 4: External Library Bus
  if (graph.libraries.length > 0) {
    const topLib = graph.libraries[0];
    tour.push({
      id: 'tour::4',
      title: `4. External Library Boundary: ${topLib.name}`,
      caption: `${graph.libraries.length} external libraries are docked on the Library Bus so they never tangle the core schematic. "${topLib.name}" connects to ${topLib.moduleIds.length} module(s)—click any library chip to spotlight its blast radius.`,
      zoomLevel: 2,
      focusType: 'library',
      targetId: topLib.id
    });
  }

  // Stop 5: Bug Radar / Risk Hotspot
  if (diagnostics.length > 0) {
    const topDiag = diagnostics[0];
    tour.push({
      id: 'tour::5',
      title: `5. Bug Radar Hotspot: ${topDiag.title}`,
      caption: `${diagnostics.length} diagnostic finding(s) detected. Top priority in "${topDiag.moduleId}": ${topDiag.message}`,
      zoomLevel: topDiag.functionId ? 3 : 2,
      focusType: 'risk',
      targetId: topDiag.functionId || topDiag.moduleId
    });
  }

  return tour;
}

/**
 * Analyze a codebase directory and return a complete GlassboxIR v1 object.
 */
export function analyzeCodebase(targetPath, options = {}) {
  const absRoot = path.resolve(targetPath);
  if (!fs.existsSync(absRoot)) {
    throw new Error(`Target path does not exist: ${absRoot}`);
  }
  const projectName = options.name || path.basename(absRoot);
  const files = walkCodeFiles(absRoot, options.maxFiles || 250);

  // Batch parse Python files in one subprocess call
  const pyFiles = files.filter((f) => f.language === 'python');
  const pyResults = parsePythonBatch(pyFiles.map((f) => f.absPath));

  const rawFiles = [];
  const languageCounts = {};

  for (const f of files) {
    const source = fs.readFileSync(f.absPath, 'utf8');
    let parsed;
    if (f.language === 'python') {
      parsed = pyResults[f.absPath] || parseGenericFile(f.id, source, 'python');
    } else if (['javascript', 'typescript', 'jsx', 'tsx'].includes(f.language)) {
      parsed = parseJsTsFile(f.id, source, f.language);
    } else {
      parsed = parseGenericFile(f.id, source, f.language);
    }
    const normalizedLang = f.language === 'tsx' ? 'typescript' : f.language === 'jsx' ? 'javascript' : f.language;
    languageCounts[normalizedLang] = (languageCounts[normalizedLang] || 0) + 1;

    rawFiles.push({
      id: f.id,
      absPath: f.absPath,
      language: normalizedLang,
      source,
      parsed
    });
  }

  const graph = buildCodeGraph(rawFiles);
  const { diagnostics, summary } = runDiagnostics(rawFiles, graph);
  const tour = buildGuidedTour(graph, diagnostics);

  const totalLines = graph.modules.reduce((s, m) => s + m.lines, 0);

  const ir = {
    meta: {
      version: '2.0.0',
      projectName,
      rootPath: absRoot,
      generatedAt: new Date().toISOString(),
      languages: languageCounts,
      stats: {
        totalFiles: graph.modules.length,
        totalFunctions: graph.functions.length,
        totalLines,
        totalLibraries: graph.libraries.length,
        totalEdges: graph.moduleEdges.length,
        totalCallEdges: graph.callEdges.length,
        totalDiagnostics: diagnostics.length,
        criticalCount: summary.criticalCount,
        warningCount: summary.warningCount,
        infoCount: summary.infoCount,
        healthScore: summary.healthScore
      }
    },
    layers: graph.layers,
    modules: graph.modules,
    functions: graph.functions,
    libraries: graph.libraries,
    moduleEdges: graph.moduleEdges,
    callEdges: graph.callEdges,
    flows: graph.flows,
    diagnostics,
    tour
  };

  return enrichWithExplanations(ir);
}
