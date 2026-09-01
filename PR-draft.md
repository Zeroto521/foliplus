# PR #228 — style: beautify keyboard navigation focus across all foliplus controls

## Branch state

```
origin/main ── b32c9b8 feat: lock interactive controls … (#224)
                  aa77734 fix(LayerControl): keep keyboard cursor alive across a fold-click rebuild (#215)
                  96daccf style(LayerControl): add keyboard focus navigation highlight
                  a165033 test(LayerControl): cover keyboard focus cursor class transfer semantics
                  bf4b12b fix(LayerControl): conditional outline suppression + public blurActiveItem
                  8023afb style: unify keyboard focus ring across all foliplus controls  ◀ HEAD
                  85e9739 chore: document unified focus ring in changelog
```

6 commits ahead of `origin/main`.

## What changed

### LayerControl keyboard cursor (96daccf + a165033 + bf4b12b)
- JS cursor state machine already correct — CSS was missing rules for `.foliplus-layer-focused`
- Added: 3px accent left bar, 8% wash, hairlines, shadow-xs, 0.18s fade+slide animation, `prefers-reduced-motion` override
- Conditional outline suppression: `&.foliplus-layer-focused:focus-visible { outline: none }` only when cursor class is present (a11y fix from Copilot review)
- 6 vitest cases for cursor-class transfer semantics (83/83 passing)

### Global keyboard focus ring (8023afb)
Replaced harsh `outline: 2px solid var(--accent-primary)` with soft double-ring `box-shadow` across all `:focus-visible` surfaces:
- common.css: all foliplus buttons
- common.css: search/heatmap/layer inputs
- LayerControl.css: more-menu items + color input

### CHANGELOG.md (85e9739)
Two entries under `### Changed`:
- LayerControl cursor styling
- Global keyboard focus ring
