() => {
  const mm = window.__measureManager;
  mm.store.hydrate([{ id: "t1", type: "marker", lng: 119.3, lat: 26.08 }]);
  mm.store.persist();
};
