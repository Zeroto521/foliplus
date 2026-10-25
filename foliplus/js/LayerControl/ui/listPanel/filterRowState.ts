// LayerControl UI — per-row filter projection.
//
// The filter owner may live on a different row than the records it narrows:
// HeatmapControl's canvas row owns the filter, while the filtered records are
// its source point layer. The panel stays on the owner's row (that is where
// the capability lives) but the funnel + kept count belong to the DATA row,
// so the owner reports `sourceId` in its model and this module keeps the one
// derived fact the row painter needs.
//
// The map is a cache, never a source of truth: every LAYER_FILTER_CHANGE
// re-reads the owner through its `filterProvider`. Teardown clears it so a
// re-created UI cannot inherit the previous map's rows.

/** The filtered fact painted on one data row. */
interface FilterRowState {
  kept: number;
  total: number;
}

/** owner row id → painted (data) row id. A source switch moves the target. */
const owners = new Map<string, string>();
const states = new Map<string, FilterRowState>();

/** The filtered fact for one row, or undefined when it is unfiltered. */
const filterRowStateOf = (layerId: string): FilterRowState | undefined =>
  states.get(layerId);

/** Re-read the owner behind `layerInfo` and update the painted row.
 *  Returns every row id that needs a repaint (the previous and the current
 *  target — a source switch moves the funnel without leaving a stale one). */
const syncFilterRowState = (layerInfo: LayerInfo): string[] => {
  const repaint = new Set<string>();
  const previous = owners.get(layerInfo.id);
  if (previous) {
    states.delete(previous);
    repaint.add(previous);
  }
  const provider =
    typeof layerInfo.filterProvider === "function" ? layerInfo.filterProvider : null;
  const model = provider?.() ?? null;
  if (model?.filter) {
    const target = model.sourceId ?? layerInfo.id;
    states.set(target, { kept: model.kept, total: model.total });
    owners.set(layerInfo.id, target);
    repaint.add(target);
  } else {
    owners.delete(layerInfo.id);
    repaint.add(layerInfo.id);
  }
  return Array.from(repaint);
};

/** Drop every cached fact — unbindEvents teardown. */
const clearFilterRowStates = (): void => {
  owners.clear();
  states.clear();
};

export { clearFilterRowStates, filterRowStateOf, syncFilterRowState };
