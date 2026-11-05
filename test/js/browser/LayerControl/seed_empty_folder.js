() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const id = "__seed_empty_folder__";
  api.registerLayer({
    id,
    name: "Seed Folder Layer",
    role: "overlay",
    folder: "Seed Folder",
    layer: L.featureGroup(),
  });
  const deleted = api.deleteLayer(id);
  const header = document.querySelector(
    '.foliplus-layer-toggle-all[data-role="overlay"]',
  );
  return { deleted, header: Boolean(header) };
};
