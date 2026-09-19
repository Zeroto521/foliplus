() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;
  const DATA = "__clickable_data_pane__";
  const mg = api.createLayers({
    id: "__clickable_data__",
    name: "ClickableDataPane",
    panes: [{ name: DATA }],
  });
  // Force pane creation by adding a dummy layer.
  mg.mainLayer.addLayer(L.polyline([]));
  const pane = window.map.getPane(DATA);
  if (!pane) return { ready: false, hasPane: false };

  window.__clickableDataCanvasHits = 0;
  const canvas = document.createElement("canvas");
  canvas.id = "foliplus-probe-clickable-canvas";
  canvas.width = 200;
  canvas.height = 200;
  pane.appendChild(canvas);
  const container = window.map.getContainer().getBoundingClientRect();
  // Park it in the middle of the map, clear of every control overlay.
  const left = Math.max(0, (container.width - 200) / 2);
  const top = Math.max(0, (container.height - 200) / 2);
  canvas.style.cssText =
    `position:absolute;left:${left}px;top:${top}px;` + "width:200px;height:200px;";
  canvas.addEventListener("click", () => {
    window.__clickableDataCanvasHits += 1;
  });

  // A real hit test, so the assertion below reads what the browser resolves
  // rather than what this fixture dispatched. The harness then clicks the
  // element through Playwright's own actionability check. Dispatching straight
  // at the canvas would prove only that its handler is wired, not that anything
  // can reach it — which is the hole the pane-level pointer-events bug slipped
  // through.
  const px = container.left + left + 100;
  const py = container.top + top + 100;
  const hit = document.elementFromPoint(px, py);

  return {
    ready: true,
    pointerEvents: getComputedStyle(pane).pointerEvents,
    canvasPointerEvents: getComputedStyle(canvas).pointerEvents,
    hitIsCanvas: hit === canvas,
    hitTag: hit ? hit.tagName : null,
    hitClass: hit ? String(hit.getAttribute("class") || "") : null,
  };
};
