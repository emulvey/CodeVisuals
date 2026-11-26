#!/usr/bin/env python3
"""
Glassbox Python AST Analyzer
Parses a batch of Python files using Python's native `ast` module and emits
structured Glassbox file analysis JSON to stdout.
"""
import ast
import hashlib
import json
import re
import sys

IO_PATTERN = re.compile(
    r"\b(open|read|write|requests|httpx|urllib|fetch|get|post|put|delete|execute|executemany|query|commit|cursor|connect|Session|subprocess|Popen|run|system|send_mail|publish|emit)\b",
    re.I,
)
MUTATION_METHODS = {"append", "extend", "insert", "pop", "remove", "clear", "update", "setdefault", "add", "discard", "sort", "reverse"}
BUILTIN_IGNORE = {
    "print", "len", "str", "int", "float", "bool", "list", "dict", "set", "tuple",
    "range", "enumerate", "zip", "min", "max", "sum", "abs", "round", "sorted",
    "reversed", "any", "all", "isinstance", "issubclass", "type", "hasattr", "getattr",
    "setattr", "super", "ValueError", "TypeError", "KeyError", "RuntimeError", "Exception",
}


def unparse_safe(node, limit=48):
    if node is None:
        return ""
    try:
        return re.sub(r"\s+", " ", ast.unparse(node).replace("\n", " ")).strip()[:limit]
    except Exception:
        return ""


def extract_names(node, limit=5):
    names, seen = [], set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load):
            if sub.id not in seen and sub.id not in ("True", "False", "None", "self", "cls"):
                seen.add(sub.id)
                names.append(sub.id)
                if len(names) >= limit:
                    break
    return names


def body_fingerprint(fn_node):
    tokens = []
    for node in ast.walk(fn_node):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.arguments, ast.arg)):
            continue
        if isinstance(node, ast.Name):
            tokens.append("ID")
        elif isinstance(node, ast.Constant):
            tokens.append("STR" if isinstance(node.value, str) else "NUM")
        else:
            tokens.append(type(node).__name__)
    raw = "|".join(tokens)
    if len(raw) < 60:
        return ""
    return f"{len(raw)}:{hashlib.md5(raw.encode('utf-8')).hexdigest()[:10]}"


def extract_params(fn_node, qual_name, issues):
    params = []
    args = fn_node.args
    all_args = list(args.posonlyargs) + list(args.args)
    defaults = [None] * (len(all_args) - len(args.defaults)) + list(args.defaults)
    for arg, default in zip(all_args, defaults):
        if arg.arg in ("self", "cls"):
            continue
        default_str = unparse_safe(default, 32) if default is not None else None
        if isinstance(default, (ast.List, ast.Dict, ast.Set)):
            issues.append({
                "code": "MUTABLE_DEFAULT", "severity": "warning", "category": "ai-antipattern",
                "title": f"Mutable Default Argument (`{arg.arg}={default_str}`)",
                "message": f'"{qual_name}" uses a mutable default argument (`{default_str}`), which is shared across all calls in Python.',
                "suggestion": f"Default `{arg.arg}` to `None` and initialize inside the function body.",
                "line": arg.lineno, "functionName": qual_name,
            })
        params.append({"name": arg.arg, "type": unparse_safe(arg.annotation, 40) or None, "defaultValue": default_str, "optional": default is not None})
    if args.vararg:
        params.append({"name": f"*{args.vararg.arg}", "type": unparse_safe(args.vararg.annotation, 40) or None, "defaultValue": None, "optional": True})
    if args.kwarg:
        params.append({"name": f"**{args.kwarg.arg}", "type": unparse_safe(args.kwarg.annotation, 40) or None, "defaultValue": None, "optional": True})
    return params


def check_secret_assign(target_txt, val_node, line, qual_name, issues):
    if not val_node or not re.search(r"(api_?key|secret|token|password|passwd|private_?key)", target_txt, re.I):
        return
    if isinstance(val_node, ast.Constant) and isinstance(val_node.value, str) and len(val_node.value) >= 8:
        if not re.match(r"^(your_|changeme|example|test|dummy|mock)", val_node.value, re.I):
            issues.append({
                "code": "HARDCODED_SECRET", "severity": "critical", "category": "security",
                "title": "Potential Hardcoded Secret",
                "message": f'Variable "{target_txt}" assigns a literal credential string.',
                "suggestion": "Read secrets from `os.environ` or a secret manager.",
                "line": line, "functionName": qual_name,
            })


def inspect_call_node(call_node, ctx, assigned_to=None, awaited=False):
    callee_name, qualifier = None, None
    if isinstance(call_node.func, ast.Name):
        callee_name = call_node.func.id
    elif isinstance(call_node.func, ast.Attribute):
        callee_name = call_node.func.attr
        qualifier = unparse_safe(call_node.func.value, 28)
    if not callee_name:
        return

    full_target = f"{qualifier}.{callee_name}" if qualifier else callee_name
    arg_texts = [unparse_safe(a, 40) for a in call_node.args] + [
        f"{kw.arg}={unparse_safe(kw.value, 32)}" for kw in call_node.keywords if kw.arg
    ]

    if callee_name in ("eval", "exec"):
        ctx["issues"].append({
            "code": "DANGEROUS_SINK", "severity": "critical", "category": "security",
            "title": f"Dynamic Code Execution (`{callee_name}`)",
            "message": f'"{ctx["qual_name"]}" calls `{callee_name}()`, risking arbitrary code execution.',
            "suggestion": "Use safe parsers (`ast.literal_eval`, `json.loads`) or explicit dispatch.",
            "line": call_node.lineno, "functionName": ctx["qual_name"],
        })
    if callee_name in ("execute", "executemany", "raw", "run", "Popen", "system"):
        has_fstr = any(isinstance(a, ast.JoinedStr) for a in call_node.args)
        has_shell = any(kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True for kw in call_node.keywords)
        if has_fstr or has_shell:
            ctx["issues"].append({
                "code": "DANGEROUS_SINK", "severity": "critical", "category": "security",
                "title": f"Unsafe Query / Shell Call (`{full_target}`)",
                "message": f'"{ctx["qual_name"]}" passes an f-string or `shell=True` into `{full_target}()`, risking SQL/command injection.',
                "suggestion": "Pass parameterized placeholders or argument lists with `shell=False`.",
                "line": call_node.lineno, "functionName": ctx["qual_name"],
            })

    if callee_name in MUTATION_METHODS:
        ctx["flags"]["hasMutation"] = True
    is_io = bool(IO_PATTERN.search(full_target))
    if is_io:
        ctx["flags"]["hasIO"] = True

    if (qualifier or callee_name) not in BUILTIN_IGNORE:
        ctx["calls"].append({"calleeName": callee_name, "qualifier": qualifier, "args": arg_texts, "assignedTo": assigned_to, "isAsync": awaited, "line": call_node.lineno})
        if len(ctx["steps"]) < 18:
            short_args = ", ".join(arg_texts[:2]) + (", …" if len(arg_texts) > 2 else "")
            ctx["steps"].append({
                "kind": "io" if is_io else "call",
                "label": f"{full_target}({short_args})",
                "inputs": arg_texts[:4], "output": assigned_to,
                "detail": f"{assigned_to} ← {full_target}({', '.join(arg_texts)})" if assigned_to else f"{full_target}({', '.join(arg_texts)})",
                "line": call_node.lineno, "targetCallee": callee_name, "isAsync": awaited,
            })


def push_py_step(ctx, step):
    if len(ctx["steps"]) < 18:
        ctx["steps"].append(step)


def handle_py_try(stmt, ctx):
    ctx["flags"]["hasErrorHandling"] = True
    walk_py_statements(stmt.body, ctx)
    for handler in stmt.handlers:
        ctx["complexity"] += 1
        if len(handler.body) == 1 and isinstance(handler.body[0], (ast.Pass, ast.Continue)):
            ctx["issues"].append({
                "code": "SILENT_CATCH", "severity": "critical", "category": "ai-antipattern",
                "title": "Silent `except: pass` Block",
                "message": f'"{ctx["qual_name"]}" swallows exceptions with `except: pass`—hiding runtime faults.',
                "suggestion": "Log/handle the specific exception type or propagate a domain error.",
                "line": handler.lineno, "functionName": ctx["qual_name"],
            })
        else:
            push_py_step(ctx, {"kind": "error", "label": f"Except {unparse_safe(handler.type, 32) or 'Exception'}", "inputs": [], "output": handler.name, "detail": unparse_safe(handler.body[0], 56) if handler.body else "", "line": handler.lineno, "targetCallee": None, "isAsync": False})
            walk_py_statements(handler.body, ctx)
    walk_py_statements(stmt.finalbody, ctx)


def handle_py_assign(stmt, ctx):
    target_node = stmt.targets[0] if isinstance(stmt, ast.Assign) else stmt.target
    target_txt = unparse_safe(target_node, 32)
    if isinstance(target_node, (ast.Attribute, ast.Subscript)):
        ctx["flags"]["hasMutation"] = True
    if stmt.value is None:
        return
    check_secret_assign(target_txt, stmt.value, stmt.lineno, ctx["qual_name"], ctx["issues"])
    awaited = isinstance(stmt.value, ast.Await)
    inner = stmt.value.value if awaited else stmt.value
    if awaited:
        ctx["flags"]["hasAsync"] = True
    if isinstance(inner, ast.Call):
        inspect_call_node(inner, ctx, assigned_to=target_txt, awaited=awaited)
        return
    ins = extract_names(stmt.value)
    if ins:
        push_py_step(ctx, {"kind": "transform", "label": f"Compute {target_txt}", "inputs": ins, "output": target_txt, "detail": f"{target_txt} = {unparse_safe(stmt.value, 52)}", "line": stmt.lineno, "targetCallee": None, "isAsync": awaited})
    for sub in ast.walk(inner):
        if isinstance(sub, ast.Call):
            inspect_call_node(sub, ctx, assigned_to=target_txt, awaited=awaited)


def walk_py_statements(stmts, ctx):
    for stmt in stmts:
        if isinstance(stmt, ast.If):
            ctx["complexity"] += 1
            ctx["flags"]["hasBranch"] = True
            cond_txt = unparse_safe(stmt.test, 50)
            is_guard = len(stmt.body) <= 2 and any(isinstance(s, (ast.Return, ast.Raise)) for s in stmt.body)
            push_py_step(ctx, {"kind": "guard" if is_guard else "branch", "label": f"{'Guard' if is_guard else 'If'}: {cond_txt}", "inputs": extract_names(stmt.test), "output": None, "detail": cond_txt, "line": stmt.lineno, "targetCallee": None, "isAsync": False})
            walk_py_statements(stmt.body, ctx)
            walk_py_statements(stmt.orelse, ctx)
        elif isinstance(stmt, (ast.For, ast.AsyncFor, ast.While)):
            ctx["complexity"] += 1
            ctx["flags"]["hasLoop"] = True
            lbl = f"For {unparse_safe(stmt.target, 20)} in {unparse_safe(stmt.iter, 28)}" if isinstance(stmt, (ast.For, ast.AsyncFor)) else f"While {unparse_safe(stmt.test, 40)}"
            ins = extract_names(stmt.iter if isinstance(stmt, (ast.For, ast.AsyncFor)) else stmt.test)
            push_py_step(ctx, {"kind": "loop", "label": lbl, "inputs": ins, "output": None, "detail": lbl, "line": stmt.lineno, "targetCallee": None, "isAsync": isinstance(stmt, ast.AsyncFor)})
            walk_py_statements(stmt.body, ctx)
        elif isinstance(stmt, ast.Try):
            handle_py_try(stmt, ctx)
        elif isinstance(stmt, (ast.With, ast.AsyncWith)):
            ctx["flags"]["hasIO"] = True
            walk_py_statements(stmt.body, ctx)
        elif isinstance(stmt, (ast.Assign, ast.AnnAssign)):
            handle_py_assign(stmt, ctx)
        elif isinstance(stmt, ast.Expr):
            awaited = isinstance(stmt.value, ast.Await)
            inner = stmt.value.value if awaited else stmt.value
            if awaited:
                ctx["flags"]["hasAsync"] = True
            if isinstance(inner, ast.Call):
                inspect_call_node(inner, ctx, awaited=awaited)
        elif isinstance(stmt, ast.Return):
            ret_txt = unparse_safe(stmt.value, 60) if stmt.value else ""
            if ret_txt:
                ctx["return_exprs"].append(ret_txt)
            if stmt.value:
                awaited = isinstance(stmt.value, ast.Await)
                inner = stmt.value.value if awaited else stmt.value
                if isinstance(inner, ast.Call):
                    inspect_call_node(inner, ctx, assigned_to="return", awaited=awaited)
            push_py_step(ctx, {"kind": "output", "label": f"Return {ret_txt[:40]}" if ret_txt else "Return None", "inputs": extract_names(stmt.value) if stmt.value else [], "output": "return", "detail": ret_txt or "None", "line": stmt.lineno, "targetCallee": None, "isAsync": False})
        elif isinstance(stmt, ast.Raise):
            ctx["flags"]["hasErrorHandling"] = True
            push_py_step(ctx, {"kind": "error", "label": f"Raise {unparse_safe(stmt.exc, 40)}", "inputs": extract_names(stmt.exc) if stmt.exc else [], "output": None, "detail": unparse_safe(stmt, 56), "line": stmt.lineno, "targetCallee": None, "isAsync": False})


def analyze_function(fn_node, class_name=None):
    is_async = isinstance(fn_node, ast.AsyncFunctionDef)
    name = fn_node.name
    qual_name = f"{class_name}.{name}" if class_name else name
    route_label = None
    is_entry = name == "main"
    for dec in fn_node.decorator_list:
        m = re.search(r"\.(get|post|put|patch|delete|route)\(\s*['\"]([^'\"]+)", unparse_safe(dec, 64))
        if m:
            route_label = f"{m.group(1).upper()} {m.group(2)}"
            is_entry = True

    ctx = {
        "qual_name": qual_name, "calls": [], "steps": [], "return_exprs": [], "issues": [], "complexity": 1,
        "flags": {"hasAsync": is_async, "hasIO": False, "hasMutation": False, "hasLoop": False, "hasBranch": False, "hasErrorHandling": False},
    }
    params = extract_params(fn_node, qual_name, ctx["issues"])
    walk_py_statements(fn_node.body, ctx)

    start_line = fn_node.lineno
    end_line = getattr(fn_node, "end_lineno", start_line)
    doc = ast.get_docstring(fn_node)
    doc_clean = re.sub(r"\s+", " ", doc).strip()[:180] if doc else None
    return {
        "name": f"{route_label} ({name})" if route_label else name,
        "qualName": f"{route_label} ({qual_name})" if route_label else qual_name,
        "className": class_name,
        "kind": "route" if route_label else ("method" if class_name else "function"),
        "exported": not name.startswith("_"),
        "isEntryPoint": is_entry,
        "isAsync": is_async or ctx["flags"]["hasAsync"],
        "startLine": start_line, "endLine": end_line, "lines": max(1, end_line - start_line + 1),
        "params": params, "returnType": unparse_safe(fn_node.returns, 48) or None,
        "returnExprs": ctx["return_exprs"][:4], "complexity": ctx["complexity"],
        "flags": ctx["flags"], "steps": ctx["steps"], "calls": ctx["calls"],
        "bodyFingerprint": body_fingerprint(fn_node),
        "docComment": doc_clean,
    }, ctx["issues"]


def parse_python_file(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        source = f.read()
    lines = source.count("\n") + 1
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as e:
        return {"language": "python", "lines": lines, "imports": [], "exports": [], "functions": [], "entryReason": None, "issues": [{"code": "SYNTAX_ERROR", "severity": "critical", "category": "reliability", "title": "Python Syntax Error", "message": f"Parser failed at line {e.lineno}: {e.msg}", "suggestion": "Fix syntax error before execution.", "line": e.lineno or 1, "functionName": None}]}

    imports, exports, functions, issues, top_refs = [], [], [], [], []
    entry_reason = None

    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append({"source": alias.name, "symbols": [{"name": "*", "alias": alias.asname or alias.name.split(".")[0]}], "line": node.lineno})
        elif isinstance(node, ast.ImportFrom):
            mod = f"{'.' * node.level}{node.module or ''}"
            imports.append({"source": mod, "symbols": [{"name": a.name, "alias": a.asname or a.name} for a in node.names], "line": node.lineno})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            fn_data, fn_issues = analyze_function(node)
            functions.append(fn_data)
            issues.extend(fn_issues)
            if fn_data["exported"]:
                exports.append(node.name)
            if fn_data["kind"] == "route":
                entry_reason = "HTTP Route Surface"
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith("_"):
                exports.append(node.name)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    fn_data, fn_issues = analyze_function(item, node.name)
                    functions.append(fn_data)
                    issues.extend(fn_issues)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            target_node = node.targets[0] if isinstance(node, ast.Assign) else node.target
            check_secret_assign(unparse_safe(target_node, 32), node.value, node.lineno, None, issues)
        elif isinstance(node, ast.If) and "__name__" in unparse_safe(node.test, 48) and "__main__" in unparse_safe(node.test, 48):
            entry_reason = entry_reason or "Main Script Entrypoint"
            for sub in ast.walk(node):
                if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
                    top_refs.append(sub.func.id)

    mod_doc = ast.get_docstring(tree)
    mod_doc_clean = re.sub(r"\s+", " ", mod_doc).strip()[:180] if mod_doc else None
    return {"language": "python", "lines": lines, "imports": imports, "exports": exports, "functions": functions, "entryReason": entry_reason, "issues": issues, "topLevelRefs": top_refs, "docComment": mod_doc_clean}


def main():
    files = json.loads(sys.stdin.read())
    sys.stdout.write(json.dumps({p: parse_python_file(p) for p in files}))


if __name__ == "__main__":
    main()
