() => {
  // Build a deep overlay stack so the layer-z band climbs past the old
  // scale z of 850 (Z_INDEX.BASE 600 + STEP 10; ~25 layers reach 850).
  // Each createCanvas call lands on its own pane priced by zFor, so 30
  // layers put the top pane at 600 + 30*10 = 900.
  //
  // folium names the map uniquely (`var map_xxx = L.map(...)`); recover it
  // from the page the same way read_map_name does, then look up LayerAPI.
  let map = window.map || window.__map;
  if (!map || !map.foliplus) {
    for (const s of document.querySelectorAll("script")) {
      const m = s.textContent.match(/var\s+(map_\w+)\s*=\s*L\.map\(/);
      if (m && window[m[1]] && window[m[1]].foliplus) {
        map = window[m[1]];
        break;
      }
    }
  }
  const api = map && map.foliplus && map.foliplus.LayerAPI;
  if (!api || typeof api.createCanvas !== "function") {
    return { ok: false, why: "LayerAPI.createCanvas unavailable", hasMap: !!map };
  }
  for (let i = 0; i < 30; i++) {
    const cvs = api.createCanvas({
      id: `__deep_stack_${i}__`,
      name: `Deep ${i}`,
    });
    cvs.register();
  }
  return { ok: true, layerCount: api.layers.length };
};
