# Glassbox: HCI & Cognitive Science Design Rationale

## 1. The Core Problem: Why Reading Large & AI-Generated Code Fails Human Cognition

Recent HCI and Software Engineering research (CHI, UIST, ICSE 2024–2026) identifies a sharp cognitive inversion: **AI coding assistants generate code orders of magnitude faster than humans can build mental models of it**. Traditional programming forced incremental mental model construction line-by-line; reviewing large or AI-generated codebases drops engineers into an unfamiliar system and forces them to act as *human compilers* (Bret Victor, *Learnable Programming*).

Three structural failures amplify this strain:
1. **Working Memory Bottleneck**: Human working memory reliably holds ~4±1 chunks simultaneously. Text files flatten a multi-dimensional dataflow graph into a 1D scroll of symbols across dozens of tabs.
2. **The Hairball Failure in Visualization**: Naive dependency graphs render all nodes and edges simultaneously. When everything overlaps, pre-attentive visual processing stalls and the viewer is forced into exhausting serial tracing.
3. **Silent AI Defect Patterns**: Empirical studies (2024–2026) show AI-co-authored code introduces 1.4×–1.7× higher defect density, with up to 60% manifesting as *silent failures*—plausible-looking syntax hiding swallowed exceptions, broken cross-file contracts, dead/orphan helper code, duplicated logic, circular imports, or missing input validation at system boundaries.

---

## 2. How Glassbox Translates HCI Research into Visual Architecture

| Cognitive / HCI Principle | Research Grounding | Glassbox UX Implementation |
|---|---|---|
| **Semantic Zoom (Not Just Geometric Zoom)** | Shneiderman's Mantra (*Overview first, zoom & filter, details on demand*); ExplorViz / CodeZoom (2024–2026) | **3 Distinct Semantic Zoom Layers** (*L1 Atlas* → *L2 Circuit* → *L3 Dataflow*) plus *Code X-Ray* drill-down. Zooming changes *abstraction fidelity*, preventing information overload at every scale. |
| **Pre-Attentive Visual Attributes (<200ms)** | Treisman's Feature Integration Theory; Colin Ware (*Information Visualization*) | System 1 instantly reads architectural layer via left-to-right spatial zone & hue, function complexity via compact spark-bars, behavior via micro-glyphs (`⚡` async, `⇄` I/O, `✎` mutation), and risks via high-contrast coral/amber rings. |
| **Spatial Memory Preservation** | Stable mental-map research in dynamic graph drawing | Deterministic **Left-to-Right Layered Circuit Layout** (Inputs → Orchestration → Domain → Data/Infra) with barycenter crossing minimization and a persistent **Spatial Mini-Map**. Nodes never jump randomly on interaction. |
| **Circuit Schematic & Visible Dataflow** | Bret Victor (*Learnable Programming*); OpenHop step-through flows | Modules and functions are rendered as **schematic chips** with explicit left Input Pins and right Output Pins. Wires carry **Data-on-the-Wire pills** showing exact payloads/arguments passed, plus a playable **Signal Stepper** (`◀ ▶`). |
| **Focus + Context & Ego-Network Spotlight** | Progressive disclosure; Degree-of-Interest views | Selecting any node, library, or trace dims unrelated nodes to 12% opacity while animating active signal paths—eliminating visual hairballs while preserving global spatial context. |
| **Dual-Coding (Visuals First, Code On Demand)** | Paivio's Dual-Coding Theory | Inspecting a function opens a **Visual Processing Schematic** (Input Ports → Guards → Transforms → Calls → Branches → Output) *before* raw source code. Raw syntax-highlighted code is one tab away with clickable call jumps. |
| **Friction-Aware AI Audit (Bug Radar)** | CHI/ICSE 2024–2026 studies on automation bias & silent AI failures | **Bug Radar Lens** transforms the canvas into a pre-attentive diagnostic heatmap highlighting circular dependencies (overhead red arcs), silent catches, unhandled async, dead/orphan code, arity mismatches, duplicated logic, and dangerous sinks. |

---

## 3. Architecture & Path to an IDE Plugin

Glassbox is intentionally split into two decoupled layers communicating over a clean JSON Intermediate Representation (`GlassboxIR v1`):

```
[Target Codebase] ──► Static Analyzer Engine (AST + Dataflow + Bug Radar)
                                │
                                ▼
                        GlassboxIR JSON
                                │
                 ┌──────────────┴──────────────┐
                 ▼                             ▼
   Standalone Browser HTML Guide      Future IDE Webview Plugin
   (Single self-contained .html)      (VS Code / JetBrains / AGY)
```

Because the entire interactive UI runs with **zero external runtime dependencies** inside a self-contained HTML/CSS/JS bundle and consumes pure `GlassboxIR` JSON, the exact same frontend can be mounted directly inside an IDE Webview Panel with live file-watcher updates and click-to-open-editor message passing.
