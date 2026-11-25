# Folder declarations

How a downstream author puts panel rows into folders: the per-layer
`folder=` membership key, the `LayerControl(folders=...)` metadata
channel, and how the two compose with the user's own fold state. The exact
schema — which keys are legal, what happens when one is not — lives in the
`folder` and `folders` reference sections of {doc}`declaration`; this
page is the narrative that ties them together.

```python
import folium
import geopandas as gpd
from foliplus import LayerControl

m = folium.Map(location=[31.23, 121.47], zoom_start=10)

# 1. Metadata: declare the folders once — display name + default folded state.
#    Keyed by role, because a base folder and an overlay folder may share a name.
folders = {
    "base": [{"name": "底图", "folded": True}],
    "overlay": [{"name": "数据", "folded": False}],
}

# 2. Membership: each layer names its own folder. These are the only
#    declarations that put a row inside a folder.
gpd.read_file("basemap.geojson").explore(m=m, name="底图", foliplus={"folder": "底图"})
gpd.read_file("roads.geojson").explore(m=m, name="道路", foliplus={"folder": "数据"})

LayerControl(folders=folders).add_to(m)
m
```

## Two channels, one mental model

| Channel | Owns | Does not do |
| ------- | ---- | ----------- |
| `foliplus={"folder": ...}` on a layer | **membership** — which folder the layer's row groups into | set the folder's default folded state |
| `LayerControl(folders=...)` | **metadata** — the folder's display name and default folded state, per role | create a folder, move a layer into one, or order folders |

Membership is declared per layer and nowhere else. The control-level
`folders=` never moves a layer into a folder; a `folders=` entry whose
name no layer claims warns once and has no visible effect.

## Folders are a flat namespace

A folder name is a flat label, **not a path**. There is no `父/子` syntax:
a `/` in a declared name is an ordinary character, so
`foliplus={"folder": "父/子"}` is a folder literally named `父/子`, not
a nested one. v1 knows no `parent` key — the `folders=` schema accepts
`name` and `folded` only.

Grouping is by name after the normalisation fold (NFC → whitespace-fold →
trim → casefold): two layers naming `"数据"` land in one folder, and
`"数据"` / `"DATA"` / `" 数据 "` are the same folder. The folder keeps
the first spelling it saw (trimmed) as its display name.

The reason is deliberate: a folder is a panel **grouping row**, not a
directory tree. If you need a physical hierarchy, that is folium's own
container world (`FeatureGroup` / `LayerGroup`), not the folder
declaration — see {doc}`folium-integration` and {ref}`group_rows`.

## Control layers

A control layer's own layer — the heatmap surface, the measurement geometry —
is a row in the panel too, so it can land in a folder. `HeatmapControl` and
`MeasureControl` take a `folder=` argument for exactly that:

```python
foliplus.HeatmapControl(folder="Analysis").add_to(m)
foliplus.MeasureControl(folder="Analysis").add_to(m)
LayerControl(folders=[{"name": "Analysis"}]).add_to(m)
```

A folder a user drags the row into always wins: the panel persists that
membership per layer id, and a persisted membership is read before the
author's declaration. Removing the row from the folder (dragging it back to
the root) persists too, so the declaration does not pull it back on reload.

## What wins when a folder folds

A folder starts **expanded** unless someone folds it. The effective state is
a three-level chain, most-specific wins:

1. the **user's own fold / expand** (persisted — an explicit expand beats an
   author fold, so a folded folder can always be opened by hand),
2. the **author's `folders=` `folded` default**,
3. the **built-in expanded**.

A user's manual fold **or** expand wins over the author default; Reset clears
the user override back to the author default.

:::{note}

`folders=` does not order folders. A folder's block sits at its first
member layer's registration position; a user's drag order wins afterwards.

:::
