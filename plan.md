# Diagram Export Crop + Auto-Colors + Edge Labels Improvements

## 3 Features

### Feature 1: Export Crop to Content
**Problem:** PNG/SVG/GIF exports capture the full viewport, including empty space. Users want to crop to just the content.

**Approach:** Add a `getContentBounds()` helper in the diagrams store that computes the bounding box of all nodes (with padding). Then:

- **PNG export:** Compute content bounds, use `html2canvas` (already a dep for GIF) to render just the content area with proper offset.
- **SVG export:** Set the SVG `viewBox` to the content bounding box.
- **GIF export dialog:** Add a "Crop" option with two modes:
  - **Fit to Content** (default) — auto-crops to node bounding box + padding
  - **Full Viewport** — current behavior

**Files changed:**
- `stores/diagrams.ts` — add `getContentBounds()` method
- `DiagramEditor.vue` — update `exportPng()` and `exportSvg()` to use content bounds
- `ExportGifDialog.vue` — add crop mode selector, compute capture region from content bounds

### Feature 2: Auto Colors & Quick Style Presets
**Problem:** New edges all get the same default color. No auto-color variety. Animations must be configured manually.

**Approach:**
- In `addEdge()`, auto-assign the edge color from the **source node's service category color** (e.g., Lambda edge = orange, S3 edge = green). Also auto-enable animated dots so diagrams feel alive by default.
- Add **Quick Style presets** in PropertiesPanel — one-click combos like:
  - "Data Flow" = green + solid + animated dots
  - "Request/Response" = orange + dashed
  - "Error Path" = red + dotted
  - "Sync" = blue + solid + fast dots

**Files changed:**
- `stores/diagrams.ts` — auto-color logic in `addEdge()`
- `PropertiesPanel.vue` — add Quick Styles section

### Feature 3: Better Edge Labels
**Problem:** Labels exist but are small and basic. Users want clearer text on arrows.

**Approach:**
- **Better rendering:** Larger font options (small/medium/large), better background contrast, proper auto-width using SVG text measurement.
- **Inline editing:** Double-click an edge to get an inline text input overlay right on the edge midpoint (no need to open Properties Panel).
- **Label size control** in PropertiesPanel.

**Files changed:**
- `stores/diagrams.ts` — add `labelSize` to `DiagramEdgeData`
- `AnimatedFlowEdge.vue` — improved label rendering, size variants
- `PropertiesPanel.vue` — label size selector
- `DiagramEditor.vue` — edge double-click → inline edit overlay

## Implementation Order
1. **Export crop to content** (biggest pain point)
2. **Auto colors + quick styles** (creation UX)
3. **Edge label improvements** (polish)

## Files Summary
| File | Changes |
|------|---------|
| `stores/diagrams.ts` | `getContentBounds()`, auto-color in `addEdge()`, `labelSize` field |
| `DiagramEditor.vue` | Crop-aware PNG/SVG export, edge double-click handler, inline label overlay |
| `ExportGifDialog.vue` | Crop mode selector (Fit Content / Full Viewport) |
| `AnimatedFlowEdge.vue` | Better label rendering with size variants |
| `PropertiesPanel.vue` | Quick Style presets, label size control |
