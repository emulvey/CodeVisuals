import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../ui');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * Bundle GlassboxIR JSON + HTML/CSS/JS into a single self-contained offline browser guide.
 */
export function buildStandaloneHtml(ir) {
  const template = fs.readFileSync(path.join(UI_DIR, 'template.html'), 'utf8');
  const css = fs.readFileSync(path.join(UI_DIR, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(UI_DIR, 'app.js'), 'utf8');

  // Safely escape HTML/JS-breaking sequences inside embedded JSON
  const safeJson = JSON.stringify(ir)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const replacements = {
    __PROJECT_NAME__: escapeHtml(ir.meta.projectName),
    __GLASSBOX_CSS__: css,
    __GLASSBOX_DATA_JSON__: safeJson,
    __GLASSBOX_JS__: js
  };

  // Single-pass token replacement so source code containing placeholder strings never collides
  return template.replace(
    /__(?:PROJECT_NAME|GLASSBOX_CSS|GLASSBOX_DATA_JSON|GLASSBOX_JS)__/g,
    (token) => replacements[token]
  );
}
