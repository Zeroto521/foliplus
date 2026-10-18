() => {
  const map = window.map;
  if (!map) return { error: "no window.map" };
  const api = map.foliplus && map.foliplus.LayerAPI;
  if (!api) return { error: "no LayerAPI" };

  // Resolve the real registry id for "B" — folium names are not registry
  // ids (those are Leaflet _leaflet_id / folium element ids).
  const idxB = api.layers.findIndex(l => l.name === "B");
  if (idxB < 0) return { error: "no layer named B" };
  const idB = api.layers[idxB].id;

  const read = () => ({
    entries: { ...map.attributionControl._attributions },
  });

  const result = { steps: [] };
  result.initial = read();

  // Move B above A: B is now at registry index 0 (topmost), so B's
  // attr should win.
  const up = api.moveLayerUp(idB);
  result.steps.push({ action: "moveUp", ok: up, state: read() });

  // Move B back below A: A is at index 0 again, so A's attr wins.
  const down = api.moveLayerDown(idB);
  result.steps.push({ action: "moveDown", ok: down, state: read() });

  return result;
};
