# Test Findings

> Working results log. Add one entry per distinct result or observation; preserve failed and retest history.

## Test Session

- Project: talk-to-figma-mcp
- Version / build / commit: working tree, grouping/undo tools
- Environment: Figma desktop, plugin loaded from `src/cursor_mcp_plugin/manifest.json`, local relay on port 3055
- Date: 2026-10-14
- Tester(s): 1 (project owner, manual)
- Test plan: `test-list.md`

## Session Summary

- Overall: Passed for the grouping toolset; one unrelated item still open.
- Passed: Undo walks back through consecutive plugin edits (owner-verified 2026-10-15); frame selection wraps nodes, including cross-parent and selection-driven; ungroup returns success and selects released children; `set_parent` preserves absolute position without coordinates; grouping lifts cross-parent selections to the nearest shared ancestor; frame selection placement is order-independent.
- Failed: None outstanding. FIND-005, FIND-006, FIND-009 and FIND-011 are fixed and verified live.
- Blocked: None
- Notes: FIND-010, the "Must join a channel before sending commands" error, remains open and uninvestigated. Remaining pending items in `test-list.md` still need owner sign-off before they are checked off.

## Findings

### FIND-001 - Ctrl+G lifts cross-parent selections in the editor

- Related test: Group nodes across different parents lifts them
- Result: Observation
- Severity: Info
- Reproducible: Yep
- Environment: Figma desktop, manual
- Context before finding: Raised while reviewing the strict same-parent behaviour of `figma.group()`.
- Steps to reproduce:
  1. Place a shape directly on the page and a second shape inside a card or group.
  2. Select both.
  3. Press Ctrl+G.
- Expected: Unknown at the time, since `figma.group()` is documented as requiring one shared parent.
- Actual: Figma lifts both nodes to their nearest shared ancestor and groups them there, confirming the tool should match this rather than error out.
- Evidence / attachments: Owner-reported manual observation.
- Probable cause: The editor's grouping command reparents to the nearest shared ancestor; the plugin API is stricter than the editor.
- Status: Closed
- Retest result: Addressed in code by lifting to the nearest shared ancestor before grouping.

### FIND-002 - Repeated undo steps back through plugin edits

- Related test: Undo walks back through consecutive plugin edits
- Result: Pass
- Severity: Info
- Reproducible: Yep
- Environment: Figma desktop, dedicated test page
- Context before finding: `figma.triggerUndo()` was documented only as "reverts to the last `commitUndo()` state", so whether consecutive calls walk back step by step or stick at one step was unverified.
- Steps to reproduce:
  1. Add a square, a circle and a triangle, in that order.
  2. Call `undo`.
  3. Call `undo` again.
  4. Call `undo` a third time.
- Expected: Each call reverses one prior edit.
- Actual: The triangle was removed, then the circle, then the square, in reverse order.
- Evidence / attachments: Owner-reported manual observation.
- Probable cause: Checkpoints are committed before each mutating command, while `undo` is excluded from committing so it does not overwrite the restore point it needs.
- Status: Closed
- Retest result: Not required.

### FIND-009 - Undo reverted two commands at a time with before-command checkpointing

- Related test: Undo walks back through consecutive plugin edits.
- Result: Fail, reproduced five times; then fixed and verified by the owner.
- Severity: Critical - silent data loss. Undoing a group also deleted a node inside it.
- Reproducible: Yep on the affected build.
- Environment: Live Figma document, channel `figma`, page `0:1`.
- Context before finding: A retest of the grouping tools on an empty page. `commitUndo()` was being called before each mutating command on the theory that it marked a restore point prior to the change.
- Steps to reproduce:
  1. Create three rectangles.
  2. Call `undo` once.
  3. Inspect page membership.
- Expected: Only the third shape removed.
- Actual: The second and third shapes were both removed. Consistent offset of exactly two across five runs, including runs with two-second gaps between creates, so it was not caused by Figma coalescing rapid operations.
- Evidence / attachments: Runs at page child levels observed directly via `get_document_info`. Sequence `E1,E2,E3` then one undo left only `E1`; a subsequent `create F1` then undo emptied the page entirely, removing both `F1` and `E1`. Worst observed case: after grouping two rectangles, one undo removed the group and one of its children.
- Probable cause: `commitUndo()` commits the changes made *so far* rather than marking a point ahead of them. Calling it before each command therefore left the checkpoint one position too far back, so `triggerUndo()` reached two commands into the past. The checkpoint must be committed after each successful mutation, which leaves the newest command uncommitted and undoable.
- Status: Fixed in source. `commitUndo()` moved to after a successful mutating command. Owner verified on 2026-10-15 that three consecutive undo calls each removed exactly one shape in reverse order.
- Retest result: Passed on the corrected build.

### FIND-010 - Undo calls rejected with "Must join a channel before sending commands"

- Related test: Undo walks back through consecutive plugin edits.
- Result: Observation, intermittent.
- Severity: Medium - a joined session can stop accepting commands until the plugin is restarted.
- Reproducible: Unknown, not reproduced by the agent across multiple runs on 2026-10-15.
- Environment: Live Figma document, owner's AI agent driving the MCP tools.
- Context before finding: The owner's agent had created three shapes successfully in channel `figma`, then every `undo` call was refused with `Must join a channel before sending commands`. Rejoining did not clear it. Restarting the plugin in Figma restored normal operation.
- Steps to reproduce:
  1. Join a channel and create nodes successfully.
  2. Call `undo`.
- Expected: The undo proceeds.
- Actual: The MCP server reported no channel was joined, despite a working channel earlier in the same session and successful reconnection attempts.
- Evidence / attachments: Owner-reported, 2026-10-15.
- Probable cause: Not established. Consistent with the plugin losing its relay connection and the server dropping channel state, rather than anything in the undo code path. Unrelated to FIND-009.
- Status: Open, uninvestigated. Worth watching; the plugin's reconnect and channel-rejoin handling is the place to look.
- Retest result: Not applicable.

### FIND-011 - frame_selection places the new frame in the first node's parent

- Related test: frame_selection places the new frame in the first node's parent.
- Result: Confirmed. Placement depends on argument order, not on anything intrinsic to the nodes.
- Severity: Medium - the outcome is arbitrary and silent.
- Reproducible: Yep, twice with opposite results from the same pair of shapes.
- Environment: Live Figma document, channel `figma`, page `0:1`.
- Context before finding: Cross-parent framing retest, with one rectangle in `Host A` and one ellipse in `Host B`.
- Steps to reproduce:
  1. Put one shape in each of two sibling frames.
  2. Call `frame_selection` with the ellipse id first and the rectangle id second.
  3. Inspect both hosts.
- Expected: Consistent with `group_selection`, which resolves to the nearest shared ancestor regardless of order.
- Actual: The new frame was created inside `Host B`, the parent of the *first id in the array*, leaving `Host A` empty. In the earlier run the same two shapes were passed in the opposite order and the frame landed in `Host A`. Identical inputs, opposite outcomes, determined purely by array order.
- Evidence / attachments: `Host B` (`42:3`) reported `children: ["42:6"]`; `Host A` (`42:2`) reported `children: []`. The frame was 260x60 inside a 150x100 host, so it overflowed.
- Probable cause: `frameSelection` sets its container to `nodes[0].parent`. `nodes` is whatever `resolveTargetNodes` returned: the caller's `nodeIds` in the order supplied, or `figma.currentPage.selection` in Figma's internal order when `nodeIds` is omitted. Neither is layers-panel order nor top-most; both are effectively arbitrary from the caller's point of view. `groupSelection` by contrast walks up to the nearest shared ancestor, so its result is order-independent.
- Status: Fixed and verified. `frameSelection` now resolves its container the same way `groupSelection` does: an explicit `parentId` wins, otherwise the shared parent when the nodes already share one, otherwise the nearest shared ancestor. `findNearestSharedAncestor` was reused.
- Retest result: Passed on 2026-10-15 after a plugin reload. Four cases verified: ellipse-first and rectangle-first both produced a frame directly under the page with both shapes inside at unchanged absolute positions and both hosts emptied, proving order-independence; `parentId` placed the frame inside the named host instead; same-parent input kept the new frame inside the shared parent rather than lifting it.

## Retest Log

| Finding | Version / build | Date | Result | Notes |
| --- | --- | --- | --- | --- |
| FIND-001 | working tree | 2026-10-14 | Pass | Editor behaviour confirmed; tool updated to match. |
| FIND-002 | working tree | 2026-10-14 | Pass | Three edits reversed by three undo calls. |

## Live MCP Test Session - 2026-10-15

- Project: talk-to-figma-mcp.
- Version / build / commit: Unknown; tested the running Figma MCP and connected plugin. The loaded runtime was not compared with this repository's source or working tree.
- Environment: Live Figma document, channel `figma`, current page `Page 1` (`0:1`). Page had zero children immediately before setup. Runtime manifest path, relay port, and OS/application versions were not independently verified in this session.
- Tester(s): AI-operated MCP tests, with the project owner directing the session.
- Test plan: Existing `test-list.md`; explicit `nodeIds` were used rather than selection-driven calls.
- Method: Inspect actual containment and `absoluteBoundingBox` using `get_node_info` and page membership using `get_document_info`. Tool success text alone was not accepted as proof.
- Overall: Failures found; partial coverage of the pending manual scenarios. No manual checkbox was changed.
- Passed aspects: Same-parent grouping; cross-parent grouping to the shared page; preserved absolute positions during grouping; removal of populated group/frame containers during ungroup.
- Failed aspects: Frame selection left the requested nodes outside its empty frame; populated ungroup calls changed the document but returned errors; `set_parent` without coordinates did not preserve the shape's absolute position in the observed setup.
- Contract discrepancy: The test list requires a wrapper frame when the shared ancestor is the page. The live tool grouped directly under the page. Confirm intended behavior before deciding whether implementation or test expectation needs changing.
- Untested: Selection-driven invocation, selection state after mutations, cross-parent frame selection, multi-child frame ungroup, mixed/batch ungroup, undo of grouping/framing/ungroup, and rotated/auto-layout nesting.
- Evidence: Exact arguments and bounded MCP response excerpts below; no screenshots, source inspection, or console logs were collected.

### Initial setup and shape identities

The three previously undone shapes were recreated through separate MCP calls:

| Node | Name | Type | Absolute x/y | Width/height | Initial parent |
| --- | --- | --- | --- | --- | --- |
| `33:2` | Undo Test 1 — Rectangle | RECTANGLE | -1740, -2000 | 100, 100 | Page `0:1` |
| `33:3` | Undo Test 2 — Circle | ELLIPSE | -1610, -2000 | 100, 100 | Page `0:1` |
| `33:4` | Undo Test 3 — Rectangle | RECTANGLE | -1480, -2000 | 100, 60 | Page `0:1` |

The circle fill was `{r:0.2,g:0.5,b:0.9}`. Node IDs identify this recorded run and must be replaced with fresh returned IDs when reproducing.

### FIND-003 - Same-parent grouping creates the correct group and preserves positions

- Related test: Group nodes that share a parent.
- Result: Partial pass; explicit-ID containment and geometry verified, selection-based acceptance criteria not exercised.
- Severity: Info.
- Reproducible: One recorded attempt; no repeat run.
- Context before finding: Shapes `33:2` and `33:3` were direct children of page `0:1`.
- Steps to reproduce:
  1. Create the first rectangle and circle using the initial setup table.
  2. Call `group_selection({name:"Test — Same Parent Group",nodeIds:["33:2","33:3"]})`.
  3. Inspect the returned group with `get_node_info`.
- Expected: A group under the existing parent containing both shapes, with unchanged absolute positions. The test plan additionally expects no wrapper, `liftedToSharedParent=false`, and the group as the sole selection.
- Actual: Group `33:5` was created directly under `Page 1`. It contained exactly `33:2` and `33:3`. Bounds were x=-1740, y=-2000, width=230, height=100. Both children retained their initial absolute bounds.
- Evidence / attachments: Response: `Grouped 2 node(s) into group "Test — Same Parent Group" (33:5) under "Page 1".` The inspection returned `type:"GROUP"` with both child IDs and their original absolute bounds.
- Limitations: Human-readable tool output did not expose a `liftedToSharedParent` field. `get_selection` was not called; selection state remains unverified.
- Probable cause: Not applicable; observed grouping behavior worked.
- Status: Verified for explicit-ID grouping; full manual scenario remains pending.
- Retest result: Not repeated.

### FIND-004 - Cross-parent grouping lifts nodes correctly, but page-wrapper expectation differs

- Related tests: Group nodes across different parents lifts them; Grouping when the shared ancestor is the page.
- Result: Partial pass for lifting and geometry; test-plan/implementation contract discrepancy for wrapper behavior.
- Severity: Info for grouping; needs contract decision for wrapper expectation.
- Reproducible: One recorded attempt.
- Context before finding: Rectangle `33:2` was placed inside frame `33:6` at relative (10,10); circle `33:3` was placed inside frame `33:7` at relative (10,10). Both frames were direct children of page `0:1`. Explicit-coordinate `set_parent` calls established this setup.
- Steps to reproduce:
  1. Create frame A at (-1740,-2000), size 230x100, and frame B at (-1480,-2000), size 140x140.
  2. Put a 100x100 rectangle inside A and a 100x100 circle inside B, each at relative (10,10).
  3. Inspect both parents to record child bounds and prove different-parent setup.
  4. Call `group_selection({name:"Test — Cross Parent Group",nodeIds:["33:2","33:3"]})`.
  5. Inspect the new group and both former parents.
- Expected: Both children move into a group under their nearest shared ancestor without visual movement. The current test list additionally requires a `wrapperFrameId` when that ancestor is the page.
- Actual: Group `33:8` was created directly under `Page 1`, containing both shapes. Former frames `33:6` and `33:7` were empty afterward. Group bounds were (-1730,-1990), 360x100. Rectangle remained at (-1730,-1990), 100x100; circle remained at (-1470,-1990), 100x100. No new wrapper frame appeared in page membership.
- Evidence / attachments: Response: `Grouped 2 node(s) into group "Test — Cross Parent Group" (33:8) under "Page 1". Nodes were LIFTED to their nearest shared ancestor "Page 1", which changed their parent in the layer tree.` Both former parent inspections returned `children:[]`.
- Contract note: **Resolved.** `test-list.md` claimed a page cannot hold children, but the live run showed `figma.currentPage` accepted shapes, frames and groups, and the group landed directly under `Page 1` with no wrapper. The earlier wrapper requirement came from a wrong assumption about the API, not from a requirement of the intended behaviour. The pending test item and the `group_selection` tool description have been corrected to match the verified behaviour; no code change was needed.
- Limitations: Used two sibling frames rather than one page-level shape plus one nested shape. Selection-driven invocation and structured flags were not verified.
- Probable cause: Not applicable; the implementation was already correct.
- Status: Grouping behaviour verified for this setup; the selection-driven path remains untested.
- Retest result: Not repeated.

### FIND-005 - Frame selection reports wrapping but creates an empty frame

- Related test: Frame selection wraps nodes without moving them.
- Result: Fail.
- Severity: High - false success for the tool's primary operation; requested containment is absent.
- Reproducible: One recorded attempt; requires isolated retest after the preceding ungroup error.
- Context before finding: Same-parent group `33:5` had just been ungrouped. That operation returned an error after removing its container (FIND-006). Rectangle `33:2` and circle `33:3` still existed and were later confirmed as direct children of the page.
- Steps to reproduce:
  1. Create a rectangle at (-1740,-2000), 100x100, and circle at (-1610,-2000), 100x100.
  2. For the exact recorded sequence, group these shapes, then ungroup the returned group.
  3. Call `frame_selection({name:"Test — Framed Shapes",nodeIds:["33:2","33:3"]})`.
  4. Inspect the returned frame and the current page.
- Expected: A 230x100 frame at (-1740,-2000) containing both nodes, preserving their original absolute positions.
- Actual: The tool returned a wrapping-success message and created frame `33:6` at the correct bounds, but `get_node_info({nodeId:"33:6"})` returned `children:[]`. `get_document_info` showed both shapes still directly on the page alongside the empty frame.
- Evidence / attachments:
  - Response: `Wrapped 2 node(s) in frame "Test — Framed Shapes" (33:6) sized 230x100`.
  - Inspection: `{"id":"33:6","name":"Test — Framed Shapes","type":"FRAME","absoluteBoundingBox":{"x":-1740,"y":-2000,"width":230,"height":100},"children":[]}`.
  - Page children: `33:2`, `33:3`, `33:4`, and `33:6`.
  - Calling `ungroup({nodeIds:["33:6"]})` returned `success:false`, `ungroupedCount:0`, and `Node has no children to ungroup`, independently consistent with the empty-frame inspection.
- Probable cause: **Confirmed.** `frameSelection` never called `frame.appendChild(node)`. It created the frame, appended only the frame to the container, then looped over the selected nodes setting `node.x`/`node.y` while those nodes were still direct children of the page. The position loop ran on nodes that were never moved, so an empty frame was created and success was reported.
- Status: Fixed in source, awaiting live retest.
- Retest result: None. Recheck in isolation with freshly created page-level shapes, then cross-parent shapes, and verify actual children as well as bounds before reporting success.

### FIND-006 - Ungroup mutates the document but fails while reporting a removed container's name

- Related test: Ungroup releases group and frame children.
- Result: Fail for command completion/response; child release and container removal observed for both GROUP and FRAME.
- Severity: High - callers receive failure after a document mutation and may retry or assume nothing changed.
- Reproducible: Same error pattern observed twice: one group and one populated frame.
- Steps to reproduce, GROUP case:
  1. Create the two-shape group `33:5` as in FIND-003.
  2. Call `ungroup({nodeIds:["33:5"]})`.
  3. Inspect page membership and the original child IDs.
- Actual, GROUP case: Response was `Error ungrouping: in get_name: The node with id "33:5" does not exist`. Later page inspection showed the group gone and both original shapes directly on the page. The subsequent frame-selection call accepted the same child IDs.
- Steps to reproduce, FRAME case:
  1. Create frame `33:7` at (-1480,-2000), 140x140.
  2. Put rectangle `33:4` inside it using `set_parent({nodeId:"33:4",parentId:"33:7",x:20,y:20})`.
  3. Call `ungroup({nodeIds:["33:7"]})`.
  4. Inspect `33:4` and page membership.
- Actual, FRAME case: Response was `Error ungrouping: in get_name: The node with id "33:7" does not exist`. Frame `33:7` was absent from the final page. Rectangle `33:4` was directly on the page at (-1460,-1980), 100x60, matching the expected pre-ungroup position from its frame origin plus relative offset.
- Expected: Children released to the former parent, container removed, successful response with correct `ungroupedCount`, and released children selected.
- Evidence / attachments: Both exact errors above; final page children were `33:6` (FRAME), `33:4` (RECTANGLE), and `33:8` (GROUP). `get_node_info` confirmed rectangle geometry after frame ungroup.
- Probable cause: **Confirmed.** `figma.ungroup(node)` destroys `node`. The success branch then read `node.name` and `node.type`, which threw. The resulting throw landed in the `catch`, which read `node.name` and `node.type` again, and that second throw escaped the function uncaught. Hence a successful mutation reported as an error.
- Limitations: Group case had two children; frame case had only one. Selection state and multi-node batch behavior were not checked. No successful populated-ungroup count was returned.
- Status: Fixed in source, awaiting live retest.
- Retest result: None. Retest group and multi-child frame paths, result fields, released-child selection, and undo after the response fix.

### FIND-007 - set_parent without coordinates does not preserve absolute position in this setup

- Related test: Additional observation while preparing cross-parent grouping; no matching pending test-list item.
- Result: Fail against the exposed tool description: preserves absolute position unless x/y are provided.
- Severity: Medium - unexpected visual movement during reparenting.
- Reproducible: One recorded attempt; geometry inferred from returned relative coordinates and independently inspected parent bounds.
- Context before finding: Rectangle `33:2` was on the page at (-1740,-2000). Empty frame `33:6` was also at (-1740,-2000), size 230x100, as verified in FIND-005.
- Steps to reproduce:
  1. Create a frame and page-level rectangle sharing absolute origin (-1740,-2000).
  2. Call `set_parent({nodeId:"33:2",parentId:"33:6"})` without x or y.
  3. Read returned coordinates and independently inspect the child's absolute bounds before making any correction.
- Expected: Rectangle relative position becomes (0,0), preserving its absolute position (-1740,-2000).
- Actual: Response: `Moved node "Undo Test 1 — Rectangle" into "Test — Framed Shapes" at (1740, 2000)`. With the recorded parent origin, these relative coordinates imply an absolute origin of (0,0), not the original (-1740,-2000).
- Evidence / attachments: Exact call and response above. Parent origin was independently inspected. The child's intermediate absolute bounds were not read before correction, so direct post-call geometry confirmation remains pending.
- Recovery used for later tests: `set_parent({nodeId:"33:2",parentId:"33:6",x:10,y:10})`. Subsequent parent inspection confirmed the child at absolute (-1730,-1990), so the cross-parent test used a known-good explicit-coordinate setup.
- Probable cause: Possible coordinate-transform calculation/order issue while changing parents. Source-level cause unverified; do not assume this shares the frame-selection root cause.
- Status: Open; confirm intermediate bounds in an isolated retest.
- Retest result: Not repeated without coordinates. Explicit x/y setup worked.

### FIND-008 - Empty frame ungroup is rejected with a useful result

- Related test: Ungroup releases group and frame children; empty-container edge case.
- Result: Observation; clear rejection verified.
- Severity: Info.
- Reproducible: One attempt.
- Context before finding: Frame `33:6` unexpectedly had no children after FIND-005.
- Steps to reproduce: Call `ungroup({nodeIds:["33:6"]})` on an empty frame.
- Expected: No child release is possible; return a clear outcome rather than claiming children were released.
- Actual: Returned `success:false`, `ungroupedCount:0`, `totalNodes:1`, and a per-node error `Node has no children to ungroup`, followed by `Ungrouped 0 of 1 node(s)`. The frame remained on the page.
- Evidence / attachments: Result object included `ungroupedNodes:[]` and the original frame ID/name/type.
- Probable cause: Not applicable; observed guard behavior.
- Status: Recorded; no fix requested for this edge case.
- Retest result: Not repeated.

## Test-plan Coverage - 2026-10-15

| Existing pending item | Coverage from this run | Remaining verification |
| --- | --- | --- |
| Group nodes that share a parent | Explicit-ID grouping and unchanged bounds passed | No-nodeIds selection path; sole selected group; structured lift/wrapper fields |
| Group nodes across different parents lifts them | Two sibling frames tested; common page grouping and stable bounds passed | Exact page-level-plus-nested setup; selection path and selection state |
| Grouping when the shared ancestor is the page | Group created directly under page; no wrapper appeared | Resolve wrapper requirement versus observed supported page children; verify intended response contract |
| Frame selection wraps nodes without moving them | Failed: correct frame bounds, zero children | Isolated same-parent retest; cross-parent case; actual child membership and stable bounds |
| Ungroup releases group and frame children | Group (two children) and frame (one child) released children but returned errors | Successful response/counts; selection path/state; frame with at least two children; batch handling |

All five pending items remain unchecked. Existing completed tests and the original FIND-001/FIND-002 history are preserved. This session does not establish that the loaded plugin matches the checkout or that the release is ready.

## Additional Retest Log

| Finding | Version / build | Date | Result | Notes |
| --- | --- | --- | --- | --- |
| FIND-003 | Runtime revision unknown | 2026-10-15 | Partial pass | Explicit-ID containment and bounds verified; selection contract pending. |
| FIND-004 | Runtime revision unknown | 2026-10-15 | Partial pass / discrepancy | Cross-parent lift works; wrapper expectation unresolved. |
| FIND-005 | Runtime revision unknown | 2026-10-15 | Fail | Success text, empty result frame, shapes still at page level. |
| FIND-006 | Runtime revision unknown | 2026-10-15 | Fail, observed twice | GROUP and FRAME removed before get_name error. |
| FIND-007 | Runtime revision unknown | 2026-10-15 | Fail indication | Unexpected relative coordinates; direct intermediate bbox retest needed. |
| FIND-008 | Runtime revision unknown | 2026-10-15 | Observation | Empty-frame ungroup rejected without removal. |
| FIND-009 | commitUndo-after build | 2026-10-15 | Pass | Was two commands per undo; owner confirmed one after the fix. |
| FIND-010 | Runtime revision unknown | 2026-10-15 | Observation | Channel-lost error; cleared by plugin restart; not reproduced. |
| FIND-011 | Fixed build | 2026-10-15 | Pass | Order-independent across both input orders; parentId override and same-parent branch both correct. |

## Final Canvas State and Handoff

- All three restored shapes still existed at the end of the recorded tests.
- Page `0:1` had three direct children: empty frame `33:6`, rectangle `33:4`, and cross-parent group `33:8`.
- Group `33:8` contained rectangle `33:2` and circle `33:3`; their original parent frames were not restored.
- Group `33:5` and frame `33:7` were removed by ungroup despite the error responses.
- No undo calls were made during this grouping/framing/ungroup test session. Test artifacts were intentionally left for inspection.
- This report does not include fixes. Suggested investigation order: FIND-005 false wrapping success; FIND-006 failure after mutation; FIND-007 coordinate preservation; then resolve FIND-004's wrapper contract and retest the remaining selection/response criteria.
- Before editing code, establish which MCP server/plugin build is running and reproduce against that exact source revision. Probable-cause statements above are investigation leads, not verified code diagnoses.
