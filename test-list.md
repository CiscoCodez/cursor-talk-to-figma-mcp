# Testing Status

Automated coverage: `bun run test` (plugin handler, end-to-end MCP export, relay payload) and
`bun run tests/live-export.test.js` (real Figma, requires the Figma window to be visible).

## Pending - Solo

- [ ] **Group nodes that share a parent**
  - Testers: 1
  - Setup: A Figma page with two or more shapes sitting directly on the page, plus the plugin running and joined to a channel.
  - Steps: Select the shapes, call `group_selection` with no `nodeIds`, then call `get_selection`.
  - Expected: A group is created, `liftedToSharedParent` is false, no wrapper frame is created, and the group is the only selected node.
  - Agent-run 2026-10-15: passed with explicit IDs (no lifting, group sole selection) and cross-parent selection-driven. Awaiting owner confirmation.

- [ ] **Group nodes across different parents lifts them**
  - Testers: 1
  - Setup: A shape directly on the page, a group or card containing another shape, matching the Ctrl+G case already confirmed by hand.
  - Steps: Select the page-level shape and the nested shape, call `group_selection`.
  - Expected: The group forms at the shared ancestor exactly as Ctrl+G does, `liftedToSharedParent` is true, and the response names the ancestor the nodes moved to.
  - Agent-run 2026-10-15: passed. Selection-driven call lifted a nested node and a page-level node into a group under the page, former parent left empty, absolute positions unchanged, group became the sole selection. Awaiting owner confirmation.

- [ ] **Grouping when the shared ancestor is the page**
  - Testers: 1
  - Setup: Two shapes in sibling frames, or a page-level shape plus a nested one.
  - Steps: Select both, call `group_selection`, then inspect the resulting group and both former parents.
  - Expected: The group forms directly under the page, the nodes are lifted into it with no visual shift, and both former parents are left empty. No wrapper frame is created: the 2026-10-15 live run showed `figma.currentPage` accepts children, so the earlier wrapper requirement was based on a wrong assumption.
  - Agent-run 2026-10-15: passed. Group formed directly under the page with no wrapper, both former parents emptied. Awaiting owner confirmation.

- [ ] **Frame selection wraps nodes without moving them**
  - Testers: 1
  - Setup: Two or more shapes with known positions, at differing nesting depths if possible.
  - Steps: Select them, call `frame_selection`, then read the shapes' positions inside the new frame.
  - Expected: The frame bounds match the selection's bounding box and every wrapped node stays at its original on-canvas position.
  - Agent-run 2026-10-15: passed for same-parent and cross-parent selections, and for the selection-driven path with no `nodeIds`. Awaiting owner confirmation.

- [ ] **frame_selection places the new frame in the first node's parent**
  - Testers: 1
  - Setup: Two shapes in sibling frames, so their nearest shared ancestor is the page.
  - Steps: Call `frame_selection` on both, then inspect where the new frame landed.
  - Expected: Currently lands inside the parent of the first node, so it can overflow that parent, whereas Ctrl+Alt+G would use the shared ancestor. Decide whether to align with `group_selection`, which uses the nearest shared ancestor.

- [ ] **Ungroup releases group and frame children**
  - Testers: 1
  - Setup: A group with at least two children, and a frame with at least two children.
  - Steps: Select the group, call `ungroup`, then repeat for the frame with `nodeIds` set explicitly.
  - Expected: Children move up to the former parent, the container is gone, `ungroupedCount` matches, and the released children are selected.
  - Agent-run 2026-10-15: passed for a two-child frame and a two-child group. Clean `success:true`, correct `ungroupedCount` and `releasedChildCount`, children returned to the former parent and both became selected. Awaiting owner confirmation.

## Completed

- [x] **Undo walks back through consecutive plugin edits**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. On an empty page, a square, a circle and a rectangle were created in order, then `undo` was called three times. Each call removed exactly one shape, in reverse order: rectangle, then circle, then square. This confirmed the corrected checkpoint placement, after each successful mutation rather than before.

- [x] **Export after long idle**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. After roughly two hours of idle with the Figma window visible, an export on the session's own MCP socket returned immediately with a valid 16311 byte PNG. The old failure mode, where a long-idle bridge stopped answering, did not reappear.

- [x] **useAbsoluteBounds on a text node**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. Text node `378:19` ("Header proof", 456x22) exported as SVG. Default gave `width="454" height="12"`, cropped to glyph ink so ascenders and descenders were clipped. With `useAbsoluteBounds=true` it gave `width="456" height="22"`, the full node box matching the scanned bbox.

- [x] **suffix reaches the default file name**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. `suffix="-hero"` with default naming produced `~/Downloads/figma-exports/378_19-hero.png`. An explicit `outputPath` deliberately wins over the suffix, which is the documented precedence.

- [x] **Section fails fast for raster formats**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. PNG on section `415:96` failed in 0.1s with `"AstralSwords" is a Section, which Figma cannot export as PNG. Export a frame inside it instead, or use format=SVG.` instead of hanging 180s. SVG on the same section still worked (3.8 MB, 1.0s), and PNG on frame `108:509` inside it worked (2.3s).

- [x] **Large single-frame export**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. Frame `108:509` at `scale=1` gave 1200x1384, 1507 KiB in 2.3s; at `scale=2` gave 2400x2768, 3383 KiB in 3.8s. No size-related failure.

- [x] **PNG export writes a valid file**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. Node `139:353` (AstralSwords BuiltByBit Cover, 1024x512) exported in 0.1s, 16 KiB, dimensions matched the node, and the image came back inline.

- [x] **scale / width control output resolution**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. `scale=0.5` gave 512x256 against 1024x512 at `scale=1`; `width=320` gave exactly 320x160.

- [x] **All four formats produce real files**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. PNG, JPG (1024x512), SVG (real `<svg>` text) and PDF (`%PDF-` header) all written and verified from their file headers.

- [x] **Image-filled node exports (the original bug report)**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. Node `54:170`, the CiscoCodes sprite that previously timed out on every attempt at every scale, exported in 0.1s at 1196x668, 82 KiB. Root cause was that the Figma window was minimized, not the image fill. `54:519` no longer exists in the document.

- [x] **Bad node id errors fast instead of hanging**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. Returned in 6-305ms with a clear message and wrote no file.

- [x] **Pixel art exports sharp without setting resampling**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. A generated 16x16 four-colour test image was imported at exact size, then exported at `scale=1` (16x16) and `scale=16` (256x256). Both returned exactly the source's 4 colours with zero new colours, and one row of the 256x256 result contained only 2 distinct colours, so blocks stayed flat. Code-driven `exportAsync` uses nearest-neighbour sampling, so no `Basic` setting is needed. Manual exports through Figma's export panel still default to `Detailed` and do blur pixel art. Temporary probe node deleted afterwards.

- [x] **Bridge stays healthy after exports**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. `get_document_info` succeeded after PNG/JPG/SVG/PDF exports and after stale replies.