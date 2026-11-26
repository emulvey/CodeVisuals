import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY_SCRIPT = path.join(__dirname, 'python_ast.py');

/**
 * Batch-parse all Python files in a single Python process for speed & true AST accuracy.
 */
export function parsePythonBatch(absFilePaths) {
  if (!absFilePaths.length) return {};
  const proc = spawnSync('python3', [PY_SCRIPT], {
    input: JSON.stringify(absFilePaths),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  if (proc.error || proc.status !== 0) {
    return {};
  }
  try {
    return JSON.parse(proc.stdout || '{}');
  } catch {
    return {};
  }
}
