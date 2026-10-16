# Testing Status

Automated coverage: `bun run test` (plugin handler, end-to-end MCP export, relay payload) and
`bun run tests/live-export.test.js` (real Figma, requires the Figma window to be visible).

## Pending - Solo

_No pending manual tests._

## Completed

- [x] **Group nodes that share a parent**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. A rectangle at (0,100) and an ellipse at (150,100), both direct children of the page, were grouped with `group_selection({nodeIds:["51:19","51:20"]})`. Group `51:21` was created under `Page 1` containing both shapes at unchanged absolute bounds (0,100) and (150,100), group bounds (0,100) 250x100. The response carried no LIFTED notice, so `liftedToSharedParent` was false, no wrapper frame appeared, and `get_selection` returned the group as the sole selection.

- [x] **Group nodes across different parents lifts them**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. The same two shapes were placed in sibling frames `Card A` (51:23) and `Card B` (51:24), at absolute (20,620) and (320,620), then grouped. The response reported `Nodes were LIFTED to their nearest shared ancestor "Page 1", which changed their parent in the layer tree.` Group `51:25` formed under the page containing both shapes at unchanged absolute bounds, and both former parents reported `children: []`.

- [x] **Grouping when the shared ancestor is the page**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. After the cross-parent grouping above, `get_document_info` showed the page holding exactly three children, `Card A`, `Card B` and `Cross Parent Group`, with no wrapper frame created. The group sat directly under the page at (20,620) 400x100, matching Ctrl+G. This confirms `figma.currentPage` accepts children, so no wrapper is required.

- [x] **Ungroup releases group and frame children**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. A two-child group returned `success:true`, `ungroupedCount:1`, `releasedChildCount:2` with both child IDs, and `get_selection` returned both released children. The same was then repeated on a two-child frame, which returned the same counts and released both children to the page; `get_document_info` confirmed both containers were gone and only the two shapes remained.

- [x] **Frame selection wraps nodes without moving them**
  - Testers: 1
  - Result: Passed manually on 2026-10-15. With one shape in each of two sibling frames, calling `frame_selection` produced a frame directly under the page in both input orders, with both shapes inside at unchanged absolute positions and both hosts emptied, proving the outcome no longer depends on argument order. Passing `parentId` placed the frame inside the named host instead, and a same-parent selection kept the new frame inside the shared parent rather than lifting it.

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