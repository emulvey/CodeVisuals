/**
 * Glassbox JS/TS/JSX/TSX Tokenizer & Structural Dataflow Parser
 * Zero-dependency lexical scanner + modular structural analyzer.
 */

const IO_PATTERNS = /\b(fetch|axios|http|https|got|request|query|execute|prisma|mongoose|sequelize|knex|sql|db|redis|mongo|s3|readFile|writeFile|readdir|mkdir|unlink|open|createReadStream|createWriteStream|spawn|exec|execSync|sendMail|publish|emit)\b/i;
const MUTATION_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'set', 'delete', 'clear', 'add', 'assign']);
const CONTROL_KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'catch', 'try', 'finally', 'return', 'throw', 'await', 'new', 'typeof', 'void', 'delete', 'yield', 'case', 'default', 'in', 'of', 'instanceof']);
const BUILTIN_IGNORE_CALLS = new Set(['console', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'JSON', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'require', 'super']);
const REGEX_PRE_PUNCT = new Set(['(', '[', '{', ',', ';', ':', '=', '!', '?', '&', '|', '^', '~', '+', '-', '*', '%', '<', '>', '=>', '&&', '||', '??', '==', '!=', '===', '!==', '<=', '>=']);
const REGEX_PRE_KW = new Set(['return', 'case', 'throw', 'in', 'of', 'typeof', 'void', 'delete', 'await', 'yield', 'new', 'else']);
const THREE_CHAR_OPS = new Set(['===', '!==', '...', '??=', '&&=', '||=', '**=']);
const TWO_CHAR_OPS = new Set(['=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '**']);

function readStringToken(source, startIdx, startLine) {
  const quote = source[startIdx];
  let i = startIdx + 1;
  let line = startLine;
  let val = quote;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      val += source[i] + (source[i + 1] || '');
      if (source[i + 1] === '\n') line++;
      i += 2;
      continue;
    }
    if (source[i] === '\n') { line++; break; }
    val += source[i++];
  }
  if (i < source.length && source[i] === quote) val += source[i++];
  return { token: { type: 'string', value: val, raw: val.slice(1, -1), line: startLine }, nextIdx: i, line };
}

function readTemplateToken(source, startIdx, startLine) {
  let i = startIdx + 1;
  let line = startLine;
  let val = '`';
  let hasExpr = false;
  let depth = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      val += c + (source[i + 1] || '');
      if (source[i + 1] === '\n') line++;
      i += 2;
      continue;
    }
    if (c === '$' && source[i + 1] === '{') { hasExpr = true; depth++; val += '${'; i += 2; continue; }
    if (c === '{' && depth > 0) { depth++; val += c; i++; continue; }
    if (c === '}' && depth > 0) { depth--; val += c; i++; continue; }
    if (c === '`' && depth === 0) { val += '`'; i++; break; }
    if (c === '\n') line++;
    val += c;
    i++;
  }
  return { token: { type: 'template', value: val, raw: val.slice(1, -1), hasExpr, line: startLine }, nextIdx: i, line };
}

function tryReadRegexToken(source, startIdx, startLine) {
  let j = startIdx + 1;
  let inClass = false;
  while (j < source.length && source[j] !== '\n') {
    if (source[j] === '\\') { j += 2; continue; }
    if (source[j] === '[') inClass = true;
    else if (source[j] === ']') inClass = false;
    else if (source[j] === '/' && !inClass) {
      j++;
      while (j < source.length && /[a-z]/i.test(source[j])) j++;
      return { token: { type: 'regex', value: source.slice(startIdx, j), line: startLine }, nextIdx: j };
    }
    j++;
  }
  return null;
}

function canPrecedeRegex(tok) {
  if (!tok) return true;
  if (tok.type === 'punct') return REGEX_PRE_PUNCT.has(tok.value);
  if (tok.type === 'ident') return REGEX_PRE_KW.has(tok.value);
  return false;
}

function readPunctOrWord(source, i, line) {
  const ch = source[i];
  const next = source[i + 1];
  if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
    let j = i;
    while (j < source.length && /[0-9a-fA-FxXoObBn._]/.test(source[j])) j++;
    return { token: { type: 'number', value: source.slice(i, j), line }, nextIdx: j };
  }
  if (/[a-zA-Z_$]/.test(ch)) {
    let j = i + 1;
    while (j < source.length && /[a-zA-Z0-9_$]/.test(source[j])) j++;
    return { token: { type: 'ident', value: source.slice(i, j), line }, nextIdx: j };
  }
  const three = source.slice(i, i + 3);
  if (THREE_CHAR_OPS.has(three)) return { token: { type: 'punct', value: three, line }, nextIdx: i + 3 };
  const two = source.slice(i, i + 2);
  if (TWO_CHAR_OPS.has(two)) return { token: { type: 'punct', value: two, line }, nextIdx: i + 2 };
  return { token: { type: 'punct', value: ch, line }, nextIdx: i + 1 };
}

function skipComment(source, i, line) {
  const ch = source[i];
  const next = source[i + 1];
  if ((ch === '/' && next === '/') || (ch === '#' && next === '!' && line === 1)) {
    while (i < source.length && source[i] !== '\n') i++;
    return { nextIdx: i, line };
  }
  if (ch === '/' && next === '*') {
    i += 2;
    while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
      if (source[i] === '\n') line++;
      i++;
    }
    return { nextIdx: i + 2, line };
  }
  return null;
}

export function tokenizeJS(source) {
  const tokens = [];
  let i = 0;
  let line = 1;

  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f') { i++; continue; }

    const cmt = skipComment(source, i, line);
    if (cmt) { i = cmt.nextIdx; line = cmt.line; continue; }

    if (ch === '"' || ch === "'") {
      const res = readStringToken(source, i, line);
      tokens.push(res.token); i = res.nextIdx; line = res.line;
      continue;
    }
    if (ch === '`') {
      const res = readTemplateToken(source, i, line);
      tokens.push(res.token); i = res.nextIdx; line = res.line;
      continue;
    }
    if (ch === '/' && canPrecedeRegex(tokens[tokens.length - 1])) {
      const res = tryReadRegexToken(source, i, line);
      if (res) { tokens.push(res.token); i = res.nextIdx; continue; }
    }

    const res = readPunctOrWord(source, i, line);
    tokens.push(res.token);
    i = res.nextIdx;
  }
  return tokens;
}

function findMatching(tokens, openIdx, openVal, closeVal) {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].value === openVal) depth++;
    else if (tokens[i].value === closeVal && --depth === 0) return i;
  }
  return tokens.length - 1;
}

const SPACED_OPS = new Set([',', ':', '=>', '=', '+', '-', '*', '/', '&&', '||', '??', '===', '!==', '==', '!=', '<', '>', '<=', '>=']);

function sliceToText(tokens, start, end) {
  const parts = [];
  for (let i = start; i <= end && i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > start ? tokens[i - 1] : null;
    if (prev) {
      const bothWord = (prev.type === 'ident' || prev.type === 'number') && (t.type === 'ident' || t.type === 'number');
      if (bothWord || SPACED_OPS.has(prev.value) || SPACED_OPS.has(t.value)) parts.push(' ');
    }
    parts.push(t.value);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function splitTopLevelCommas(tokens, start, end) {
  const segments = [];
  let segStart = start;
  const depth = { '(': 0, '[': 0, '{': 0, '<': 0 };
  const closeToOpen = { ')': '(', ']': '[', '}': '{', '>': '<' };

  for (let i = start; i <= end; i++) {
    const v = tokens[i].value;
    if (v in depth) depth[v]++;
    else if (v in closeToOpen && depth[closeToOpen[v]] > 0) depth[closeToOpen[v]]--;
    else if (v === ',' && !depth['('] && !depth['['] && !depth['{'] && !depth['<']) {
      if (i - 1 >= segStart) segments.push([segStart, i - 1]);
      segStart = i + 1;
    }
  }
  if (end >= segStart) segments.push([segStart, end]);
  return segments;
}

function parseSingleParam(tokens, s, e) {
  let idx = s;
  while (idx <= e && ['public', 'private', 'protected', 'readonly'].includes(tokens[idx].value)) idx++;
  if (idx > e) return null;

  const rest = tokens[idx].value === '...';
  if (rest) idx++;

  let nameEnd = idx;
  let name = '';
  if (tokens[idx]?.value === '{' || tokens[idx]?.value === '[') {
    nameEnd = findMatching(tokens, idx, tokens[idx].value, tokens[idx].value === '{' ? '}' : ']');
    name = sliceToText(tokens, idx, nameEnd);
  } else {
    name = (rest ? '...' : '') + (tokens[idx]?.value || 'arg');
  }

  let optional = false;
  let cur = nameEnd + 1;
  if (cur <= e && tokens[cur].value === '?') { optional = true; cur++; }

  let type = null;
  let defaultValue = null;
  if (cur <= e && tokens[cur].value === ':') {
    const eqIdx = findTopLevelChar(tokens, cur + 1, e, '=');
    type = sliceToText(tokens, cur + 1, eqIdx === -1 ? e : eqIdx - 1).slice(0, 48);
    cur = eqIdx === -1 ? e + 1 : eqIdx;
  }
  if (cur <= e && tokens[cur].value === '=') {
    optional = true;
    defaultValue = sliceToText(tokens, cur + 1, e).slice(0, 32);
  }
  return { name: name.slice(0, 40), type, defaultValue, optional: optional || rest };
}

function findTopLevelChar(tokens, start, end, ch) {
  let p = 0, b = 0, br = 0;
  for (let k = start; k <= end; k++) {
    const v = tokens[k].value;
    if (v === '(') p++; else if (v === ')') p--;
    else if (v === '[') b++; else if (v === ']') b--;
    else if (v === '{') br++; else if (v === '}') br--;
    else if (v === ch && p === 0 && b === 0 && br === 0) return k;
  }
  return -1;
}

function parseParams(tokens, openParen, closeParen) {
  if (closeParen <= openParen + 1) return [];
  return splitTopLevelCommas(tokens, openParen + 1, closeParen - 1)
    .map(([s, e]) => parseSingleParam(tokens, s, e))
    .filter(Boolean);
}

function parseReturnType(tokens, afterParen, bodyStart) {
  if (afterParen >= bodyStart || tokens[afterParen]?.value !== ':') return null;
  let end = bodyStart - 1;
  if (tokens[end]?.value === '=>') end--;
  return end >= afterParen + 1 ? sliceToText(tokens, afterParen + 1, end).slice(0, 48) : null;
}

function extractIdentifiers(tokens, start, end) {
  const skip = new Set(['true', 'false', 'null', 'undefined', 'this', 'const', 'let', 'var', 'async', 'function', 'new']);
  const ids = [];
  const seen = new Set();
  for (let i = start; i <= end && i < tokens.length; i++) {
    const t = tokens[i];
    const prev = i > start ? tokens[i - 1] : null;
    if (t.type !== 'ident' || CONTROL_KEYWORDS.has(t.value) || skip.has(t.value)) continue;
    if (prev && (prev.value === '.' || prev.value === '?.')) continue;
    if (tokens[i + 1]?.value === '(') continue;
    if (!seen.has(t.value)) { seen.add(t.value); ids.push(t.value); }
  }
  return ids.slice(0, 6);
}

function normalizeFingerprint(tokens, start, end) {
  const norm = [];
  for (let i = start; i <= end && i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'ident') norm.push(CONTROL_KEYWORDS.has(t.value) ? t.value : 'ID');
    else if (t.type === 'string' || t.type === 'template') norm.push('STR');
    else if (t.type === 'number') norm.push('NUM');
    else norm.push(t.value);
  }
  const str = norm.join('');
  if (str.length < 48) return '';
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${str.length}:${(h >>> 0).toString(16)}`;
}

function findStatementEnd(tokens, startIdx, bodyEnd, anchorLine) {
  let end = startIdx;
  let p = 0, b = 0, br = 0;
  const stmtStarters = new Set(['const', 'let', 'var', 'if', 'for', 'while', 'return', 'try', 'throw']);
  while (end <= bodyEnd) {
    const v = tokens[end].value;
    if (v === '(') p++; else if (v === ')') p--;
    else if (v === '[') b++; else if (v === ']') b--;
    else if (v === '{') br++;
    else if (v === '}') { if (br === 0) break; br--; }
    else if (v === ';' && p === 0 && b === 0 && br === 0) break;
    else if (p === 0 && b === 0 && br === 0 && tokens[end].line > anchorLine && stmtStarters.has(v)) break;
    end++;
  }
  return end;
}

function checkHardcodedSecret(varName, valTok, line, fnName, issues) {
  if (!/(api_?key|secret|token|password|passwd|private_?key|auth_?secret)/i.test(varName)) return;
  if (!valTok || (valTok.type !== 'string' && valTok.type !== 'template')) return;
  if (!valTok.raw || valTok.raw.length < 8) return;
  if (/^(process\.env|env|your_|changeme|example|test|dummy|mock)/i.test(valTok.raw)) return;
  issues.push({
    code: 'HARDCODED_SECRET',
    severity: 'critical',
    category: 'security',
    title: fnName ? 'Potential Hardcoded Secret / Credential' : 'Hardcoded Secret / Credential at Module Scope',
    message: fnName
      ? `Variable "${varName}" in "${fnName}" appears to contain a hardcoded secret literal.`
      : `Module constant "${varName}" assigns a literal credential string directly in source code.`,
    suggestion: 'Load credentials from environment variables or a secret manager.',
    line,
    functionName: fnName
  });
}

function inspectCatchBlock(tokens, i, fnMeta, pushStep, localIssues) {
  let blockStart = i + 1;
  if (tokens[blockStart]?.value === '(') blockStart = findMatching(tokens, blockStart, '(', ')') + 1;
  if (tokens[blockStart]?.value !== '{') return;
  const blockEnd = findMatching(tokens, blockStart, '{', '}');
  const innerCount = blockEnd - blockStart - 1;
  const innerText = sliceToText(tokens, blockStart + 1, blockEnd - 1);
  const onlyConsole = innerCount > 0 && /^console\.(log|warn|debug)\(/.test(innerText) && !innerText.includes('throw') && !innerText.includes('return');

  if (innerCount === 0 || onlyConsole) {
    localIssues.push({
      code: 'SILENT_CATCH',
      severity: innerCount === 0 ? 'critical' : 'warning',
      category: 'ai-antipattern',
      title: innerCount === 0 ? 'Silent Empty Catch Block' : 'Error Swallowed in Catch Block',
      message: innerCount === 0
        ? `Empty catch block in "${fnMeta.name}" silently discards runtime failures—a classic AI-generated happy-path bug.`
        : `Catch block in "${fnMeta.name}" only logs to console without rethrowing, recovering, or surfacing the failure.`,
      suggestion: 'Handle the error explicitly, return a typed error result, or rethrow with context.',
      line: tokens[i].line
    });
  } else {
    pushStep({ kind: 'error', label: 'Catch & recover error', inputs: [], output: null, detail: innerText.slice(0, 60), line: tokens[i].line, targetCallee: null, isAsync: false });
  }
}

function inspectTemplateCalls(tok, calls) {
  if (!tok.hasExpr || !tok.raw) return;
  const re = /\b(?:([a-zA-Z_$][\w$]*)\.)?([a-zA-Z_$][\w$]*)\s*\(([^()]{0,60})\)/g;
  let m;
  while ((m = re.exec(tok.raw)) !== null) {
    const calleeName = m[2];
    const qualifier = m[1] || null;
    if (CONTROL_KEYWORDS.has(calleeName) || BUILTIN_IGNORE_CALLS.has(qualifier || calleeName)) continue;
    const args = m[3].trim() ? m[3].split(',').map((a) => a.trim().slice(0, 40)).filter(Boolean) : [];
    calls.push({ calleeName, qualifier, args, assignedTo: null, isAsync: false, line: tok.line });
  }
}

function isUnsafeInnerHtmlRhs(tokens, eqIdx, bodyEnd) {
  const rhsEnd = findStatementEnd(tokens, eqIdx + 1, bodyEnd, tokens[eqIdx].line);
  const rhsTok = tokens[eqIdx + 1];
  if (!rhsTok) return false;
  // Empty string or plain static string literal is safe
  if (rhsTok.type === 'string' && rhsEnd === eqIdx + 2) return false;
  if (rhsTok.type === 'template' && !rhsTok.hasExpr && rhsEnd === eqIdx + 2) return false;

  // Inspect raw template content & tokens for escaping/safe builder helpers
  const fullText = tokens.slice(eqIdx + 1, rhsEnd).map((t) => t.value).join(' ');
  if (/\b(escHtml|escapeHtml|sanitize|DOMPurify|renderCodeViewer|buildFunctionPipelineSvg)\b/i.test(fullText)) {
    return false;
  }
  return true;
}

function inspectCallSite(tokens, i, bodyStart, fnMeta, calls, flags, pushStep, localIssues) {
  const tok = tokens[i];
  const prev = i > bodyStart ? tokens[i - 1] : null;
  if (prev && ['function', 'class', 'get', 'set'].includes(prev.value)) return;

  const closeParen = findMatching(tokens, i + 1, '(', ')');
  if (tokens[closeParen + 1]?.value === '{' || (tokens[closeParen + 1]?.value === ':' && tokens[closeParen + 3]?.value === '{')) return;

  const calleeName = tok.value;
  let qualifier = null;
  let callStartIdx = i;
  if (prev && (prev.value === '.' || prev.value === '?.') && tokens[i - 2]?.type === 'ident') {
    qualifier = tokens[i - 2].value;
    callStartIdx = i - 2;
  }

  const isAwaited = callStartIdx > bodyStart && tokens[callStartIdx - 1]?.value === 'await';
  let assignedTo = null;
  const beforeCall = isAwaited ? callStartIdx - 2 : callStartIdx - 1;
  if (beforeCall >= bodyStart && tokens[beforeCall]?.value === '=') {
    let lhsEnd = beforeCall - 1;
    let lhsStart = lhsEnd;
    while (lhsStart > bodyStart && !['const', 'let', 'var', ';', '{', '}'].includes(tokens[lhsStart - 1].value) && tokens[lhsStart - 1].line === tokens[beforeCall].line) {
      lhsStart--;
    }
    const colon = findTopLevelChar(tokens, lhsStart, lhsEnd, ':');
    if (colon !== -1) lhsEnd = colon - 1;
    const lhs = sliceToText(tokens, lhsStart, lhsEnd).replace(/^(const|let|var)\s+/, '').trim();
    if (lhs && lhs.length <= 36) assignedTo = lhs;
  }

  const argSegs = closeParen > i + 2 ? splitTopLevelCommas(tokens, i + 2, closeParen - 1) : [];
  const args = argSegs.map(([s, e]) => sliceToText(tokens, s, e).slice(0, 44)).filter(Boolean);
  const fullTarget = qualifier ? `${qualifier}.${calleeName}` : calleeName;

  if (calleeName === 'eval' || (prev?.value === 'new' && calleeName === 'Function')) {
    localIssues.push({
      code: 'DANGEROUS_SINK', severity: 'critical', category: 'security',
      title: `Dynamic Code Execution (\`${calleeName}\`)`,
      message: `"${fnMeta.name}" invokes \`${calleeName}()\`, exposing the system to arbitrary code injection.`,
      suggestion: 'Replace dynamic evaluation with structured parsing or explicit lookup tables.',
      line: tok.line
    });
  }
  if (/^(query|execute|raw|exec|execSync|spawn)$/i.test(calleeName)) {
    if (tokens.slice(i + 2, closeParen).some((t) => t.type === 'template' && t.hasExpr)) {
      localIssues.push({
        code: 'DANGEROUS_SINK', severity: 'critical', category: 'security',
        title: `Interpolated Query / Command in \`${fullTarget}()\``,
        message: `Template-literal interpolation passed directly into \`${fullTarget}()\` inside "${fnMeta.name}" risks SQL or command injection.`,
        suggestion: 'Use parameterized queries or argument arrays instead of string interpolation.',
        line: tok.line
      });
    }
  }

  const isIO = IO_PATTERNS.test(fullTarget);
  if (isIO) flags.hasIO = true;

  if (!BUILTIN_IGNORE_CALLS.has(qualifier || calleeName)) {
    calls.push({ calleeName, qualifier, args, assignedTo, isAsync: isAwaited, line: tok.line });
    pushStep({
      kind: isIO ? 'io' : 'call',
      label: `${fullTarget}(${args.slice(0, 2).join(', ')}${args.length > 2 ? ', …' : ''})`,
      inputs: args.slice(0, 4),
      output: assignedTo,
      detail: assignedTo ? `${assignedTo} ← ${fullTarget}(${args.join(', ')})` : `${fullTarget}(${args.join(', ')})`,
      line: tok.line,
      targetCallee: calleeName,
      isAsync: isAwaited
    });
  }
}

function inspectVarTransform(tokens, i, bodyEnd, fnMeta, pushStep, localIssues) {
  const eqIdx = findTopLevelChar(tokens, i + 1, Math.min(bodyEnd, i + 25), '=');
  if (eqIdx === -1) return;
  let lhsEnd = eqIdx - 1;
  const colon = findTopLevelChar(tokens, i + 1, lhsEnd, ':');
  if (colon !== -1) lhsEnd = colon - 1;
  const varName = sliceToText(tokens, i + 1, lhsEnd).slice(0, 32);
  const rhsEnd = findStatementEnd(tokens, eqIdx + 1, bodyEnd, tokens[eqIdx].line);
  checkHardcodedSecret(varName, tokens[eqIdx + 1], tokens[i].line, fnMeta.name, localIssues);

  const rhsText = sliceToText(tokens, eqIdx + 1, rhsEnd - 1);
  const inputs = extractIdentifiers(tokens, eqIdx + 1, rhsEnd - 1);
  const isPureCall = tokens[eqIdx + 1]?.value === 'await'
    ? tokens[eqIdx + 3]?.value === '(' || tokens[eqIdx + 5]?.value === '('
    : tokens[eqIdx + 2]?.value === '(' || tokens[eqIdx + 4]?.value === '(';

  if (!isPureCall && rhsText.length > 0 && inputs.length > 0) {
    pushStep({
      kind: 'transform', label: `Compute ${varName}`, inputs, output: varName,
      detail: `${varName} = ${rhsText.slice(0, 56)}`, line: tokens[i].line, targetCallee: null, isAsync: rhsText.includes('await ')
    });
  }
}

function inspectControlKeyword(tokens, i, bodyEnd, fnMeta, ctx) {
  const tok = tokens[i];
  const next = tokens[i + 1];
  if (tok.value === 'if' && next?.value === '(') {
    ctx.complexity++;
    ctx.flags.hasBranch = true;
    const closeCond = findMatching(tokens, i + 1, '(', ')');
    const condText = sliceToText(tokens, i + 2, closeCond - 1).slice(0, 52);
    const isGuard = tokens.slice(closeCond + 1, Math.min(bodyEnd + 1, closeCond + 13)).some((t) => t.value === 'return' || t.value === 'throw');
    ctx.pushStep({ kind: isGuard ? 'guard' : 'branch', label: `${isGuard ? 'Guard' : 'If'}: ${condText}`, inputs: extractIdentifiers(tokens, i + 2, closeCond - 1), output: null, detail: condText, line: tok.line, targetCallee: null, isAsync: false });
  } else if ((tok.value === 'for' || tok.value === 'while') && next?.value === '(') {
    ctx.complexity++;
    ctx.flags.hasLoop = true;
    const closeLoop = findMatching(tokens, i + 1, '(', ')');
    const loopText = sliceToText(tokens, i + 2, closeLoop - 1).slice(0, 48);
    ctx.pushStep({ kind: 'loop', label: `${tok.value === 'for' ? 'Loop' : 'While'}: ${loopText}`, inputs: extractIdentifiers(tokens, i + 2, closeLoop - 1), output: null, detail: loopText, line: tok.line, targetCallee: null, isAsync: false });
  } else if (tok.value === 'case') {
    ctx.complexity++;
    ctx.flags.hasBranch = true;
  } else if (tok.value === 'try') {
    ctx.flags.hasErrorHandling = true;
  } else if (tok.value === 'catch') {
    ctx.complexity++;
    ctx.flags.hasErrorHandling = true;
    inspectCatchBlock(tokens, i, fnMeta, ctx.pushStep, ctx.localIssues);
  } else if (tok.value === 'throw') {
    ctx.flags.hasErrorHandling = true;
    const endStmt = findStatementEnd(tokens, i + 1, bodyEnd, tok.line);
    ctx.pushStep({ kind: 'error', label: `Throw ${sliceToText(tokens, i + 1, endStmt - 1).slice(0, 44)}`, inputs: extractIdentifiers(tokens, i + 1, endStmt - 1), output: null, detail: sliceToText(tokens, i, endStmt - 1).slice(0, 64), line: tok.line, targetCallee: null, isAsync: false });
  } else if (tok.value === 'return') {
    const endStmt = findStatementEnd(tokens, i + 1, bodyEnd, tok.line);
    const retText = sliceToText(tokens, i + 1, endStmt - 1).slice(0, 64);
    if (retText) ctx.returnExprs.push(retText);
    ctx.pushStep({ kind: 'output', label: retText ? `Return ${retText.slice(0, 42)}` : 'Return (void)', inputs: extractIdentifiers(tokens, i + 1, endStmt - 1), output: 'return', detail: retText || 'void', line: tok.line, targetCallee: null, isAsync: false });
  } else if (tok.value === 'await') {
    ctx.flags.hasAsync = true;
  }
}

function inspectMemberMutation(tokens, i, bodyEnd, fnMeta, ctx) {
  const prop = tokens[i + 1]?.value;
  if (!prop) return;
  if (['=', '+=', '-='].includes(tokens[i + 2]?.value)) {
    ctx.flags.hasMutation = true;
    if ((prop === 'innerHTML' || prop === 'outerHTML') && isUnsafeInnerHtmlRhs(tokens, i + 2, bodyEnd)) {
      ctx.localIssues.push({ code: 'DANGEROUS_SINK', severity: 'warning', category: 'security', title: `Unsafe DOM Sink (\`${prop}\`)`, message: `Direct assignment to \`${prop}\` in "${fnMeta.name}" risks Cross-Site Scripting (XSS) if untrusted data enters.`, suggestion: 'Use `textContent`, safe DOM builders, or explicitly escape interpolated values.', line: tokens[i].line });
    }
  }
  if (MUTATION_METHODS.has(prop) && tokens[i + 2]?.value === '(') ctx.flags.hasMutation = true;
}

const FLOW_KEYWORDS = new Set(['if', 'for', 'while', 'case', 'try', 'catch', 'throw', 'return', 'await']);

function analyzeFunctionBody(tokens, bodyStart, bodyEnd, fnMeta) {
  const seenStepKeys = new Set();
  const ctx = {
    calls: [], steps: [], returnExprs: [], localIssues: [], complexity: 1,
    flags: { hasAsync: fnMeta.isAsync, hasIO: false, hasMutation: false, hasLoop: false, hasBranch: false, hasErrorHandling: false },
    pushStep(step) {
      const key = `${step.line}:${step.kind}:${step.label}`;
      if (!seenStepKeys.has(key) && ctx.steps.length < 18) { seenStepKeys.add(key); ctx.steps.push(step); }
    }
  };

  let braceDepth = 0;
  for (let i = bodyStart; i <= bodyEnd; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    const prev = i > bodyStart ? tokens[i - 1] : null;

    if (tok.value === '{') braceDepth++;
    else if (tok.value === '}') braceDepth = Math.max(0, braceDepth - 1);

    if (tok.type === 'template' && tok.hasExpr) { inspectTemplateCalls(tok, ctx.calls); continue; }

    if (tok.type === 'ident') {
      if (FLOW_KEYWORDS.has(tok.value)) inspectControlKeyword(tokens, i, bodyEnd, fnMeta, ctx);
      else if (tok.value === 'any' && prev && (prev.value === ':' || prev.value === 'as')) {
        ctx.localIssues.push({ code: 'ANY_TYPE_LEAK', severity: 'info', category: 'ai-antipattern', title: 'TypeScript `any` Escape Hatch', message: `"${fnMeta.name}" bypasses static type safety using \`any\`, hiding data-contract mismatches.`, suggestion: 'Replace `any` with an explicit interface, generic, or `unknown` with narrowing.', line: tok.line });
      } else if (['const', 'let', 'var'].includes(tok.value) && braceDepth <= 2) {
        inspectVarTransform(tokens, i, bodyEnd, fnMeta, ctx.pushStep, ctx.localIssues);
      } else if (next?.value === '(' && !CONTROL_KEYWORDS.has(tok.value)) {
        inspectCallSite(tokens, i, bodyStart, fnMeta, ctx.calls, ctx.flags, ctx.pushStep, ctx.localIssues);
      }
    } else if (tok.value === '.' && tokens[i + 1]?.type === 'ident') {
      inspectMemberMutation(tokens, i, bodyEnd, fnMeta, ctx);
    }
  }

  return { calls: ctx.calls, steps: ctx.steps, returnExprs: ctx.returnExprs.slice(0, 4), complexity: ctx.complexity, flags: ctx.flags, localIssues: ctx.localIssues, bodyFingerprint: normalizeFingerprint(tokens, bodyStart, bodyEnd) };
}

function parseImportDecl(tokens, i, imports) {
  const startLine = tokens[i].line;
  if (tokens[i + 1]?.type === 'string') {
    imports.push({ source: tokens[i + 1].raw, symbols: [], line: startLine });
    return i + 2;
  }
  let fromIdx = i + 1;
  while (fromIdx < tokens.length && tokens[fromIdx].value !== 'from' && tokens[fromIdx].value !== ';') fromIdx++;
  if (tokens[fromIdx]?.value !== 'from' || tokens[fromIdx + 1]?.type !== 'string') return i + 1;

  const symbols = [];
  let k = i + 1;
  if (tokens[k]?.value === 'type') k++;
  while (k < fromIdx) {
    if (tokens[k].value === '{') {
      const closeB = findMatching(tokens, k, '{', '}');
      for (const [s, e] of splitTopLevelCommas(tokens, k + 1, closeB - 1)) {
        let p = tokens[s]?.value === 'type' ? s + 1 : s;
        const name = tokens[p]?.value;
        const alias = p + 2 <= e && tokens[p + 1]?.value === 'as' ? tokens[p + 2].value : name;
        if (name) symbols.push({ name, alias });
      }
      k = closeB + 1;
    } else if (tokens[k].value === '*' && tokens[k + 1]?.value === 'as' && tokens[k + 2]?.type === 'ident') {
      symbols.push({ name: '*', alias: tokens[k + 2].value });
      k += 3;
    } else if (tokens[k].type === 'ident' && tokens[k].value !== 'from') {
      symbols.push({ name: 'default', alias: tokens[k].value });
      k++;
    } else {
      k++;
    }
  }
  imports.push({ source: tokens[fromIdx + 1].raw, symbols, line: startLine });
  return fromIdx + 2;
}

function parseClassDecl(tokens, i, exports, registerFn) {
  const className = tokens[i + 1].value;
  const exported = tokens[i - 1]?.value === 'export' || tokens[i - 2]?.value === 'export';
  if (exported) exports.add(className);
  let bodyStart = i + 2;
  while (bodyStart < tokens.length && tokens[bodyStart].value !== '{') bodyStart++;
  if (tokens[bodyStart]?.value !== '{') return i + 2;
  const bodyEnd = findMatching(tokens, bodyStart, '{', '}');

  let m = bodyStart + 1;
  while (m < bodyEnd) {
    let isAsync = false;
    const methodLine = tokens[m].line;
    while (m < bodyEnd && ['public', 'private', 'protected', 'static', 'readonly', 'async', 'get', 'set', 'override'].includes(tokens[m].value)) {
      if (tokens[m].value === 'async') isAsync = true;
      m++;
    }
    if (m >= bodyEnd) break;
    if (tokens[m].type === 'ident') {
      const methodName = tokens[m].value;
      let pIdx = m + 1;
      if (tokens[pIdx]?.value === '<') pIdx = findMatching(tokens, pIdx, '<', '>') + 1;
      if (tokens[pIdx]?.value === '(') {
        const closeP = findMatching(tokens, pIdx, '(', ')');
        let mBody = closeP + 1;
        while (mBody < bodyEnd && tokens[mBody].value !== '{' && tokens[mBody].value !== ';') mBody++;
        if (tokens[mBody]?.value === '{') {
          const mBodyEnd = findMatching(tokens, mBody, '{', '}');
          registerFn({
            name: methodName, qualName: `${className}.${methodName}`, className, kind: 'method',
            exported, isEntryPoint: false, isAsync, startLine: methodLine,
            params: parseParams(tokens, pIdx, closeP), returnType: parseReturnType(tokens, closeP + 1, mBody)
          }, mBody, mBodyEnd);
          m = mBodyEnd + 1;
          continue;
        }
      }
    }
    m = tokens[m].value === '{' ? findMatching(tokens, m, '{', '}') + 1 : m + 1;
  }
  return bodyEnd + 1;
}

function parseRouteHandler(tokens, i, registerFn) {
  const closeRoute = findMatching(tokens, i + 1, '(', ')');
  const routeName = `${tokens[i].value.toUpperCase()} ${tokens[i + 2].raw}`;
  for (let r = i + 3; r < closeRoute; r++) {
    if (tokens[r].value === '=>' && tokens[r + 1]?.value === '{') {
      const bStart = r + 1;
      const bEnd = findMatching(tokens, bStart, '{', '}');
      let pClose = r - 1;
      while (pClose > i + 2 && tokens[pClose].value !== ')') pClose--;
      let pOpen = pClose;
      if (tokens[pClose]?.value === ')') {
        let depth = 0;
        for (let k = pClose; k > i + 2; k--) {
          if (tokens[k].value === ')') depth++;
          else if (tokens[k].value === '(' && --depth === 0) { pOpen = k; break; }
        }
      }
      registerFn({
        name: routeName, qualName: routeName, kind: 'route', exported: true, isEntryPoint: true,
        isAsync: tokens[pOpen - 1]?.value === 'async', startLine: tokens[i].line,
        params: pOpen < pClose ? parseParams(tokens, pOpen, pClose) : [], returnType: 'Response'
      }, bStart, bEnd);
      return closeRoute + 1;
    }
  }
  return null;
}

function tryParseFunctionDecl(tokens, i, language, source, exports, registerFn) {
  const tok = tokens[i];
  const isAsync = tokens[i - 1]?.value === 'async';
  const exported = [tokens[i - 1], tokens[i - 2], tokens[i - 3]].some((t) => t?.value === 'export');
  const nameIdx = tokens[i + 1]?.value === '*' ? i + 2 : i + 1;
  const fnName = tokens[nameIdx]?.type === 'ident' ? tokens[nameIdx].value : 'defaultExport';
  let parenIdx = tokens[nameIdx]?.type === 'ident' ? nameIdx + 1 : nameIdx;
  if (tokens[parenIdx]?.value === '<') parenIdx = findMatching(tokens, parenIdx, '<', '>') + 1;
  if (tokens[parenIdx]?.value !== '(') return null;

  const closeParen = findMatching(tokens, parenIdx, '(', ')');
  let bodyStart = closeParen + 1;
  while (bodyStart < tokens.length && tokens[bodyStart].value !== '{' && tokens[bodyStart].value !== ';') bodyStart++;
  if (tokens[bodyStart]?.value !== '{') return null;

  const bodyEnd = findMatching(tokens, bodyStart, '{', '}');
  if (exported) exports.add(fnName);
  const isReact = /^[A-Z]/.test(fnName) && (language === 'jsx' || language === 'tsx' || source.includes('return <'));
  const isMain = ['main', 'handler', 'GET', 'POST', 'PUT', 'DELETE'].includes(fnName);
  registerFn({
    name: fnName, qualName: fnName, kind: isReact ? 'component' : 'function', exported, isEntryPoint: isMain,
    isAsync, startLine: tok.line, params: parseParams(tokens, parenIdx, closeParen), returnType: parseReturnType(tokens, closeParen + 1, bodyStart)
  }, bodyStart, bodyEnd);
  return { nextIdx: bodyEnd + 1, entryReason: isMain ? (fnName === 'main' ? 'Main Entrypoint' : 'API Handler') : null };
}

function tryParseVarFunctionDecl(tokens, i, language, exports, moduleIssues, registerFn) {
  const tok = tokens[i];
  const exported = tokens[i - 1]?.value === 'export';
  const varName = tokens[i + 1].value;
  let eqIdx = i + 2;
  if (tokens[eqIdx]?.value === ':') while (eqIdx < tokens.length && tokens[eqIdx].value !== '=' && tokens[eqIdx].value !== ';') eqIdx++;
  if (tokens[eqIdx]?.value === '=') {
    checkHardcodedSecret(varName, tokens[eqIdx + 1], tok.line, null, moduleIssues);
    let rhs = eqIdx + 1;
    const isAsync = tokens[rhs]?.value === 'async';
    if (isAsync) rhs++;
    if (tokens[rhs]?.value === 'function') { rhs++; if (tokens[rhs]?.type === 'ident') rhs++; }
    if (tokens[rhs]?.value === '<') rhs = findMatching(tokens, rhs, '<', '>') + 1;
    if (tokens[rhs]?.value === '(') {
      const closeP = findMatching(tokens, rhs, '(', ')');
      let arrowIdx = closeP + 1;
      while (arrowIdx < Math.min(tokens.length, closeP + 16) && !['=>', '{', ';'].includes(tokens[arrowIdx].value)) arrowIdx++;
      const bodyStart = tokens[arrowIdx]?.value === '=>' ? arrowIdx + 1 : tokens[arrowIdx]?.value === '{' ? arrowIdx : -1;
      if (bodyStart !== -1 && tokens[bodyStart]?.value === '{') {
        const bodyEnd = findMatching(tokens, bodyStart, '{', '}');
        if (exported) exports.add(varName);
        registerFn({
          name: varName, qualName: varName, kind: /^[A-Z]/.test(varName) && (language === 'jsx' || language === 'tsx') ? 'component' : 'arrow',
          exported, isEntryPoint: varName === 'main' || varName === 'handler', isAsync, startLine: tok.line,
          params: parseParams(tokens, rhs, closeP), returnType: parseReturnType(tokens, closeP + 1, arrowIdx)
        }, bodyStart, bodyEnd);
        return bodyEnd + 1;
      }
    }
  }
  if (exported) exports.add(varName);
  return null;
}

function parseExportBlock(tokens, i, imports, exports) {
  const closeB = findMatching(tokens, i + 1, '{', '}');
  const symList = splitTopLevelCommas(tokens, i + 2, closeB - 1).map(([s]) => {
    const name = tokens[s]?.value;
    const alias = tokens[s + 1]?.value === 'as' ? tokens[s + 2]?.value : name;
    if (alias) exports.add(alias);
    return name ? { name, alias } : null;
  }).filter(Boolean);
  if (tokens[closeB + 1]?.value === 'from' && tokens[closeB + 2]?.type === 'string') {
    imports.push({ source: tokens[closeB + 2].raw, symbols: symList, line: tokens[i].line });
    return closeB + 3;
  }
  return closeB + 1;
}

export function parseJsTsFile(filePath, source, language) {
  const tokens = tokenizeJS(source);
  const imports = [];
  const exports = new Set();
  const functions = [];
  const moduleIssues = [];
  const topLevelRefs = new Set();
  let entryReason = null;

  const registerFn = (fnInfo, bodyStart, bodyEnd) => {
    const analysis = analyzeFunctionBody(tokens, bodyStart, bodyEnd, fnInfo);
    for (const issue of analysis.localIssues) moduleIssues.push({ ...issue, functionName: fnInfo.qualName });
    const endLine = tokens[bodyEnd]?.line || fnInfo.startLine;
    functions.push({
      name: fnInfo.name, qualName: fnInfo.qualName, className: fnInfo.className || null, kind: fnInfo.kind,
      exported: fnInfo.exported, isEntryPoint: fnInfo.isEntryPoint || false, isAsync: fnInfo.isAsync || analysis.flags.hasAsync,
      startLine: fnInfo.startLine, endLine, lines: Math.max(1, endLine - fnInfo.startLine + 1),
      params: fnInfo.params, returnType: fnInfo.returnType, returnExprs: analysis.returnExprs,
      complexity: analysis.complexity, flags: analysis.flags, steps: analysis.steps, calls: analysis.calls,
      bodyFingerprint: analysis.bodyFingerprint
    });
  };

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.type === 'ident' && tok.value === 'import') { i = parseImportDecl(tokens, i, imports); continue; }
    if (tok.type === 'ident' && tok.value === 'require' && tokens[i + 1]?.value === '(' && tokens[i + 2]?.type === 'string') {
      const symbols = i >= 3 && tokens[i - 1]?.value === '=' && tokens[i - 2]?.type === 'ident' ? [{ name: 'default', alias: tokens[i - 2].value }] : [];
      imports.push({ source: tokens[i + 2].raw, symbols, line: tok.line });
      i += 4;
      continue;
    }
    if (tok.type === 'ident' && tok.value === 'export' && tokens[i + 1]?.value === '{') { i = parseExportBlock(tokens, i, imports, exports); continue; }
    if (tok.type === 'ident' && tok.value === 'function') {
      const res = tryParseFunctionDecl(tokens, i, language, source, exports, registerFn);
      if (res) { entryReason = entryReason || res.entryReason; i = res.nextIdx; continue; }
    }
    if (tok.type === 'ident' && tok.value === 'class' && tokens[i + 1]?.type === 'ident') { i = parseClassDecl(tokens, i, exports, registerFn); continue; }
    if (tok.type === 'ident' && ['const', 'let', 'var'].includes(tok.value) && tokens[i + 1]?.type === 'ident') {
      const nextIdx = tryParseVarFunctionDecl(tokens, i, language, exports, moduleIssues, registerFn);
      if (nextIdx !== null) { i = nextIdx; continue; }
    }
    if (tok.type === 'ident' && ['get', 'post', 'put', 'patch', 'delete', 'use'].includes(tok.value) && tokens[i - 1]?.value === '.' && tokens[i + 1]?.value === '(' && tokens[i + 2]?.type === 'string' && tokens[i + 2].raw.startsWith('/')) {
      entryReason = entryReason || 'HTTP Route Surface';
      const nextI = parseRouteHandler(tokens, i, registerFn);
      if (nextI !== null) { i = nextI; continue; }
    }
    if (tok.type === 'ident' && tokens[i + 1]?.value === '(' && !CONTROL_KEYWORDS.has(tok.value)) topLevelRefs.add(tok.value);
    i++;
  }

  if (!entryReason && (source.startsWith('#!') || /\bprocess\.argv\b/.test(source))) entryReason = 'CLI Entrypoint';
  return { language, lines: source.split('\n').length, imports, exports: [...exports], functions, entryReason, issues: moduleIssues, topLevelRefs: [...topLevelRefs] };
}
