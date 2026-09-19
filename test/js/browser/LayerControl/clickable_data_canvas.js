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

  let canvasClicked = false;
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  canvas.style.cssText = "position:absolute;left:0;top:0;width:200px;height:200px;";
  canvas.addEventListener("click", () => {
    canvasClicked = true;
  });
  pane.appendChild(canvas);

  const container = window.map.getContainer().getBoundingClientRect();
  const px = container.left + 100;
  const py = container.top + 100;
  const hit = document.elementFromPoint(px, py);
  // Dispatch directly on the canvas element — the pane div has
  // pointer-events:none so elementFromPoint may skip the canvas in
  // favor of a sibling. The canvas itself has pointer-events:auto.
  canvas.dispatchEvent(
    new MouseEvent("click", { bubbles: true, clientX: px, clientY: py }),
  );

  return {
    ready: true,
    pointerEvents: getComputedStyle(pane).pointerEvents,
    canvasPointerEvents: getComputedStyle(canvas).pointerEvents,
    canvasClicked,
    isNoninteractive: pane.classList.contains("foliplus-noninteractive"),
  };
};
