# Folium Integration

foliplus is a *layer* of {class}`~foliplus.LayerControl` on top of folium: the
map, the layers and the Leaflet runtime are all folium's. foliplus does not
re-bundle Leaflet, does not ship a map, and does not re-export folium — you
build a normal folium map and add the foliplus controls to it. This page is the
integration guide: the supported layer families, the folium version
relationship, group rows and the plugin surface. The parameter-level contract —
which folium channels the panel reads and which parameters it ignores — is on
{doc}`folium-parameter-boundary`.

```python
import folium
from foliplus import LayerControl

m = folium.Map(location=[31.23, 121.47], zoom_start=10)
points = folium.FeatureGroup(name="Points")
folium.Marker([31.23, 121.47]).add_to(points)
points.add_to(m)
LayerControl().add_to(m)
m
```

:::{note}

foliplus declares a **hard floor** of folium `>=0.15.0`
(`pyproject.toml`) and is tested at both ends of the supported range — the
`0.15.0` floor and the current release (`1.0.0` today). Version 1.0.0 is a
compatible upgrade — the folium internal APIs foliplus relies on (the
`Layer` base class, `MacroElement`/`Element`/`Figure` chain,
`branca.element`, `JSCSSMixin`, the Jinja2 render path) are all unchanged;
the full non-browser Python suite and the browser suite pass under 1.0.0, and
no adapter change was required.

:::

## Layers foliplus reads

The panel lists any folium layer whose class is a {class}`folium.map.Layer`
subclass with `control=True` (the default). The recognised layer families:

| folium class | Panel row | Notes |
|--------------|-----------|-------|
| `Map` | — (the map itself is never a row) | the host surface, not a layer |
| `TileLayer` / `WmsTileLayer` | one row | the tile layers |
| `FeatureGroup` | one **group row** | see {ref}`group_rows` |
| `LayerGroup` (folium `>=1.0.0`) | one **group row** | see {ref}`group_rows` |
| `GeoJson` | one data row | see {ref}`geojson_boundaries` |
| `ImageOverlay` | one row | `<img>` relocated into its own pane for z/focus; opacity via the native `setOpacity` |

Only classes that actually subclass {class}`folium.map.Layer` can become rows:
the panel's collection pass keeps just those (`_collect.py`, `isinstance(item,
Layer)`). A `folium.Marker`, `CircleMarker`, `Circle`, `Polygon`, `PolyLine`
or `Rectangle` is a `MacroElement`, **not** a `Layer`, so it never gets a row of
its own and the panel cannot drive its style: a `Marker` stays in the shared
Leaflet `markerPane`, while the vector paths (`CircleMarker`, `Circle`,
`Polygon`, `PolyLine`, `Rectangle`) stay in the shared `overlayPane`. Wrap
point or vector content in a `FeatureGroup` to get one group row — visibility,
delete and focus work on it, while its Style and Filter menu entries are
disabled (see {ref}`group_rows`) — or use a `GeoJson` data layer to manage it
from the panel. A plugin layer that extends `Layer` (for example
`MarkerCluster` or `HeatMap`) is collected the same way.

The panel reads `layer.overlay` to decide the row's role (base vs overlay) —
folium's own grouping flag, mapped one-to-one onto foliplus's `role` (`_role.py`,
mirrored by `core/layer/role.ts`). A layer with no declared `overlay` is a
base layer, folium's own default.

## Icon colour: one chassis, three sources

folium's {class}`folium.Icon` `color=` and foliplus's `marker_color`
declaration both target the **marker chassis** (the awesome-marker pin body).
They are the same visual channel with a precedence order, not two independent
channels:

| Source | Accepted values | Priority |
|--------|-----------------|----------|
| the panel's own pick (user) | any hex via the style swatch | highest |
| the author's `Icon(color=...)` | a preset name or (folium `>=1.0.0`) a hex | middle |
| the `foliplus={"marker_color": ...}` declaration | a preset name or a CSS hex | lowest |

So a `marker_color` declaration is a **read-time default** the panel's Reset
returns to: the author's own `Icon(color=...)` wins over it, and a user's
panel pick wins over both. A hex colour can also be declared directly:
`marker_color` accepts the 19 preset names or a CSS hex (`#rgb` /
`#rrggbb`), and a hex outside the preset palette paints the chassis
directly.

```python
# the author's own chassis (preset name or, >=1.0.0, a hex) — wins over a marker_color default
gdf.explore(icon=folium.Icon(color="#00A6A6"))

# a read-time default (a preset name or a CSS hex) — lowest priority
gdf.explore(foliplus={"marker_color": "cadetblue"})
```

The preset list is documented on the {ref}`marker_color` page.

(group_rows)=

## Group rows: FeatureGroup and LayerGroup

A {class}`folium.FeatureGroup` or (folium `>=1.0.0`) {class}`folium.LayerGroup`
is listed as **one row**, not a folder of sub-layers. The row uses the group
glyph and the `type_container` label, and counts its **direct** children — a
container holding two nested containers reads 2, not the leaves buried inside.

`LayerGroup` is new in folium 1.0.0 and is a
{class}`~folium.map.Layer` subclass there; 0.15.x and 0.20.x have no such
class. `FeatureGroup` is already a `Layer` on the `0.15.0` floor.

The sub-layers are **not expanded** in the panel: a container is its own unit,
and its children stay where folium put them. This is the graceful-degradation
stance — the panel shows the container honestly (group row + child count) but
does not offer a tree view.

:::{note}

foliplus has its own *logical* folder concept (the `foliplus={"folder": ...}`
declaration), which is **not** a `FeatureGroup`/`LayerGroup`. A folder is a
panel grouping intent declared by the author; a LayerGroup is a physical folium
container. They compose: a LayerGroup row can sit inside a declared folder, but
the folder never expands the group's children.

:::

A container row is honest but **limited** — the style and filter menu entries
are disabled (a group has no single paint surface and no filter provider). The
row can still be **focused** (zoom to the group's extent) and **deleted** (the
group is cleared, its children removed with it).

### GeoJSON is data, not a container

{ref}`geojson_boundaries` below — a {class}`folium.GeoJson` extends
`FeatureGroup` in the Leaflet class chain, so foliplus deliberately excludes
it from the container probe (both by `instanceof` and by a shape fallback that
recognises a GeoJSON child envelope). A GeoJSON layer is a **data row**, never a
group row, even though its Leaflet class looks group-shaped.

## What does not integrate

foliplus ships its own panel and does not consume the folium *plugin* ecosystem.
The following have **no integration point** and are outside the supported
surface:

- **folium's native `LayerControl`** — do not add it next to
  {class}`~foliplus.LayerControl`. Both render their own checkbox panel; the
  two duplicate each other's controls and fight over layer visibility. **Choose
  one.** foliplus's panel is the one that reads the foliplus declaration
  namespace, folders, and per-layer style.
- **`GroupedLayerControl`** (third party) — foliplus uses its own panel; the
  grouped-control plugin is not consumed.
- **`WebGL Earth 3D`, `PolyLineDecorator`, `BeautifyIcon`, `Geoman`**
  — new folium plugins with no foliplus integration point. They may render on
  the map but foliplus neither styles nor filters them.
- **folium's own `MeasureControl` / `Draw` / `Fullscreen`** — use the
  foliplus equivalents (`MeasureControl`, `FullscreenControl`) instead; the
  folium native controls are not read by the foliplus panel.

The folium plugins that **do** compose with foliplus are the data-layer ones
that are (or extend) a {class}`folium.map.Layer` subclass:

- **`MarkerCluster`** — verified: individual marker icons migrate to a
  per-layer pane and runtime-added markers inherit it.
- **`HeatMap`** — verified: the heat canvas appends to `overlayPane` and
  `setOpacity` stays settable at runtime (see {ref}`looks_odd` below for
  the pane caveat).

(looks_odd)=

## Known "looks odd but is normal"

These are deliberate, not bugs — the panel is honest about what it can do.

- **A checked (visible) layer shows a red left bar on its row.** The bar is the
  "visible" (checked) indicator, not an error colour: it turns red
  (`--foliplus-accent-primary`) only while the row is checked. The bar is
  deliberately *not* a transient hover signal.
- **A checked row keeps a light red wash (`--foliplus-accent-light`).** The
  wash is the persistent checked surface, not a warning.
- **A base-layer row stays "quiet" on hover.** Base rows are stack slots, not
  data rows you navigate to, so they get no cursor glow and no white wash on
  hover — only a *checked* base row keeps its light red wash. A data (overlay)
  row, by contrast, lifts with a red glow on hover / keyboard cursor.
- **A `HeatMap` row's canvas stays in the shared `overlayPane`.** The heat
  plugin appends its canvas to the map's own overlay pane and does not move into
  a per-layer pane, so a per-layer opacity write does not reach it today — the
  heat layer is a shared-pane layer (like a `MarkerCluster` cluster icon,
  which also stays in `markerPane`).

(geojson_boundaries)=

## GeoJSON boundaries

A {class}`folium.GeoJson` is a data layer. foliplus reads its features for
per-feature paint, labels and filters, with these documented edges:

- **Multi-geometry propagation** (folium `>=1.0.0`): a `MultiPolygon` /
  `MultiPoint` feature propagates its style and tooltip to every member
  geometry. foliplus reads the same feature objects, so a value-based fill or
  label that walks the features sees the multi-geometry feature once.
- **`null` properties**: a feature with `null` (or missing) properties is
  treated as a feature with no values — it gets the derived default paint and
  is excluded from a value-based classification (it has no field value to
  classify by).
- **The panel never reads a GeoJSON as a container** (see above) — even though
  its Leaflet class is `FeatureGroup`-shaped, a GeoJSON is data.

## Folium version relationship

| Version | What changes for foliplus |
|---------|---------------------------|
| `>=0.15.0` | the declared floor (pyproject) |
| `0.20.x` | `FeatureGroup` is a `Layer` subclass; the panel reads it as a group row |
| `1.0.0` (2026-11-15) | new `LayerGroup` class (a `Layer` subclass, so the panel reads it as a group row); `requires-python >=3.11`; Leaflet 1.9.3 → 1.9.4 (foliplus reads the host Leaflet, never bundles it); `Icon` hex colour; `GeoJson` multi-geometry / `null`-properties fixes |

foliplus does not bundle Leaflet — the page's Leaflet is the one folium loads.
A host that loads its own Leaflet before folium's must keep the versions
compatible (foliplus reads whatever Leaflet the page provides, so a mismatched
Leaflet version is the page author's contract, not foliplus's).
