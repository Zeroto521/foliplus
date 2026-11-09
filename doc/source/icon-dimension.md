# Icon dimension

The LayerControl style drawer has an **Icon** row for marker layers (a layer whose leaves expose a
runtime `setIcon`). It applies **one glyph to every marker leaf in the layer** — a whole-layer choice,
no per-category assignment.

## How the row behaves

- The row shows a **trigger button**: the current glyph, the layer author's original icon (labelled
  「原始 / Original」) when the user has not chosen one.
- Clicking the trigger opens a **grid picker**: a 2D matrix of glyph cells. Click a cell to apply it
  (and close); arrow keys move 2D, Enter/Space activates, Home/End jump, Esc closes, outside click closes.
- The grid is keyboard-accessible (role=grid / gridcell).
- Choosing a glyph writes a single `icon` intent for the layer and replays it across every marker leaf.
  The author's original icon per leaf is captured on first write, so **Reset** restores exactly what the
  author drew, and a layer the user never touched keeps exactly the author-declared icon.

## Supported glyphs

The panel provides a fixed set of **40 Font Awesome 6** glyph names (solid family, the default).

| circle | square | diamond | star |
| heart | flag | cross | map-pin |
| location-dot | location-arrow | compass | map |
| globe | plane | paper-plane | camera |
| tag | bookmark | bell | book |
| envelope | fire | leaf | music |
| phone | tree | gear | triangle-exclamation |
| circle-info | circle-check | circle-xmark | xmark |
| plus | minus | arrow-up | arrow-down |
| arrow-left | arrow-right | house | magnifying-glass |

> All names are FA6 6.2.0 solid. The panel renders `fa-solid`; a FA4 `-o` (outline/regular) name maps to
> `fa-regular` (see the migration table below) and will **not** render in the panel's solid family.

## Matching your own folium.Icon

When you write `folium.Icon(icon="xxx", prefix="fa")`, folium emits `<i class="fa fa-xxx">` via
awesome-markers. The panel's glyph names are **FA6 solid** names — if your `icon` value is one of the 40,
the panel shows it as the layer's current glyph. Any other FA6 name is still usable as the author's icon
but is **not in the panel's grid** (the panel only offers the fixed 40).

## Unsupported names: the unavailable hint

When a chosen or author-declared name is **not actually painted** by the loaded stylesheet — a
syntactically valid name the FA6 set does not contain, or a name that fails glyph syntax — the trigger no
longer silently shows the author-original label. It shows an explicit **unavailable state**: a
dashed-outline circle preview, the **original** name, and a tooltip / aria-label explaining that the icon
name is not supported and the original icon is kept.

> This replaces the earlier behavior where an unrecognized name silently fell back to a circle glyph.

## FA4 to FA6 migration

Font Awesome changed names between FA4 (the awesome-markers era most folium code uses) and FA6 (what
folium now loads). This panel uses **FA6 names**; there is **no alias compat** implemented — the table
below is documentation only, to help you migrate an existing `folium.Icon(icon="...")` value.

| FA4 (old)       | FA6 (new)                  |
| --------------- | -------------------------- |
| star-o          | fa-regular fa-star         |
| star-half-o     | fa-star-half-stroke        |
| heart-o         | fa-regular fa-heart        |
| bookmark-o      | fa-regular fa-bookmark     |
| envelope-o      | fa-regular fa-envelope     |
| check-circle-o  | fa-regular fa-circle-check |
| check-square-o  | fa-regular fa-square-check |
| circle-o        | fa-regular fa-circle       |
| flag-o          | fa-regular fa-flag         |
| bell-o          | fa-regular fa-bell         |
| square-o        | fa-regular fa-square       |
| triangle        | fa-triangle-exclamation    |
| map-o           | fa-map                     |
| clock-o         | fa-clock                   |
| calendar-o      | fa-calendar-days           |
| user-o          | fa-regular fa-user         |
| comment-o       | fa-regular fa-comment      |
| file-o          | fa-regular fa-file         |
| file-text-o     | fa-file-lines              |
| folder-o        | fa-regular fa-folder       |
| folder-open-o   | fa-folder-open             |
| pencil-square-o | fa-pen-to-square           |
| trash-o         | fa-trash-can               |
| dot-circle-o    | fa-circle-dot              |
| outbox          | fa-paper-plane             |
| hand-up         | fa-hand-point-up           |
| hand-down       | fa-hand-point-down         |
| hand-left       | fa-hand-point-left         |
| hand-right      | fa-hand-point-right        |
| resize-full     | fa-expand                  |
| resize-small    | fa-compress                |
| tree-conifer    | fa-tree                    |
| tree-deciduous  | fa-tree-city               |
| money           | fa-money-bill-wave         |
| building-o      | fa-building                |
| hospital-o      | fa-hospital                |
| glass           | fa-martini-glass           |
| flask-o         | fa-flask                   |
| beaker          | fa-flask                   |
| bar-chart-o     | fa-chart-column            |
| indent-left     | fa-outdent                 |
| indent-right    | fa-indent                  |
| comments-o      | fa-regular fa-comments     |

> ⚠ The FA4 `-o` (outline/regular) names need the **fa-regular** family class. The panel paints the solid
> family by default, so a regular-only glyph name will **not** render in the panel. Use the solid
> replacement instead (e.g. `star-o` → `star`).

## Icon row vs. fill / label rows

- The Icon row is **only for marker layers** (a canvas/leaf with no `setIcon` has no icon capability).
- It is **separate** from fill (a polygon's fill color/ramp) and from **text labels** (the `label`
  annotation config). An icon is a marker's glyph; fill paints area; a label draws text.

## Icon Color

The style drawer also has an **Icon Color** row, immediately below the **Icon** row. It is a
whole-layer choice like the glyph: pick one color from the swatch and every awesome-markers marker
leaf in the layer paints that glyph color. The color and the glyph are orthogonal — both merge into a
single derived icon, so changing one keeps the other.

The row is only available for an **awesome-markers** carrier (a marker whose icon has a glyph-color
face). A plain `divIcon` / `iconUrl` marker has no icon-color capability, so the row is hidden for it.
The panel path is **⋮ (layer menu) → Style → Icon Color**.

## Quickstart example

```python
import folium

m = folium.Map()
# Author-declared icon (FA6 solid name works; FA4 names need the migration table above)
folium.Marker([31.23, 121.47], icon=folium.Icon(icon="map-pin", prefix="fa")).add_to(m)
LayerControl().add_to(m)
m.save("map.html")
```

The quickstart notebook (`doc/source/quickstart.ipynb`) uses `icon="map-pin", prefix="fa"`.
