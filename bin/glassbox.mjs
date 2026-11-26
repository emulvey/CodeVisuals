#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { analyzeCodebase } from '../src/analyzer/index.mjs';
import { buildStandaloneHtml } from '../src/generator/build_html.mjs';

function printHelp() {
  console.log(`
Glassbox — Visual Codebase Guide & Dataflow Explorer

Usage:
  glassbox <target-dir> [options]

Options:
  -o, --out <file>      Output standalone HTML guide (default: ./glassbox-guide.html)
  --json <file>         Also emit raw GlassboxIR JSON (for IDE plugins / pipelines)
  --name <title>        Override display project name
  --max-files <n>       Maximum files to analyze (default: 250)
  --serve               Start a local HTTP preview server after generating
  --port <n>            Port for --serve (default: 4173)
  -h, --help            Show this help message
`);
}

function parseArgs(argv) {
  const opts = { target: null, out: 'glassbox-guide.html', jsonOut: null, name: null, maxFiles: 250, serve: false, port: 4173 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '-o' || arg === '--out') {
      opts.out = argv[++i];
    } else if (arg === '--json') {
      opts.jsonOut = argv[++i];
    } else if (arg === '--name') {
      opts.name = argv[++i];
    } else if (arg === '--max-files') {
      opts.maxFiles = Number(argv[++i]) || 250;
    } else if (arg === '--serve') {
      opts.serve = true;
    } else if (arg === '--port') {
      opts.port = Number(argv[++i]) || 4173;
    } else if (!arg.startsWith('-') && !opts.target) {
      opts.target = arg;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target) {
  printHelp();
  process.exit(1);
}

const start = Date.now();
const ir = analyzeCodebase(opts.target, { name: opts.name, maxFiles: opts.maxFiles });
const html = buildStandaloneHtml(ir);

const outPath = path.resolve(opts.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

if (opts.jsonOut) {
  const jsonPath = path.resolve(opts.jsonOut);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(ir, null, 2), 'utf8');
}

const elapsed = Date.now() - start;
const s = ir.meta.stats;
console.log(`\n  GLASSBOX  Analyzed "${ir.meta.projectName}" in ${elapsed}ms`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  Files:       ${s.totalFiles} modules (${s.totalLines} lines)`);
console.log(`  Functions:   ${s.totalFunctions} chips · ${s.totalCallEdges} dataflow wires`);
console.log(`  Libraries:   ${s.totalLibraries} external packages`);
console.log(`  Flows:       ${ir.flows.length} playable execution traces`);
console.log(`  Bug Radar:   ${s.criticalCount} critical · ${s.warningCount} warnings · ${s.infoCount} info (Health: ${s.healthScore}/100)`);
console.log(`  Output:      ${outPath}\n`);

if (opts.serve) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(opts.port, '127.0.0.1', () => {
    console.log(`  Live preview running at http://127.0.0.1:${opts.port}  (Press Ctrl+C to stop)\n`);
  });
}
