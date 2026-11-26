# Glassbox — Visual Codebase Guide, Semantic Explainer & Dataflow Explorer

**Glassbox** turns any codebase—especially unfamiliar or AI-generated projects—into an interactive, browser-viewable visual architecture, plain-English explainer, and dataflow guide. Grounded in modern HCI and cognitive-science research (semantic zoom, pre-attentive visual encoding, circuit-schematic dataflow, and progressive disclosure), Glassbox helps you see **what the system does in plain English**, **how modules and libraries connect**, **what data flows between blocks and how it is processed**, and **where structural bugs or AI anti-patterns hide**.

## Key Features

- **Offline AST Semantic Explainer & System Story**: Automatically synthesizes a plain-English **System Story** brief, **Plain English** canvas labels, module roles, narrated function storyboards, data transformation ledgers, and wire/flow narrations—100% offline with optional BYO-LLM enrichment via `--ai`.
- **3-Level Semantic Zoom (Zero Hairballs)**: Seamlessly shift between **L1 Atlas** (architectural layers & bundled flows), **L2 Circuit** (file modules, ports & external library bus), and **L3 Dataflow** (function chips with typed inputs/outputs & data-on-the-wire payloads).
- **Playable Signal Tracer ("Follow the Data")**: Click any entry point or function to spotlight its end-to-end execution path and step hop-by-hop (`◀ Prev | ▶ Play | Next ▶`) watching exact arguments transform from input to output with plain-English hop narration.
- **Visual Function Pipeline & Expandable Source X-Ray**: Inspect any function to read its **Explain** storyboard, **Visual Flow** schematic (**Inputs → Guards → Transforms → Calls → Branches → Loops → Outputs**), and full syntax-highlighted **Source X-Ray**.
- **External Library Bus**: Every third-party/stdlib dependency sits in a dedicated perimeter dock—click any library to illuminate every module and function wired to it.
- **Scrollable & Expandable Bug Radar & AI-Code Audit Lens**: Toggle the Risk Lens to visually spot circular dependencies (animated red feedback arcs), silent `catch`/`except` blocks, unhandled async calls, orphan/dead code, arity mismatches, duplicated copy-paste logic, god functions, hardcoded secrets, broken imports, and dangerous sinks—with severity/category filters, scrolling, and an Expand mode for large audits.
- **Guided 60-Second Codebase Tour**: Auto-generated interactive walkthrough of entry points, core hubs, library boundaries, and top risk hotspots.
- **Zero Dependencies & Self-Contained Output**: Generates a single offline-ready `.html` file you can open in any browser, share in a PR, or embed in a future IDE Webview plugin.
- **Multi-Language Support**: Deep AST/structural parsing for **TypeScript, JavaScript, JSX/TSX, Python** (via Python's native `ast`), plus structural fallback for Go, Rust, Java, and C-family languages.

## Quick Start

```bash
# Generate an interactive HTML guide for any repository or folder
node bin/glassbox.mjs /path/to/your/codebase -o guide.html

# Generate and immediately serve locally in your browser
node bin/glassbox.mjs /path/to/your/codebase --serve --port 4173

# Optionally refine explanations with an OpenAI-compatible or local LLM endpoint
GLASSBOX_LLM_URL=http://localhost:11434/v1/chat/completions node bin/glassbox.mjs /path/to/your/codebase --ai

# Try the included AI-generated demo codebase (TypeScript + Python)
npm run demo

# Analyze Glassbox itself!
npm run self

# Run automated tests
npm test
```

## Keyboard Shortcuts Inside the Guide

| Key | Action |
|---|---|
| `1` / `2` / `3` | Switch Semantic Zoom: Atlas / Circuit / Dataflow |
| `S` | Open / close Plain-English System Story brief |
| `E` | Toggle Plain-English labels on canvas chips |
| `/` or `Cmd/Ctrl + K` | Instant search across modules, functions, libraries & diagnostics |
| `R` | Toggle Bug Radar (Risk Lens) |
| `T` | Start Guided Codebase Tour |
| `Space` | Play / Pause Signal Tracer when a flow is active |
| `←` / `→` | Step Backward / Forward along an active Signal Trace |
| `F` | Fit entire circuit to viewport |
| `Esc` | Clear focus / close active panel, trace, or search |

## Architecture & HCI Design

See [docs/HCI_DESIGN_RATIONALE.md](docs/HCI_DESIGN_RATIONALE.md) for the research synthesis behind Glassbox's visual language and the path to an IDE Webview plugin.
