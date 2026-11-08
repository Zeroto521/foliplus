## Why
`fill.ts` had grown to 1513 lines mixing the facade orchestration with the original-colors arm and the value arm UI. The split gives each file one responsibility with no behavior change.

## What
- `fill.ts` → facade (824 lines): orchestrates the dimension, re-exports `disposeFillRow` and `buildOriginalDetail` so `style/index.ts` and tests keep their paths.
- `fillAuthor.ts` (52 lines): `authorFill` / `paintsPerFeatureFill` / `methodLabel` — the author-paint readouts shared by facade and both arms (breaks the facade↔arm import cycle).
- `fillOriginal.ts` (188 lines): the original-colors arm (`originalCaption` / `originalCount` / `readOnlyBox` / `buildOriginalDetail`).
- `fillValueDetail.ts` (519 lines): the value arm UI (`persistedValue` / `writeFillMode` / `writeFillValue` / `buildValueDetail` / `bindValueDetail` / …).
- `fillValue.ts` (72 lines): unchanged paint engine.

## How verified
- Function bodies are **CODE-IDENTICAL** to the original: comment-stripped, whitespace-normalized, per-function comparison against the pre-split `fill.ts` — every moved body matches exactly; the `fill.ts` diff contains only import/export changes.
- Export surface unchanged: the original 11 exports stay, plus `disposeFillRow` / `buildOriginalDetail` re-exports keep `style/index.ts` and the test imports working.
- Gates (post-merge `origin/main` @ e468afb3): `fill.test.ts` 200, full `LayerControl/ui/style/` 17 files 857 tests green; `tsc --noEmit` 0; `typecheck-test` 0; `style_check` 0; `dead_barrel_export` 0; `import-boundary` 8 green; Prettier clean; real `npm run build` — 18 artifacts green.

## No behavior change → no CHANGELOG entry.
