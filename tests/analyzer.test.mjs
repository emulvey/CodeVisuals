import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCodebase } from '../src/analyzer/index.mjs';
import { buildStandaloneHtml } from '../src/generator/build_html.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.resolve(__dirname, '../examples/pulsepay-ai-demo');

test('analyzes polyglot TS + Python demo codebase with dataflow edges and payload args', () => {
  const ir = analyzeCodebase(DEMO_DIR, { name: 'PulsePay AI Demo' });

  assert.equal(ir.meta.projectName, 'PulsePay AI Demo');
  assert.ok(ir.modules.length >= 10, `Expected >=10 modules, got ${ir.modules.length}`);
  assert.ok(ir.functions.length >= 15, `Expected >=15 functions, got ${ir.functions.length}`);
  assert.ok(ir.libraries.some((l) => l.name === 'express'), 'Should detect express external library');
  assert.ok(ir.libraries.some((l) => l.name === 'stripe'), 'Should detect stripe external library');
  assert.ok(ir.libraries.some((l) => l.name === 'fastapi'), 'Should detect fastapi Python library');

  // Verify cross-file function call edge carries exact argument payloads
  const checkoutToPricing = ir.callEdges.find(
    (e) => e.from.includes('runCheckoutPipeline') && e.to.includes('calculateTotals')
  );
  assert.ok(checkoutToPricing, 'Should link runCheckoutPipeline -> calculateTotals');
  assert.ok(checkoutToPricing.args.length === 2, 'Should capture 2 passed arguments');

  // Verify Python AST cross-file call link
  const pyCall = ir.callEdges.find(
    (e) => e.from.includes('score_transaction') && e.to.includes('extract_velocity_features')
  );
  assert.ok(pyCall, 'Should link Python score_transaction -> extract_velocity_features');

  // Verify internal function processing steps are extracted
  const pipelineFn = ir.functions.find((f) => f.name === 'runCheckoutPipeline');
  assert.ok(pipelineFn.steps.length >= 5, 'Should extract ordered internal processing steps');

  // Verify playable end-to-end flows are generated
  assert.ok(ir.flows.length >= 2, `Expected >=2 playable flows, got ${ir.flows.length}`);
  assert.ok(ir.flows[0].hops.length >= 3, 'Primary flow should span multiple hops');
});

test('Bug Radar detects signature AI-generated code bugs and structural issues', () => {
  const ir = analyzeCodebase(DEMO_DIR);
  const codes = new Set(ir.diagnostics.map((d) => d.code));

  assert.ok(codes.has('SILENT_CATCH'), 'Should detect empty catch / except: pass');
  assert.ok(codes.has('CIRCULAR_DEP'), 'Should detect pricingService <-> paymentService cycle');
  assert.ok(codes.has('ARITY_MISMATCH'), 'Should detect missing currency arg in chargePaymentGateway');
  assert.ok(codes.has('UNHANDLED_ASYNC'), 'Should detect unawaited sendReceiptEmail');
  assert.ok(codes.has('DANGEROUS_SINK'), 'Should detect interpolated SQL query');
  assert.ok(codes.has('HARDCODED_SECRET'), 'Should detect hardcoded Stripe key');
  assert.ok(codes.has('DUPLICATE_LOGIC'), 'Should detect duplicated discount function');
  assert.ok(codes.has('MUTABLE_DEFAULT'), 'Should detect Python mutable default arg');
  assert.ok(codes.has('ORPHAN_CODE'), 'Should detect orphan legacyV1PromoConverter');
});

test('generates valid self-contained browser HTML guide (including self-analysis)', () => {
  const ir = analyzeCodebase(DEMO_DIR);
  const html = buildStandaloneHtml(ir);

  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('window.__GLASSBOX_DATA__'));
  assert.ok(html.includes('PulsePay') || html.includes('pulsepay-ai-demo'));
  assert.ok(!html.includes('__GLASSBOX_CSS__'));
  assert.ok(!html.includes('__GLASSBOX_JS__'));

  // Self-hosting regression test: analyzing Glassbox's own src/ (which contains placeholder tokens & <script> strings)
  const selfIr = analyzeCodebase(path.resolve(__dirname, '../src'), { name: 'Glassbox Self' });
  const selfHtml = buildStandaloneHtml(selfIr);
  const scripts = [...selfHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 2, 'Should have exactly 2 script blocks');
  assert.doesNotThrow(() => new Function(scripts[0]), 'Embedded GlassboxIR data script must be valid JS');
  assert.doesNotThrow(() => new Function(scripts[1]), 'Embedded app.js script must be valid JS');
  assert.ok(scripts[1].includes('initHud'), 'Embedded app.js must contain full application code');
});
