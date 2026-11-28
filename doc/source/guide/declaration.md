# Declaration Guide

foliplus layers carry a per-layer `foliplus={...}` declaration namespace on
the layer itself. The namespace is a plain mapping of declaration keys; each
key tunes one aspect of how the layer behaves in a {class}`~foliplus.LayerControl`
panel — a visibility window, a folder, a value-based fill, a text label, a
filter, a border default, a marker chassis colour or a marker icon pixel size.

Every key is **optional** and **additive**: a layer that declares nothing
behaves exactly as it did before the key existed. A declaration that is
present but unusable is never fatal — it warns once (a {class}`UserWarning`
de-duplicated per layer and key) and is ignored, so a typo shows a message
instead of taking the page down.

:::{note}

The namespace is read two ways. `zoom_range`, `folder` and `label` are
normalised on the Python side into the panel's CONF facts
(`data[].zoom_range`, `data[].folder` and `data[].label`). `fill`,
`filter`, `border`, `marker_color`, `icon_size`, `opacity`,
`icon` and `marker` are consumed by the JavaScript panel straight off
`layer.options.foliplus`; Python validates their shape and warns once at
collection time so a malformed declaration is reported where it was
written, and the JavaScript side owns the runtime verdict (for example the
marker-colour preset vocabulary).

:::

## Writing a declaration

Declare the namespace on the layer at construction. With `geopandas`
`explore` the unknown `foliplus=` keyword is forwarded onto the layer's
options:

```python
import geopandas as gpd

gdf = gpd.read_file("data/gadm41_CHN_3_Shanghai.geojson")
gdf.explore(
    foliplus={
        "zoom_range": {"min": 8, "max": 12},
        "folder": "底图",
    },
)
```

A third-party or custom {class}`folium.map.Layer` subclass can declare the
same namespace two ways — the `foliplus=` keyword (forwarded into the
layer options) or the `layer.foliplus = {...}` attribute (folium's base
{class}`Layer` constructor never consumes `**kwargs`):

```python
layer.foliplus = {"folder": "底图"}
```

The attribute channel wins when present; the options channel is the fallback.

## Declaration keys

The recognised keys are:

| Key            | Type  | Meaning                                                             |
| -------------- | ----- | ------------------------------------------------------------------- |
| `zoom_range`   | dict  | visible zoom window (see {ref}`zoom_range`).                        |
| `folder`       | str   | layer folder (role) name (see {ref}`folder`).                       |
| `fill`         | dict  | value-based or solid fill (see {ref}`fill`).                        |
| `label`        | dict  | text labels (see {ref}`label`).                                     |
| `filter`       | dict  | value filter (see {ref}`filter`).                                   |
| `border`       | dict  | border default mode / colour / weight (see {ref}`border`).          |
| `marker_color` | str   | marker chassis preset (see {ref}`marker_color`).                    |
| `icon_size`    | int   | marker icon pixel size (see {ref}`icon_size`).                      |
| `opacity`      | float | whole-layer opacity, the slider's reset point (see {ref}`opacity`). |
| `icon`         | dict  | icon face: `glyph` / `color` / glyph alpha (see {ref}`icon_face`). |
| `marker`       | dict  | marker face: chassis alpha (see {ref}`icon_face`).                  |

An unknown key warns once and is ignored:

```python
gdf.explore(foliplus={"fill_scheme": "Reds"})
# LayerControl: layer '...' declares unknown foliplus key 'fill_scheme'
#   ; expected one of ['border', 'fill', 'filter', 'folder', 'icon',
#   'icon_size', 'label', 'marker', 'marker_color', 'opacity', 'zoom_range']
#   - ignored
```

A `fill` / `label` / `filter` / `border` / `icon` / `marker` value that is
not a mapping also warns once and is ignored.

(zoom_range)=

## `zoom_range` — visibility window

Declares the zoom levels at which the layer is visible (inclusive). The layer
is hidden outside the window.

```python
gdf.explore(foliplus={"zoom_range": {"min": 8, "max": 12}})
```

**Shape**: a mapping with exactly two keys, `min` and `max`, both integers
(the `min`/`max` endpoints may be a numpy or pandas integer scalar). Both
are required; `min <= max`.

**Behaviour**: the layer is visible between `min` and `max` inclusive.
A user's stored range always wins over the declaration. When the declaration
is unusable (a non-integer endpoint, an inverted range, an unknown key), it
warns once and is ignored — the visibility policy stays unconstrained.

(folder)=

## `folder` — layer folder

Declares the folder (role) name the layer's panel row groups into.

```python
gdf.explore(foliplus={"folder": "底图"})
```

**Shape**: a non-empty string, at most 64 Unicode code points after
normalisation.

**Behaviour**: the layer's row appears inside the named folder. Two layers
declaring the same folder name in the same role are grouped into one folder —
a grouping intent, never a conflict. Folder names group case-insensitively
after whitespace folding, so `"Basemap"`, `"basemap"` and `"BASE MAP"`
land in one folder; the folder keeps the first spelling it saw. A folder keeps
its group row after its last layer is removed.

Membership is declared per layer and nowhere else. The control-level
`folders=` option (see {ref}`folders`) declares a folder's **defaults** — its
display name and whether it starts folded — and never moves a layer into a
folder. A `folders=` entry whose name no layer claims warns once
(deduplicated, attributable to the typo) and has no visible effect: no row is
created for it.

A non-string, blank or over-long name warns once and is ignored — the layer
stays at the role root.

The layer-level declaration has a control-level sibling: HeatmapControl and
MeasureControl accept a folder= argument (their layer registers with the
declaration, so a new page already places it inside the folder). The same
priority applies — a user drag to another folder (persisted) wins over the
declaration.

(folders)=

## `folders` — central folder defaults

`LayerControl(folders=...)` declares a folder's **defaults**: its display name
and whether it starts folded. It is a different channel from the per-layer
`folder` key, and the split is deliberate:

| Channel                               | Owns                                                                        | Does not do                                              |
| ------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `foliplus={"folder": ...}` on a layer | **membership** — which folder the layer's row groups into                   | set the folder's default folded state                    |
| `LayerControl(folders=...)`           | **metadata** — the folder's display name and default folded state, per role | create a folder, move a layer into one, or order folders |

A complete example — declare the folders once, then put each layer in one:

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

# 1. Membership: each layer names its own folder. These are the only
#    declarations that put a row inside a folder. GeoPandas' explore is the
#    repo-wide layer-adding convention: build the map first, then pass m= to
#    every explore call to append the layer.
m = folium.Map(location=[31.2, 121.5], zoom_start=10)
gdf_basemap.explore(m=m, foliplus={"folder": "底图"})
gdf_roads.explore(m=m, foliplus={"folder": "交通"})
gdf_pois.explore(m=m, foliplus={"folder": "设施"})

# 2. Central declaration: folder metadata only — name + default folded state.
#    Keyed by role, because a base folder and an overlay folder may share a name.
LayerControl(
    folders={
        "base": [{"name": "底图", "folded": False}],
        "overlay": [
            {"name": "交通", "folded": True},
            {"name": "设施", "folded": False},
        ],
    }
).add_to(m)
```

**Shape**: a mapping keyed by role (`"base"` / `"overlay"`), each value a list
of entries. An entry is `{"name": <str>, "folded": <bool>}`; only `name` is
required (a non-empty string, at most 64 Unicode code points after
normalisation), `folded` defaults to `False` (expanded). v1 understands those
two keys only — an unknown key rejects the whole entry with a one-time warning.
Declarations of the same name within one role merge: the display name keeps the
first spelling, `folded` is last-wins.

**Behaviour**:

- A folder that layers claim but `folders=` does not mention still exists — it
  simply starts expanded (the built-in default).
- A `folders=` entry no layer claims warns once and creates no row: there is no
  folder to apply the default to.
- The default folded state is the middle of a three-level chain: built-in
  (expanded) < author default (`folders=`) < user override (the persisted fold
  state). A user's manual fold **or expand** wins over the author default, and
  Reset clears the user override back to the author default.
- `folders=` does not order folders. A folder's block sits at its first member
  layer's registration position; a user's drag order wins afterwards.

### Group rows expand into their child layers

A `FeatureGroup` or `LayerGroup` renders as a **group container row**: a
row with a group glyph, a visible-of-total child count, and a chevron. The
count reads "shown / total" and tracks the children's own visibility, not the
group's single toggle.

Pressing the chevron **expands** the group in place: one row per direct child
appears indented beneath the container, each carrying its own visibility
toggle. Toggling a child shows or hides only that child — the container row
stays put and its count updates. Collapsing the group hides the child rows and
leaves every child's visibility as it was.

Focus on the container row fits the map to the group as a whole and raises
every child pane together, so a group that spans several layers focuses in one
step.

:::{note}

The container row disables its own Style and Filter entries: those apply to
individual layers, and the group is only a container. Once child layers are
registered as `LayerInfo` entries, each child row's ⋮ menu offers Style and
Filter on its own — a probe-only capability face that does not consume a pane.
This lands with the child-layer registration work.

:::

### Declarations belong to the layer that carries them

A `foliplus={...}` block describes **one layer** — the layer it is written on. The
panel is built from one row per layer, and a row reads its declaration from its own
layer only. Nothing is inherited, nothing is looked up in a nested container.

That matters for containers. A `FeatureGroup` (or any other container layer) is its
own row, so its row reads only the block written on the group itself:

```python
# The group row reads its own declaration: the folder it groups into.
grp = folium.FeatureGroup(name="观测站", foliplus={"folder": "设施"})
folium.GeoJson(stations, name="站点").add_to(grp)
```

A declaration on a **child layer inside** the group belongs to that child; the
container row neither inherits it nor reports it as a mistake:

```python
grp = folium.FeatureGroup(name="观测站")
# Binds to the 站点 row, not to the 观测站 group row.
folium.GeoJson(stations, name="站点", foliplus={"label": {"field": "name"}}).add_to(grp)
```

**Behaviour**:

- A container row's facts come from the container's own block — its `folder`,
  `label`, `filter`, `zoom_range` and other keys describe the container row, never
  its children.
- A child layer's declaration stays with the child. It is not hoisted to the
  container, not treated as an error and not warned about: it applies when the child
  is rendered as its own row (a group expands into its child rows, see above).
- To declare something for the container row, write it on the container constructor.
  `FeatureGroup`, `LayerGroup` and `GeoJson` all forward `foliplus=...` into the
  layer, the same way `explore` does.
- This is deliberate. Downward inheritance would let a single declaration affect two
  independently addressable rows, which is exactly the double-sourced state this
  declaration pass removes. A page that relied on a child declaration reaching its
  container must move the block onto the container.

(fill)=

## `fill` — value-based or solid fill

Declares the layer's fill default: either a value-based classification or a
single solid colour with an opacity.

```python
# value-based fill: classify each feature by a field and paint it from a palette
gdf.explore(foliplus={"fill": {"field": "score", "scheme": "Reds"}})

# solid fill: one colour (and optional opacity) for the whole layer
gdf.explore(foliplus={"fill": {"mode": "solid", "color": "#ff0000", "opacity": 0.6}})
```

**Shape**: a **flat** mapping. A declaration names at most one mode: naming
`field` means value-based fill, naming `color` / `opacity` means solid
fill, and `mode` says which one explicitly — `"solid"`, `"value"` or
`"original"`. Naming neither a field nor a colour/opacity nor a mode drops
the declaration. The old nested `fill.ramp` shell is cancelled — it is now
an unknown key and ignored with a one-time warning.

| Key       | Default                                                          | Meaning                                  |
| --------- | ---------------------------------------------------------------- | ---------------------------------------- |
| `mode`    | inferred: `value` from `field`, `solid` from `color` / `opacity` | `"solid"` / `"value"` / `"original"`     |
| `field`   | required for value mode                                          | the feature property to classify         |
| `kind`    | inferred from the layer's own values                             | `numeric` / `category`                   |
| `method`  | `jenks`                                                          | `jenks` / `quantile` / `equal` / `heads` |
| `classes` | `6`                                                              | integer from 2 to 9                      |
| `scheme`  | `Viridis` (`Set3` for a category)                                | palette name                             |
| `color`   | the author's own colour                                          | solid-mode fill colour (CSS hex)         |
| `opacity` | the author's own opacity                                         | fill opacity from 0 to 1, on every mode  |

**Behaviour**: a value declaration classifies each feature by the field at
load — it does not flatten the layer to a single colour. A solid declaration
paints the one colour and opacity at load instead, and the solid row opens on
those values. The panel row opens on the declaration and Reset returns to it.
A user's stored mode always wins. When the declaration is invalid, it degrades
key by key (each rejected key warns once, the rest survives); a declaration
that contradicts itself (a value field with a solid colour, or the reverse)
drops whole. A declaration whose value column the data no longer offers steps
aside whole and falls back to the per-feature paint / built-in.

Value-based fill needs an areal geometry. Polygons, MultiPolygons, Rectangles
and circles repaint by value; a PolyLine takes a stroke colour instead; a
marker is an icon and has no fill to repaint.

(label)=

## `label` — text labels

Declares the layer's feature text labels.

```python
gdf.explore(foliplus={"label": {"field": "name", "collide": False}})
```

**Shape**: a mapping. `field` names the property to label; declaring it
turns the labels on. The optional keys:

| Key       | Default                    | Meaning                                       |
| --------- | -------------------------- | --------------------------------------------- |
| `format`  | `auto`                     | `auto` / `int` / `comma` / `percent`          |
| `color`   | `#ffffff`                  | hex only; `#rgb` normalised to `#rrggbb`      |
| `size`    | `11` px                    | clamped to 6-32 px                            |
| `collide` | page-level `label_collide` | whether labels take part in overlap avoidance |
| `show`    | `True` once field declared | explicit on/off                               |

**Behaviour**: declaring a field turns the layer's labels on (the built-in
default is off). An explicit `show: false` names a field for the panel's
starting point while keeping the map clean. Labels from different layers never
avoid each other — the layers are stacked, so an upper layer simply covers the
lower one's; the style panel overrides this per layer.

The block is normalised once on the Python side and the panel reads the
normalised record from CONF (not the raw namespace). A wrong type, an unknown
key or an unknown `format` warns once and is ignored; a `color` that is not a
hex warns and is ignored (a valid `#rgb` is expanded to `#rrggbb`); a `size`
outside 6-32 px warns and is clamped into that range. The rest of the block
still applies — one bad key does not discard its valid siblings.

(filter)=

## `filter` — value filter

Declares a filter the layer starts with: only features inside the range (or in
the value list) are shown.

```python
# numeric range
gdf.explore(foliplus={"filter": {"field": "pop", "min": 100, "max": 1000}})

# categorical enum
gdf.explore(foliplus={"filter": {"field": "cat", "values": ["A", "B"]}})
```

**Shape**: a mapping with a required `field` (a non-empty string naming a
feature property) plus exactly one of the two forms:

| Form  | Keys                         | Meaning                             |
| ----- | ---------------------------- | ----------------------------------- |
| range | `min`, `max`                 | only values in [min, max] are shown |
| enum  | `values` (a list of strings) | only values in the list are shown   |

**Behaviour**: the layer starts filtered. A declaration without a usable
`field`, with both `values` and `min`/`max`, or with an empty list
warns once and is ignored — the layer starts unfiltered, never
filtered-to-empty. An inverted range (`min > max`) is also ignored.

:::{note}

An `enum` filter's value names are not validated in Python — the runtime
(the JavaScript reader) is the one that rejects an unknown name, so a typo
in `values` surfaces at runtime rather than at declaration time.

:::

(border)=

## `border` — border default mode and stroke

Declares the border mode default for the layer, and the solid stroke's colour
and width: the panel and the map read them as read-time defaults under the
user's stored choice.

```python
# follow the fill mode (the author's border follows whatever the fill does)
gdf.explore(foliplus={"border": {"mode": "follow_fill"}})

# value mode: paint the border by a field
gdf.explore(foliplus={"border": {"field": "score"}})

# solid stroke: one colour and width for the whole layer
gdf.explore(foliplus={"border": {"mode": "solid", "color": "#ff0000", "weight": 3}})
```

**Shape**: two declaration shapes converge to one canonical form:

| Form       | Keys                                                                       | Meaning                         |
| ---------- | -------------------------------------------------------------------------- | ------------------------------- |
| mode-shell | `mode`: `"follow_fill"` / `"value"` / `"solid"` / `"original"`             | explicit mode                   |
| flat       | `field` (implicit value mode), or `color` / `weight` (implicit solid mode) | shorthand for the matching mode |

`mode`, when present, is authoritative: a `mode` + `field` combination
(or a solid `mode` + `color` / `weight`) is contradictory and invalid.
A `follow_fill` shell never carries a field; a `value` mode requires a
field; `color` is a solid-mode value (CSS hex) and `weight` is a positive
stroke width in pixels that rides every mode.

**Behaviour**: a usable declaration paints the border in the declared mode by
default — a solid declaration's `color` / `weight` are also the border
row's read-time defaults, so Reset returns to them. When the declaration is
invalid it warns once and is ignored — the border stays on its derived
default (original/solid). The flat value form reuses the same schema as
`fill` (`field` plus optional `method` / `classes` / `scheme` /
`kind`).

(marker_color)=

## `marker_color` — marker chassis colour

Declares the marker chassis colour: either one of the 19 awesome-markers sprite
preset names, or a CSS hex.

```python
gdf.explore(foliplus={"marker_color": "red"})
gdf.explore(foliplus={"marker_color": "#00A6A6"})
```

**Shape**: a non-empty string naming one of the 19 preset chassis colours
(`red`, `darkred`, `lightred`, `orange`, `beige`, `green`,
`darkgreen`, `lightgreen`, `blue`, `darkblue`, `lightblue`,
`purple`, `darkpurple`, `pink`, `cadetblue`, `white`, `gray`,
`lightgray`, `black`), or a CSS hex (`#rgb` / `#rrggbb`).

**Behaviour**: the marker chassis paints in the preset colour, or directly in a
declared hex (`#rgb` is expanded to `#rrggbb` and lowercased). A non-string or
blank name warns once and is ignored. Whether a name is one of the runtime's
presets (or a valid hex) is the JavaScript reader's verdict — an unknown preset
name or a malformed hex warns once and degrades to the derived default (the
panel's built-in blue), never an unvalidated colour.

A hex is distinct from the folium `Icon(color='#00A6A6')` kwarg (folium
`>=1.0.0`; earlier releases only accept the preset names and warn on a hex):
that kwarg paints the author's icon directly, while `marker_color` is the
`foliplus={}` declaration read-time default a panel pick and Reset return to.
When both are present the author's painted colour wins (the declaration is the
lower-priority default).

:::{note}

The authoritative preset list lives in `markerColorPreset.ts`
(`foliplus/js/core/leaflet/`) — this page lists it for readability and
drifts if the runtime set changes.

:::

(icon_size)=

## `icon_size` — marker icon pixel size

Declares the marker icon pixel size (the whole-icon box edge the marker
construction scales to).

```python
gdf.explore(foliplus={"icon_size": 50})
```

**Shape**: a positive whole number of pixels.

**Behaviour**: the marker icon scales to the declared size. A non-integer,
non-finite, zero, negative or boolean value warns once and is ignored — the
marker keeps its built-in pixel size rather than scaling to a value the author
never saw validated. folium's {class}`Icon` exposes no pixel-size channel, so
this is a foliplus-only declaration the JavaScript runtime scales the marker
icon by.

(opacity)=

## `opacity` — whole-layer opacity

Declares the whole-layer opacity (a 0-1 float, the unit Leaflet's opacity
options use) as the **read-time default** the panel opacity slider starts at
and Reset returns to. It is not a draw override: folium's own `opacity=`
keyword remains the author's draw value and is read first, so the two channels
never fight — a layer that declares both draws the folium value but shows the
declared one in the panel.

```python
gdf.explore(foliplus={"opacity": 0.6})
```

**Shape**: a number from 0 (fully transparent) to 1 (fully opaque). A bool, a
non-finite value or a value outside the closed interval warns once and is
ignored — the panel keeps its derived default rather than showing a value the
author never saw validated.

```{note}
Like the `icon` / `marker` face declarations below, this is a channel where a
declared value is NOT painted: the layer is already drawn with the author's `opacity=`.
The declaration is a UI default for the panel's slider.
```

(icon_face)=

## `icon` / `marker` face — glyph, colour and alpha

The `icon` face declaration sets the marker **icon face** as read-time defaults:
`glyph` (a FontAwesome name), `color` (a CSS hex for the glyph) and
`colorOpacity` (a 0-100 integer percent, the glyph alpha). The `marker` face
declaration carries the **chassis** alpha only (`colorOpacity`); the chassis
colour is the `marker_color` key's business.

Both spellings of the multi-word sub-key are accepted — `colorOpacity` and
the Python `color_opacity` — and both sides normalise to `colorOpacity`
(folium camelizes every option key at render time, so a rendered map only ever
carries the camelCase form; the snake spelling is accepted for hand-built
namespaces). The accepted sub-keys are exactly:

| Face     | Sub-key        | Type          | Meaning                          |
| -------- | -------------- | ------------- | -------------------------------- |
| `icon`   | `glyph`        | str           | FontAwesome glyph name.          |
| `icon`   | `color`        | str (`#hex`)   | Glyph colour.                    |
| `icon`   | `colorOpacity` | int 0-100     | Glyph alpha.                     |
| `marker` | `colorOpacity` | int 0-100     | Marker chassis alpha.            |

```python
gdf.explore(
    foliplus={
        "icon": {"glyph": "star", "color": "#ff0000", "color_opacity": 60},
        "marker": {"color_opacity": 40},
    }
)
```

Like the whole-layer `opacity` these are **read-time defaults** (the row
starts there and Reset returns to it), never draw overrides: the glyph and
colour drawn on the map are what the author's {class}`folium.Icon` paints
until the user writes one — a declared value is not re-painted on attach. A
user's panel pick always wins over the declaration; a declaration beats the
author's drawn value in the panel row and reset chain.

**Shape**: a malformed sub-key warns once and is **dropped alone** (its valid
siblings survive); a non-mapping face warns once and is ignored. An unknown
sub-key warns too, naming the accepted ones — so a typo never passes silently.
The spelling rule is one rule on both stacks: a string value is trimmed before
it is validated (a padded `" star "` / `" #ff0000 "` is the same declared
value), and the trim set is the **union** of the two hosts' whitespace sets
rather than either host's default — the C0 controls U+0009-U+000D, the separators
U+001C-U+001F and U+0085, U+0020, U+00A0, U+1680, U+2000-U+200A, U+2028/U+2029,
U+202F, U+205F, U+3000 and U+FEFF (a BOM pasted from a CSV). That union is what
makes a value pasted from rich text or CJK input accepted identically on both
stacks; it is the only trim on the colour path (no host `strip()` follows it). A
declared `null` sub-key value is unusable and warns on both sides, never
silently "not declared". When a sub-key is written twice the
**first** occurrence decides —
the duplicate always warns and is dropped, even when the first value was
unusable, so the two readers can never disagree on which spelling won. Every
warning names its layer, so a console line or a Python `UserWarning` locates
the authoring layer.

```python
gdf.explore(foliplus={"icon": {"colour": "#ff0000"}})
# LayerControl: layer '...' declares foliplus['icon']['colour'] as an unknown
#   icon sub-key 'colour'; expected one of ['glyph', 'color', 'colorOpacity'] - ignored
```

A `glyph` must be a non-empty string, a `color` a `#rgb` / `#rrggbb` hex,
and a `colorOpacity` a whole number from 0 to 100; a value of the wrong shape
warns once, is dropped, and leaves the rest of the face in effect.

(icon_source)=

## Icon source (glyph / URL / divIcon shape)

The marker **icon source** — the shape drawn on the map — is declared on the
marker's own {class}`folium.Icon` (or a Leaflet {class}`L.divIcon`). The
panel reads it as the layer's "author icon" and offers three sources:

The glyph, its colour and its alpha can ALSO be declared as read-time
**panel defaults** in the `foliplus` namespace ({ref}`icon_face`); the
drawn source above stays the look on the map until the user writes a panel
value, and Reset returns to the declared default when one exists.

### Glyph

The FontAwesome glyph name, written as the icon's glyph name:

```python
import folium

gdf.explore(icon=folium.Icon(icon="star", prefix="fa-solid"))
```

The panel renders the glyph under the author's prefix
(`leaf.options.icon.options.prefix`), falling back to the panel family. A
syntactically invalid glyph name is surfaced (never silently read as
"Original").

### URL

A remote or inline raster image, written as the icon's URL:

```python
gdf.explore(icon=folium.Icon(icon="https://example.com/pin.png"))
```

The URL is accepted on a strict whitelist — `https?://` and
`data:image/(png|jpeg|gif|webp);base64,`. SVG is excluded on purpose
(`data:image/svg+xml` can carry script), as are `data:text/html` and
`javascript:`. A non-matching URL is ignored (the panel degrades to the
FontAwesome glyph), never rendered at all.

:::{note}

The whitelist regex lives in `iconSource.ts` (`foliplus/js/core/leaflet/`) —
this page states the policy; the code owns the exact pattern.

:::

### divIcon shape

An authorized shape class name, written as a Leaflet divIcon:

```python
import folium
from folium.plugins import Marker

Marker(
    location=[31.2304, 121.4737],
    icon=folium.Icon(divIcon_class_name="foliplus-shape-pin"),
)
```

Only two shape keys are whitelisted — `pin` and `square` — mapped to their
registered CSS class names. Any other class name degrades to the FontAwesome
glyph, never an arbitrary CSS class.

The panel's icon picker exposes all three sources; a URL source hides the
colour rows (an `<img>` cannot inherit colour, and the divIcon paints only
its plain-text glyph).
