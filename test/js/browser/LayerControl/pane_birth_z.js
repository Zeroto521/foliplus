() => {
  const api = window.map && window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api || typeof api.createCanvas !== "function") {
    return { ok: false, why: "LayerAPI.createCanvas unavailable" };
  }

  const id = "t203-birth";
  const paneName = `foliplus-canvas-${id}`;
  const readZ = el => (el ? parseInt(getComputedStyle(el).zIndex, 10) : null);

  // Everything runs inside this one expression on purpose: register() stamps the
  // pane's z synchronously, so a reader that ran a tick later would already be
  // past the ordering pass and the "first frame" value would be unreadable.
  const canvas = api.createCanvas({ id, name: "T203 birth" });
  const paneBeforeRegister = window.map.getPane(paneName);
  const zBeforeRegister = readZ(canvas.canvas.parentElement);
  canvas.register();
  const zAtRegister = readZ(canvas.canvas.parentElement);
  const paneAtRegister = window.map.getPane(paneName);
  const inlineAtRegister = paneAtRegister ? paneAtRegister.style.zIndex : null;

  // The ordering pass must agree: the pane is already where it will end up.
  api.enforceOrder();
  const zAfterOrder = readZ(canvas.canvas.parentElement);

  return {
    ok: true,
    paneBeforeRegister,
    zBeforeRegister,
    zAtRegister,
    inlineAtRegister,
    zAfterOrder,
    layerCount: api.layers.length,
    layers: api.layers.map(l => ({ id: l.id, isBase: Boolean(l.isBase) })),
  };
};
