# Release Signing — Visualization Concepts

## The Problem With the Current UI

The current layout is a flat accordion: one row per filename, expand to see a flat list of builds. This fails because:

- **Relationships are invisible.** The trust triangle (maintainer → workflow run → ephemeral key → artifact) is the core mental model, but nothing in the UI represents it. You see a list of pubkeys and metadata — not a chain of trust.
- **Consensus is buried.** "2/2 builds agree" is a text label. The user can't *see* the agreement — they can't visually compare builds side-by-side or spot the outlier at a glance.
- **Provenance is a wall of text.** Ephemeral key, triggered-by, workflow, branch, URL, timestamp — all dumped in a single line. The eye has nowhere to anchor.
- **Scale is unaddressed.** With 2 builds this is tolerable. With 12 builds across 4 architectures from 3 workers, it's a spreadsheet.

The release signing page has a unique data shape that demands a purpose-built visualization. Below are five progressively more ambitious approaches.

---

## Option A: Trust Chain Cards (Incremental Improvement)

**Effort: Low | Risk: Low | Best for: shipping fast**

Keep the accordion structure but redesign each row as a structured card with clear visual hierarchy.

```
┌──────────────────────────────────────────────────────────────────┐
│  budabit-core_v0.1.0_aarch64_cortex-a53.ipk                     │
│                                                                  │
│  ██████████ 2/2 unanimous                                  [Sign]│
│  SHA256: 4aa40324…33274630                                       │
│                                                                  │
│  ┌─────────────────────┐  ┌─────────────────────┐               │
│  │  Build 1             │  │  Build 2             │              │
│  │  ┌───┐               │  │  ┌───┐               │              │
│  │  │ 👤│ alice (npub…)  │  │  │ 👤│ alice (npub…)  │             │
│  │  │ → │ run a3f8…     │  │  │ → │ run b7c2…     │              │
│  │  │ → │ key 2b1c…     │  │  │ → │ key d5a2…     │              │
│  │  │ ✓ │ 4aa403…       │  │  │ ✓ │ 4aa403…       │              │
│  │  └───┘               │  │  └───┘               │              │
│  │  worker-1 · 20:32    │  │  worker-2 · 20:20    │              │
│  └─────────────────────┘  └─────────────────────┘               │
└──────────────────────────────────────────────────────────────────┘
```

**Key changes from current:**
- Each build is a **card**, not a text line — side-by-side comparison is immediate
- Trust chain is a **vertical sequence** inside each card: maintainer → run → key → hash
- Matching hashes get the **same color**; differing hashes get contrasting colors
- Consensus bar is a filled progress indicator, not just a label

**Pros:** Minimal code change, already fits the accordion pattern, works on mobile.
**Cons:** Doesn't scale visually past ~6 builds. Still doesn't show cross-group relationships.

---

## Option B: Provenance Matrix

**Effort: Medium | Risk: Low | Best for: power users, many builds**

A table/matrix where rows are artifacts (grouped by filename) and columns are builders (ephemeral keys / workers). Cells show the hash, color-coded by agreement.

```
                    │ worker-1 (key 2b1c…) │ worker-2 (key d5a2…) │ worker-3 (key f91a…)
────────────────────┼──────────────────────┼──────────────────────┼─────────────────────
core_v0.1.0_arm64   │  ■ 4aa403…           │  ■ 4aa403…           │  ■ 4aa403…
                    │  alice · run a3f8    │  alice · run b7c2    │  bob · run c5d1
────────────────────┼──────────────────────┼──────────────────────┼─────────────────────
core_v0.1.0_x86_64  │  ■ 9bf721…           │  ■ 9bf721…           │  ■ e40c33… ⚠
                    │  alice · run a3f8    │  alice · run b7c2    │  bob · run c5d1
────────────────────┼──────────────────────┼──────────────────────┼─────────────────────
ui_v0.1.0_wasm      │  ■ 112acf…           │  —                   │  ■ 112acf…
                    │  alice · run a3f8    │  (not built)         │  bob · run c5d1
```

- **Color-coded cells**: all-green row = unanimous, a red cell = outlier immediately visible
- **Empty cells** make missing builds obvious (worker-2 didn't build the wasm target)
- **Click a cell** → expands to show full provenance, download URL, timestamps
- **Row-level checkbox** for signing — only rows with full consensus are selectable by default
- **Column headers** link to worker profile / loom advertisement

**Pros:** Extremely information-dense. Outliers are instant. Scales to 20+ builds cleanly.
**Cons:** Table UIs can feel sterile. Needs horizontal scroll on mobile. Not intuitive for non-technical users.

---

## Option C: Trust Graph (2D Network Diagram)

**Effort: Medium-High | Risk: Medium | Best for: making the trust model tangible**

A force-directed or layered graph where nodes are identities and edges are trust/signing relationships.

```
Layer 0 (Maintainers)          Layer 1 (Runs)          Layer 2 (Keys)          Layer 3 (Artifacts)

    ┌───────┐                   ┌────────┐              ┌────────┐
    │ alice  │──triggered──────►│ run a3f│──publisher──►│ key 2b1│──signed──►  [core_arm64: 4aa4…]
    │ (npub) │                  └────────┘              └────────┘              ────────────────────
    │        │──triggered──────►┌────────┐              ┌────────┐             [core_arm64: 4aa4…] ✓ match
    └───────┘                   │ run b7c│──publisher──►│ key d5a│──signed──►
                                └────────┘              └────────┘
    ┌───────┐                   ┌────────┐              ┌────────┐
    │  bob   │──triggered──────►│ run c5d│──publisher──►│ key f91│──signed──►  [core_arm64: 4aa4…] ✓ match
    │ (npub) │                  └────────┘              └────────┘
    └───────┘
```

**Implementation:**
- Use a layered DAG layout (left-to-right or top-to-bottom), not a chaotic force-directed layout
- Four columns: **Maintainers** → **Workflow Runs** → **Ephemeral Keys** → **Artifacts**
- Edges are colored by trust: green = verified chain, gray = unverified, red = broken chain
- Artifact nodes at the right edge are color-coded by hash agreement
- Hovering a node highlights its full trust path
- Clicking an artifact node selects it for signing
- Library candidates: **Elk.js** (layered layout algorithm), **D3.js**, **Svelte Flow** (svelteflow.dev), or **Cytoscape.js**

**Interactive behaviors:**
- **Hover a maintainer** → highlights all downstream runs, keys, and artifacts
- **Hover an artifact** → highlights the full provenance chain back to the maintainer
- **Drag to rearrange** (optional) — useful when the graph gets complex
- **Zoom/pan** for large graphs
- **Filter by maintainer** — fade out paths from unselected maintainers

**Pros:** Makes the trust model *visible*. Immediately answers "who triggered what, and do the results agree?" Differentiated UX — no other signing tool visualizes this way.
**Cons:** More complex to implement. Needs careful layout to avoid spaghetti at scale. May confuse users unfamiliar with graph UIs.

---

## Option D: Sankey / Alluvial Flow Diagram

**Effort: Medium-High | Risk: Medium | Best for: showing flow of trust at scale**

A Sankey-style flow diagram where the width of each flow band represents the number of agreeing builds. Trust flows left-to-right through the system.

```
Maintainers          Workflows              Hashes              Artifacts

                    ┌──────────┐
  ┌──────┐    ╔════╡ release   ╞════╗    ╔═══════════╗
  │ alice ├════╝   │ .yml (×2) │    ╚════╡ 4aa403…   ╞════╗    ┌──────────────────┐
  └──────┘         └──────────┘         ║ (3 agree)  ║    ╠════╡ core_arm64.ipk   │
                                        ╚═══════════╝    ║    │ ✓ unanimous (3/3) │
  ┌──────┐    ╔════┌──────────┐════╗                     ║    └──────────────────┘
  │ bob  ├════╝    │ release   │    ╚═════════════════════╝
  └──────┘         │ .yml (×1) │         ╔═══════════╗         ┌──────────────────┐
                   └──────────┘    ╔═════╡ 9bf721…   ╞════╗    │ core_x86.ipk     │
                                   ║    ║ (2 agree)  ║    ╠════╡ ⚠ majority (2/3) │
                                   ║    ╚═══════════╝    ║    └──────────────────┘
                                   ║    ╔═══════════╗    ║
                                   ║    ║ e40c33…   ╞════╝
                                   ║    ║ (1 differ) ║
                                   ║    ╚═══════════╝
                                   ║
```

- Flow **width** encodes the number of builds — a fat green band is strong consensus
- A **thin red branch** splitting off makes disagreement viscerally obvious
- **Hover a flow** → highlights all connected nodes and shows the full provenance
- **Click an artifact** (right column) → selects for signing
- Library: **D3-sankey** or a custom SVG implementation

**Pros:** Beautiful. Encodes both trust paths and consensus strength in a single view. Scales well — more builds just makes the bands wider. Immediately obvious which artifacts have strong vs. weak consensus.
**Cons:** Sankey layouts can be confusing on first encounter. Needs good labeling. Harder to show individual build details (need a detail panel on click).

---

## Option E: Hybrid — Graph + Detail Panel (Recommended)

**Effort: High | Risk: Medium | Best for: production-quality UX**

Combine the trust graph (Option C) as the primary view with a slide-out detail panel. This gives both the big picture and the ability to drill into specifics.

### Layout

```
┌─────────────────────────────────────────┬──────────────────────────┐
│                                         │                          │
│          Trust Graph (2D DAG)           │     Detail Panel         │
│                                         │                          │
│  [alice]──►[run a3f]──►[key 2b1]──►    │  ┌────────────────────┐  │
│                              ║          │  │ core_arm64.ipk     │  │
│  [alice]──►[run b7c]──►[key d5a]──►  ●─┤  │                    │  │
│                              ║          │  │ Hash: 4aa403…      │  │
│  [bob]──►[run c5d]──►[key f91]──►      │  │ Consensus: 3/3 ✓   │  │
│                                         │  │                    │  │
│         ● = core_arm64.ipk (4aa4…)      │  │ Build 1: key 2b1…  │  │
│         ○ = core_x86.ipk (split)        │  │   by alice via a3f │  │
│                                         │  │   at 20:32:40      │  │
│                                         │  │                    │  │
│                                         │  │ Build 2: key d5a…  │  │
│                                         │  │   by alice via b7c │  │
│                                         │  │   at 20:20:18      │  │
│                                         │  │                    │  │
│                                         │  │ [✓ Select] [Sign]  │  │
│                                         │  └────────────────────┘  │
└─────────────────────────────────────────┴──────────────────────────┘
```

### Graph panel (left, ~65% width)
- Layered DAG: Maintainers → Runs → Keys → Artifacts
- Artifact nodes are **colored circles**: green = unanimous, yellow = majority, red = split
- **Node size** encodes build count (larger = more builds agree)
- Edges animate on hover to show the trust flow
- **Click any node** → populates the detail panel
- **Minimap** in bottom-right corner for navigation when zoomed

### Detail panel (right, ~35% width, slide-in)
- Shows full metadata for the selected node
- For artifact nodes: all builds, hashes, provenance, consensus breakdown
- For maintainer nodes: all runs they triggered, total artifacts
- For run nodes: workflow, branch, ephemeral key, child artifacts
- **Sign button** appears when an artifact with sufficient consensus is selected
- Panel has its own scroll — graph stays fixed

### Interaction model
1. Page loads → graph renders with all relationships
2. User sees clusters of green artifact nodes → healthy consensus
3. User spots a yellow/red node → clicks it → detail panel shows the disagreement
4. User clicks a green artifact node → "Sign" button becomes available
5. User can multi-select artifact nodes (Cmd+click or checkbox in detail panel)
6. "Sign Selected (N)" button in the header publishes co-signed events

---

## Comparison

| Aspect | A: Cards | B: Matrix | C: Graph | D: Sankey | E: Hybrid |
|--------|----------|-----------|----------|-----------|-----------|
| Shows trust chain | Partially | No | Yes | Yes | Yes |
| Shows consensus | Text | Color | Color + size | Flow width | Color + size |
| Scales to 20+ builds | Poorly | Well | Medium | Well | Well |
| Implementation effort | Low | Medium | Medium-High | Medium-High | High |
| Mobile-friendly | Yes | No | Pinch-zoom | No | No (desktop-first) |
| "Wow" factor | Low | Low | High | High | Highest |
| Accessibility | Good | Good | Needs work | Needs work | Needs work |

---

## Recommendation

**Ship Option A now** (it's a quick rework of the current UI) while **building toward Option E** as the north star. The intermediate step is Option C (just the graph, no detail panel), which can be built with Svelte Flow or Elk.js in a reasonable timeframe.

The key insight is that this page is fundamentally about **relationships between entities**, not about lists of items. Any visualization that makes those relationships visible — whether cards, graphs, or flows — will be a massive improvement over the current flat accordion.
