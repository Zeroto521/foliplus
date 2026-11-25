# Layer Control Guide

The {class}`~foliplus.LayerControl` is the command centre of a foliplus map:
every layer on the map gets a row in a panel, and from that row you toggle
visibility, reorder, group into folders, restyle, filter and rename the layer.

This guide is **task-oriented**: each section follows one thing you want to do,
with the smallest Python setup that gets you there and a description of what
you see on the panel. The per-layer declaration keys
(`foliplus={...}`) that set _author defaults_ are documented separately on the
{ref}`declaration <fill>` page — read that page for the full key reference.

:::{note}

A foliplus map is read-only for the data: foliplus styles and filters what is
on the map, it never edits or uploads the underlying dataset. Data preparation
happens upstream (GeoPandas, a database, a file).

:::

## Adding the panel

Add the control to any {class}`folium.Map`:

```python
import folium
from foliplus import LayerControl

m = folium.Map(location=[31.23, 121.47], zoom_start=11)
LayerControl().add_to(m)
m.save("map.html")
```

**What you see.** A layer button (stacked-layers glyph) appears on the top
right of the map. Click it to open the panel.

The panel lists every layer on the map as a row, split into two role sections:

- **Base Maps** — the tile layers (a GeoPandas `explore` default basemap is a
  tile layer, so it lands here).
- **Data Layers** — everything else (points, lines, polygons, images, custom
  layers).

Each row shows the layer's geometry icon, its display name, a visibility
checkbox, a drag handle, and a `⋮` (more) button that opens the row menu. The
row also shows a feature count, and the count gains a filter glyph when the
layer is filtered. The geometry icon carries a small type badge (Point, Line,
Polygon, Tile, Custom, or the group glyph for a folder).

The panel is collapsed by default. Click the button again (or the collapse
arrow) to close it.

**Control-level options.** `LayerControl` accepts a few options that shape
the whole panel:

- `position` — which map corner the panel attaches to (`"topleft"`,
  `"topright"`, `"bottomleft"`, `"bottomright"`; default `"topleft"`).
- `folders=` — declare folder **defaults** (display name and default folded
  state) at the control level; membership still comes from each layer's
  `foliplus={"folder": ...}` declaration. See
  {ref}`central folder defaults <folders>`.
- `label_collide` — page-wide default for a layer's "avoid overlap" label
  setting (default `True`).
- `icon_prefix` — the FontAwesome family class prefix the panel uses for
  glyph icons (`"fa-solid"` or `"fa-regular"`; default `"fa-solid"`).
- `collapse_on_outside` — whether a press outside the panel collapses it
  (default `False`; the panel is a working surface read at the same time as
  the map).

See the API reference for the full signatures.

## Showing and hiding layers

### Toggle one layer

Check or uncheck a row's checkbox:

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

gdf = gpd.read_file("districts.geojson")
m = gdf.explore(column="name", cmap="Set3")
LayerControl().add_to(m)
m.save("map.html")
```

**What you see.** Checking a row makes the layer visible; unchecking hides it.
The checkbox is a live switch — the map updates immediately, no reload needed.
Hiding a layer does not delete it; the row stays in the panel.

### Select all layers in a role

Each role section (Base Maps / Data Layers) has a **select-all** toggle next
to its heading:

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

# Two data layers — the select-all toggle covers both.
m = folium.Map()
gpd.read_file("roads.geojson").explore(m=m, color="#555555")
gpd.read_file("pois.geojson").explore(m=m, marker_kwds={"radius": 4})
LayerControl().add_to(m)
m.save("map.html")
```

**What you see.** The role heading has a small checkbox. Checking it shows
every layer in that role; unchecking hides them all. The toggle is tri-state:
it reads checked when all are visible, unchecked when none are, and a dash
when only some are.

## Reordering layers

Drag a row by its drag handle (the `⋮⋮` grip) to move it within its role:

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

m = folium.Map()
gpd.read_file("basemap.geojson").explore(m=m, style_kwds={"weight": 0})
gpd.read_file("points.geojson").explore(m=m)
LayerControl().add_to(m)
m.save("map.html")
```

**What you see.** The row follows the pointer while you drag. The panel shows
an insertion line at the drop target. When you release, the layer's position
in the Leaflet render order updates to match the new row order — a layer
dragged to the top draws above the layers below it.

**Constraint.** A layer can only be reordered within its own role. You cannot
drag a Base Map into the Data Layers section (or vice-versa); the panel shows a
small "reordering is only allowed within the same group" message if you try.

## Row actions

The `⋮` menu on a row opens the actions for that layer.

### Zoom to a layer

Double-click a row, choose **Focus** from its `⋮` menu, or press
Alt + Enter (Cmd + Enter on macOS) — the three are equivalent. The map zooms
to the layer's extent, drawing a dashed rectangle around it. A hidden layer
shows a hint instead of zooming, and a component that currently holds the map
(measuring, exporting, searching, locating) blocks the zoom with a hint.

### Rename a layer

Choose **Rename** from the row's `⋮` menu. The label turns into an inline
input; press Enter (or click away) to commit a non-empty name, Escape to
cancel.

### Attributes panel

Choose **Attributes** from the row's `⋮` menu. The panel shows read-only
details about the layer — its source, type, feature count and timestamps. This
is the only row action that never writes state.

### Delete a layer / Clear Data

The last `⋮` entry deletes the layer, with a two-step confirmation: the
first click turns the entry into a confirm label (**Delete layer** →
**Confirm Delete**), and the second click within three seconds actually
deletes it. For a layer owned by a foliplus component (a Measure or Heatmap
result) the entry reads **Clear Data** instead — it clears the component's
data without retiring the layer.

## Grouping layers into folders

A folder is a grouping _intent_ declared by the author, not something a user
creates at runtime. The map author decides which layers belong to a folder and
what it is called; the panel only lets you fold, rename and delete it.

### Where folders come from

A layer declares its folder up front, on the layer itself:

```python
import geopandas as gpd

gdf = gpd.read_file("districts.geojson")
gdf.explore(foliplus={"folder": "底图"})
```

Two layers declaring the same folder name in the same role are grouped into
one folder. Folder names group case-insensitively after whitespace folding, so
`"Basemap"` and `"basemap"` land in one folder. See the
{ref}`declaration <folder>` page for the full rule.

The control-level `LayerControl(folders=...)` option does **not** declare
membership — it only sets a folder's display name and default folded state.
A layer joins a folder through its own `foliplus={"folder": ...}` declaration
and through nothing else. See {ref}`central folder defaults <folders>` for the
two-channel split and a complete example.

### Fold and unfold

Click the folder's collapse chevron. A folded folder hides its member rows and
shows the member count on the group row. The fold state is remembered — see
{ref}`persistence`.

### Rename a folder

Open the folder's `⋮` menu and choose **Rename**. Type the new name and press
Enter (or Escape to cancel).

### Delete a folder

Open the folder's `⋮` menu and choose **Delete folder**. The member layers
move back to the role root; the folder itself is removed. Confirmation is not
required to delete a folder (the layers are not deleted — they just return to
the role's root).

:::{note}

A folder is a grouping _intent_, not a data container: deleting a folder never
touches the layers or the underlying data.

:::

## Styling a layer

Open a row's `⋮` menu and choose **Style**. The style drawer opens with the
dimensions this layer supports (a point layer offers icon and marker colour; a
polygon layer offers fill, border, opacity and labels).

### Fill by value

Colour each feature by a numeric field, using a classification method and a
palette:

```python
import geopandas as gpd

gdf = gpd.read_file("districts.geojson")
gdf.explore(
    column="score",
    foliplus={
        "fill": {"field": "score", "method": "jenks", "classes": 5, "scheme": "Reds"}
    },
)
```

**What you see.** In the style drawer, set **Fill** to **By value** and pick a
**Field**. The layer repaints per feature: each feature gets a colour from the
selected **Scheme** based on the classification (`jenks`, `quantile`,
`equal`, `heads`) and class count (2–9).

A layer may also declare a value-based fill on the layer itself, so the
classification applies at load — see the {ref}`declaration <fill>` page.

### A single fill colour

Set **Fill** to **Solid** and pick a colour. The whole layer paints that one
colour.

### Keep the original paint

Set **Fill** to **Original**. The layer returns to its own per-feature paint
(the colours GeoPandas `explore` baked in, or the layer's built-in style).

### Border

Use the **Border** row to set a stroke colour and weight. The border mode is
not a separate control: it follows the fill mode. When **Fill** is **Solid**
or **Original** the border uses its own colour; when **Fill** is **By value**
the border is derived from the fill (the border colour you set is a modifier
on the per-feature fill colour).

### Opacity and zoom range

Use the **Opacity** slider to make the layer translucent. Use the **Zoom
Range** control to set the zoom levels where the layer is visible:

```python
import geopandas as gpd

gdf = gpd.read_file("districts.geojson")
gdf.explore(foliplus={"zoom_range": {"min": 9, "max": 15}})
```

A declared zoom range opens the row on that range; the user's stored range
always wins. See the {ref}`declaration <zoom_range>` page.

### Text labels

Turn on **Label** and pick a field. Labels render on each feature with the
selected colour, size, and number format. Set **Collide** to enable overlap
avoidance.

```python
import geopandas as gpd

gdf = gpd.read_file("districts.geojson")
gdf.explore(foliplus={"label": {"field": "name", "collide": False}})
```

See the {ref}`declaration <label>` page.

### Icon

A marker layer's **Icon** row picks the marker glyph and colour. The icon
picker offers the FontAwesome glyph library, the author's icon (if the layer
declares one), a URL image, and the two divIcon shapes (`pin`, `square`).
See the {ref}`declaration <icon_source>` page.

### Reset

The style drawer has a **Reset** action. It returns every style dimension to
the layer's _author declaration_ — the value the author set on the layer (via
`foliplus={...}` or the GeoPandas `explore` call). A dimension with no
author declaration resets to the built-in default. Reset does not touch
visibility or folder.

## Filtering a layer's features

Filter the features a layer shows, without touching the data.

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

gdf = gpd.read_file("points.geojson")
m = gdf.explore(column="score", cmap="viridis")
LayerControl().add_to(m)
m.save("map.html")
```

**What you see.** Open the row's `⋮` menu and choose **Filter**. The filter
panel opens with the layer's filterable fields. A filter is **single
condition**: you pick one field and set one condition on it.

- A **numeric** field offers a **Range** — drag the two sliders to set a
  minimum and maximum. Features outside the range are hidden.
- A **categorical** field offers **Values** — a multi-select list. Only the
  selected values stay visible.

The panel shows a **Result** readout — for example `68% (34 of 50) kept` —
so you can see how many features the filter keeps.

### Clear a filter

Click **Clear** in the filter panel. The layer shows all its features again.
Clear is a no-op when there is no filter (the Clear button is disabled and
shows "No filter to clear").

### Declare an initial filter

A layer can declare a starting filter on the layer itself, so the map loads
already filtered:

```python
import geopandas as gpd

gdf = gpd.read_file("points.geojson")
gdf.explore(foliplus={"filter": {"field": "score", "range": [40, 80]}})
```

See the {ref}`declaration <filter>` page for the `range` / `values` forms
and the Clear semantic.

(persistence)=

## Persistence

The panel remembers what you did across reloads. Open the map again (or press
refresh) and the panel comes back the way you left it.

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

gdf = gpd.read_file("districts.geojson")
m = gdf.explore()
LayerControl().add_to(m)
m.save("map.html")
```

**What persists** — stored per map URL, so the state follows the map you
opened:

| State            | Persists | Notes                                           |
| ---------------- | -------- | ----------------------------------------------- |
| Layer order      | ✅       | the row order you dragged to                    |
| Layer visibility | ✅       | checked / unchecked per layer                   |
| Folder folds     | ✅       | which role / author-folder blocks are collapsed  |
| Folder names     | ✅       | a renamed folder keeps its name                 |
| Layer names      | ✅       | a renamed layer keeps its name                  |
| Styles           | ✅       | fill, border, icon, opacity, zoom range, labels |
| Filters          | ✅       | the filter condition per layer                  |

A user's stored value **always wins** over the author declaration: if you
change a style in the panel and the author later changes the declaration, the
panel keeps your choice. Only **Reset** (style) or **Clear** (filter) returns
the layer to the author's declaration.

:::{note}

Stored state is erased only by an explicit delete, never by a reload. A stored
row for a layer that no longer exists is skipped, not dropped, so it can come
back if the layer reappears.

:::

## Keyboard shortcuts

When the panel is open and a layer row has focus, the row supports a keyboard
model. The arrows move focus between rows; the actions below operate on the
focused row.

| Key            | Action                                                                        |
| -------------- | ----------------------------------------------------------------------------- |
| ↑ / ↓          | move row focus up / down                                                      |
| ← / →          | toggle the focused layer's visibility (← deselect, → select)                  |
| Space          | toggle the focused layer's visibility                                         |
| Enter          | toggle the focused layer's visibility                                         |
| Ctrl + ↑ / ↓   | move the focused layer one position up / down in its role                     |
| Alt + Enter    | zoom the map to the focused layer's extent (same as double-click)             |
| Escape         | close the open rename, menu, attributes, filter or style panel                |
| Double-click   | zoom the map to that layer's extent (dashed rectangle)                        |

**What you see.** A focused row shows a focus outline. The arrow keys move the
focus without activating anything; the action keys trigger the focused
control. Pressing Escape closes the style or filter drawer and returns focus
to the row.

On macOS, Cmd acts as the modifier key instead of Ctrl (Cmd + ↑ / ↓, Cmd +
Enter).
