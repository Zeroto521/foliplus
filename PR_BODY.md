Extract the edit-specific helpers out of `MeasureControl/util.ts` into a dedicated `edit.ts` module, tidy the new module, and add direct-namespace test coverage.

## What changed

**New module** — `foliplus/js/MeasureControl/edit.ts` holds:
- `buildEditOverlay` — the shared ✕ edit overlay (open/close/cleanup)
- `bindNodeDrag` — manual node dragging (no built-in drag on L.CircleMarker/L.Marker, driven from mousedown/move/up)
- `markDragSyntheticClick` / `isDragSyntheticClick` — the one-shot flag that keeps a drag's trailing click from toggling an overlay

`util.ts` no longer re-exports these — callers (`ui.ts`, `mode/marker.ts`, `util.test.ts`) import them directly from `edit.js`.

**Cleanup in the new module**
- Removed a dead `CONST` import and a placeholder locale-translator comment carried over from util.ts but unused in the extracted module.
- Renamed the local `let open` flag to `isOpen` so it stops shadowing the `open()` handler returned on the same object.
- Extracted four named types (`EditOverlayHost`, `NodeDragHandlers`, `NodeDragHandle`, `EditOverlay`) instead of anonymous inline types, so the module's public contract is greppable.
- Replaced the `window.__foliplus_measure_drag_click` global with a module-scoped `let dragSyntheticClick` — both mark and check now live in the same module, so no cross-closure global channel is needed.
- Added blank lines between adjacent `const` handler declarations in `buildEditOverlay` and `bindNodeDrag` for readability.

**Tests** — new `test/js/MeasureControl/edit.test.ts` (9 cases) imports the symbols through their own `#foliplus/MeasureControl/edit.js` namespace rather than the `Util` re-export. Covers scenarios `util.test.ts` does not exercise:
- `isEditMode` is re-checked on every `open()` call (host toggle mid-session correctly gates the next open)
- `close()` and `cleanup()` are idempotent
- `cleanup()` unbinds both the node `mousedown` and `mouseup` handlers (not just `mousedown`)
- `delMarker` stays null-safe when absent
- Drag-synthetic click is fully neutralized via `L.DomEvent.stopPropagation(ev)`

## Why not an `EditManager` class

Considered and rejected. Edit-mode lifecycle (`isEditMode` toggle, ModeManager exclusive lock, Escape priority) lives in `MeasureManager` and is entangled with the measure-mode drawing path; a separate controller would be a thin forwarder with no clean context boundary. The three helpers here are genuinely pure utilities — shared mechanisms, not a stateful manager.

## Files
- `foliplus/js/MeasureControl/util.ts` — 355 -> 177 lines (-178)
- `foliplus/js/MeasureControl/edit.ts` — new, 200 lines
- `test/js/MeasureControl/edit.test.ts` — new, 9 tests
- `test/js/MeasureControl/util.test.ts` — callers updated to import from `edit.js`
- `foliplus/js/MeasureControl/ui.ts`, `mode/marker.ts` — callers updated to import from `edit.js`
- `CHANGELOG.md` — added #235 to the MeasureControl edit-mode entry

## Verification
- `npm run typecheck` — pass
- `npx vitest run` — 81 files / 1681 tests pass
- `make build-js-dev` — pass
- `make test-python` — 311 pass, 97% coverage
