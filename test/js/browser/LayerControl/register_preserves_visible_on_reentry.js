() => {
  // Register, hide the layer through the public intent API, unregister,
  // re-register. The stored intent must survive the re-entry — that is what
  // `applyUserState` replays on first registration. `intentVisible` reports
  // the user's own choice (persisted), so `true` here means the intent
  // default stood through the re-registration; `false` means the hide
  // recorded by `setVisible` still stands.
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const fg = L.featureGroup();
  api.registerLayer({ id: "__test_vis__", layer: fg });
  const defaultVisible = api.intentVisible ? api.intentVisible("__test_vis__") : null;
  api.setVisible("__test_vis__", false);
  api.unregisterLayer("__test_vis__");
  api.registerLayer({ id: "__test_vis__", layer: L.featureGroup() });
  const newVisible = api.intentVisible ? api.intentVisible("__test_vis__") : null;
  // Cleanup
  api.unregisterLayer("__test_vis__");
  return { defaultVisible, newVisible };
};
