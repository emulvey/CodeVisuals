/**
 * Generic structural parser for Go, Rust, Java, C/C++, C#, Ruby, PHP.
 */

const FN_PATTERNS = {
  go: /^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(([^)]*)\)\s*([^{]*)\{/,
  rust: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?\{/,
  java: /^(?:public|private|protected)?\s*(?:static\s+)?(?:[\w<>\[\]]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[^{]+)?\{/,
  default: /^(?:export\s+)?(?:public\s+|private\s+|static\s+|async\s+|def\s+|func\s+|fn\s+)*(\w+)\s*\(([^)]*)\)\s*\{/
};

function extractGenericImports(lines, language) {
  const imports = [];
  lines.forEach((line, idx) => {
    const ln = idx + 1;
    const trimmed = line.trim();
    if (language === 'go') {
      const m = trimmed.match(/^(?:import\s+)?(?:(\w+)\s+)?"([^"]+)"$/);
      if (m) imports.push({ source: m[2], symbols: m[1] ? [{ name: '*', alias: m[1] }] : [], line: ln });
    } else if (language === 'rust') {
      const m = trimmed.match(/^use\s+([a-zA-Z0-9_:]+)(?:::\{([^}]+)\})?/);
      if (m) {
        const syms = m[2] ? m[2].split(',').map((s) => ({ name: s.trim(), alias: s.trim() })) : [];
        imports.push({ source: m[1].replace(/::/g, '/'), symbols: syms, line: ln });
      }
    } else if (language === 'java' || language === 'csharp') {
      const m = trimmed.match(/^(?:import|using)\s+(?:static\s+)?([a-zA-Z0-9_.]+)/);
      if (m) imports.push({ source: m[1], symbols: [], line: ln });
    } else if (language === 'c' || language === 'cpp') {
      const m = trimmed.match(/^#include\s+[<"]([^>"]+)[>"]/);
      if (m) imports.push({ source: m[1], symbols: [], line: ln });
    }
  });
  return imports;
}

function extractGenericBodyCalls(bodyText, startLine) {
  const calls = [];
  const steps = [];
  const callRe = /\b(?:(\w+)\.)?(\w+)\s*\(([^()\n]{0,80})\)/g;
  let cm;
  while ((cm = callRe.exec(bodyText)) !== null) {
    const calleeName = cm[2];
    if (['if', 'for', 'while', 'switch', 'return', 'func', 'fn', 'catch'].includes(calleeName)) continue;
    const args = cm[3].trim() ? cm[3].split(',').map((a) => a.trim().slice(0, 36)) : [];
    calls.push({ calleeName, qualifier: cm[1] || null, args, assignedTo: null, isAsync: false, line: startLine });
    if (steps.length < 12) {
      steps.push({
        kind: 'call', label: `${cm[1] ? cm[1] + '.' : ''}${calleeName}(${args.slice(0, 2).join(', ')})`,
        inputs: args.slice(0, 3), output: null, detail: `${calleeName}(${args.join(', ')})`,
        line: startLine, targetCallee: calleeName, isAsync: false
      });
    }
  }
  return { calls, steps };
}

function findBlockEndLine(lines, startIdx) {
  let depth = 0;
  let endIdx = startIdx;
  for (let j = startIdx; j < lines.length; j++) {
    for (const ch of lines[j]) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    endIdx = j;
    if (depth <= 0) break;
  }
  return endIdx;
}

export function parseGenericFile(filePath, source, language) {
  const lines = source.split('\n');
  const imports = extractGenericImports(lines, language);
  const exports = [];
  const functions = [];
  let entryReason = null;
  const pat = FN_PATTERNS[language] || FN_PATTERNS.default;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const m = trimmed.match(pat);
    if (!m || ['if', 'for', 'while', 'switch', 'catch'].includes(m[1])) continue;

    const fnName = m[1];
    const endIdx = findBlockEndLine(lines, i);
    const bodyText = lines.slice(i + 1, endIdx).join('\n');
    const { calls, steps } = extractGenericBodyCalls(bodyText, i + 2);
    const rawParams = (m[2] || '').trim();
    const params = rawParams
      ? rawParams.split(',').map((p) => {
          const parts = p.trim().split(/[\s:]+/).filter(Boolean);
          return { name: parts[0] || 'arg', type: parts.slice(1).join(' ') || null, defaultValue: null, optional: false };
        })
      : [];

    const exported = language === 'go' ? /^[A-Z]/.test(fnName) : /\b(pub|public|export)\b/.test(trimmed);
    if (exported) exports.push(fnName);
    if (fnName === 'main') entryReason = 'Main Entrypoint';

    functions.push({
      name: fnName, qualName: fnName, className: null, kind: 'function', exported,
      isEntryPoint: fnName === 'main', isAsync: /\basync\b/.test(trimmed),
      startLine: i + 1, endLine: endIdx + 1, lines: Math.max(1, endIdx - i + 1),
      params, returnType: (m[3] || '').trim() || null, returnExprs: [],
      complexity: 1 + (bodyText.match(/\b(if|for|while|case|match)\b/g) || []).length,
      flags: {
        hasAsync: /\b(async|await|go\s+)\b/.test(bodyText),
        hasIO: /\b(http|sql|db|fs|file|net|io|fetch|read|write)\b/i.test(bodyText),
        hasMutation: false,
        hasLoop: /\b(for|while|loop)\b/.test(bodyText),
        hasBranch: /\b(if|switch|match)\b/.test(bodyText),
        hasErrorHandling: /\b(try|catch|err|Result|unwrap)\b/.test(bodyText)
      },
      steps, calls, bodyFingerprint: ''
    });
    i = endIdx;
  }

  return { language, lines: lines.length, imports, exports, functions, entryReason, issues: [], topLevelRefs: [] };
}
