# Testing Status

Automated coverage: `bun run test` (plugin handler, end-to-end MCP export, relay payload) and
`bun run tests/live-export.test.js` (real Figma, requires the Figma window to be visible).

## Pending - Solo

_No pending manual tests._

## Completed

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

- [x] **Bridge stays healthy after exports**
  - Testers: 1
  - Result: Passed manually on 2026-10-04. `get_document_info` succeeded after PNG/JPG/SVG/PDF exports and after stale replies.