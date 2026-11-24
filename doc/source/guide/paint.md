# Layer paint read

`core.layer.readLayerPaint(layer)` answers one question for downstream
consumers: *which colour is this layer drawing, and which face is it?* It
collapses a whole layer tree — groups, features, markers — into one paint:

```js
core.layer.readLayerPaint(layer);
// {
//   kind: "areal" | "line" | "marker" | "mixed",
//   color: "#22a06b",   // areal fill, line stroke, marker chassis; "" when unreadable
//   border: "#22a06b",  // stroke colour; "" for a marker
//   opacity: 0.24,       // 0..1, paired with `color`
//   multicolor: false,   // leaves disagree on the primary colour
//   colors: ["#22a06b"], // every distinct primary colour, sorted
// }
```

## Faces

| Face     | Primary `color`                     | Paired `opacity` | `border`      |
| -------- | ----------------------------------- | ---------------- | ------------- |
| `areal`  | `options.fillColor ?? options.color` | `fillOpacity`    | stroke colour |
| `line`   | `options.color`                     | `opacity`        | same colour   |
| `marker` | icon chassis (`markerColor`)        | `markerColorOpacity / 100` | `""` |

A fully transparent fill (`fill: false` or `fillOpacity: 0`) leaves the stroke
as the only paint: `color` becomes the stroke colour and `opacity` pairs with
`options.opacity`, so an invisible fill never reports as an invisible layer.
A tree with several faces reports `kind: "mixed"`; `color` is the first
painted face's colour in document order.

`core.layer.readLeafPaints(layer)` is the per-leaf form of the same read:
a `Map` from leaf identity to `{ kind, color, border, opacity }`.

## Colour homes (single source)

Colour reading is split across three modules on purpose; each owns one rule and
nothing else normalizes colours:

- **`platform.color`** — hex parsing/normalizing (`normalizeHexColor`,
  `isHexColor`) and the alpha compose/parse pair. `ui` no longer re-exports
  `normalizeHexColor`; import it from `#platform/color`.
- **`core.leaflet.MARKER_COLOR_PRESET_HEX` / `markerColorHexOf`** — the
  awesome-markers preset table and the preset-name → hex mapping (also used by
  the declared `marker_color` reader and the panel row).
- **`core.leaflet.resolveChassisPaint`** — the author-chassis → declared
  `marker_color` → default-blue priority chain used by the panel, the apply
  path and `readLayerPaint`.

`readFeatureFillColors` stays the *declared per-feature author colour* read
(explore output's `__folium_color`, used by fill Reset); it is not a paint
read and deliberately returns `null` for a feature without the property.
