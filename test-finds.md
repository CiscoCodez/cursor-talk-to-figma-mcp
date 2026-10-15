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

- Overall: In progress
- Passed: Undo walks back through consecutive plugin edits
- Failed: None
- Blocked: None
- Notes: Grouping across parents, frame selection and ungroup are implemented and compile cleanly but have not yet been exercised against a live document.

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

## Retest Log

| Finding | Version / build | Date | Result | Notes |
| --- | --- | --- | --- | --- |
| FIND-001 | working tree | 2026-10-14 | Pass | Editor behaviour confirmed; tool updated to match. |
| FIND-002 | working tree | 2026-10-14 | Pass | Three edits reversed by three undo calls. |