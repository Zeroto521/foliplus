() => {
  // The preview radius label must land in the label pane, not the graph pane.
  // Inside the graph pane it competes for SVG paint order with the circle
  // fill, the dashed radius line and both nodes — a label whose rect overlaps
  // a node at a short radius is covered by whichever shape re-attaches last.
  // Distance and polygon already route their preview labels through
  // CONST.PANES.LABEL; the circle preview was the one omission, which is why
  // "线和面积没有这个问题".
  const mm = window.__measureManager;
  const map = window.__map;
  mm.setMode("circle");
  map.fire("click", { latlng: L.latLng(26.08, 119.3) });
  map.invalidateSize();

  // Ancestor pane element for a label chip.
  const paneOf = () => {
    const el = document.querySelector(".foliplus-measure-label-radius");
    if (!el) return null;
    const pane = el.closest(".leaflet-pane");
    return pane ? pane.className : null;
  };

  // Near the origin the label rect covers the center dot and the radius node.
  map.fire("mousemove", { latlng: L.latLng(26.0802, 119.3002) });
  const near = {
    pane: paneOf(),
    z: (() => {
      const pane = document
        .querySelector(".foliplus-measure-label-radius")
        ?.closest(".leaflet-pane");
      return pane ? getComputedStyle(pane).zIndex : null;
    })(),
  };

  // Far from the origin, after several more mousemoves.
  map.fire("mousemove", { latlng: L.latLng(26.09, 119.31) });
  map.fire("mousemove", { latlng: L.latLng(26.091, 119.311) });
  const far = {
    pane: paneOf(),
    z: (() => {
      const pane = document
        .querySelector(".foliplus-measure-label-radius")
        ?.closest(".leaflet-pane");
      return pane ? getComputedStyle(pane).zIndex : null;
    })(),
  };

  // Both measure panes, so the assertions are not vacuously satisfied by the
  // label pane being absent. `enforceOrder` runs only on layer-add / move /
  // visibility events, never on a preview layer created by mousemove, so the
  // z check below is the part that catches a sub-pane left at the base z and
  // painting above the graph pane only by div insertion order.
  const allPanes = Array.from(
    document.querySelectorAll(
      "[class*='measure_graph-pane'],[class*='measure_label-pane']",
    ),
  ).map(p => {
    const cls = p.className;
    return {
      name: cls.match(/measure_(graph|label)-pane/)?.[1] || null,
      z: getComputedStyle(p).zIndex,
    };
  });

  return { near, far, allPanes };
};
