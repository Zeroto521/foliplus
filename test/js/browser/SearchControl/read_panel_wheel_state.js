(arg = {}) => {
  const { inject = 0 } = arg ?? {};
  const panel = document.querySelector(".foliplus-search-result-panel");
  const map = window.map;
  if (!panel) return { ok: false, reason: "no-panel" };
  if (!map || typeof map.getZoom !== "function") {
    return { ok: false, reason: "no-map" };
  }
  if (inject > 0 && !panel.dataset.injected) {
    panel.dataset.injected = "1";
    for (let i = 0; i < inject; i++) {
      const item = document.createElement("div");
      item.className = "foliplus-search-result-item";
      item.style.height = "40px";
      item.textContent = "extra-" + i;
      panel.appendChild(item);
    }
  }
  // Install a one-shot bubble-phase wheel listener on document.body and on the
  // map container to record whether a wheel event reaches them (i.e. whether
  // the panel's stopPropagation actually stopped it).
  if (!window.__wheelLog) {
    window.__wheelLog = [];
    const rec = (tag) => (e) => window.__wheelLog.push({
      tag,
      target: (e.target && (e.target.className || e.target.tagName)) || String(e.target),
      deltaY: e.deltaY,
      zoom: map.getZoom(),
      t: Date.now(),
    });
    document.body.addEventListener("wheel", rec("body"));
    const container = map.getContainer();
    container.addEventListener("wheel", rec("container"));
  }
  const rect = panel.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    ok: true,
    wheelX: x,
    wheelY: y,
    zoom: map.getZoom(),
    scrollTop: panel.scrollTop,
    clientHeight: panel.clientHeight,
    scrollHeight: panel.scrollHeight,
    itemCount: panel.querySelectorAll(".foliplus-search-result-item").length,
    scrollable: panel.scrollHeight > panel.clientHeight,
    open: !panel.hidden,
    rectTop: rect.top,
    rectHeight: rect.height,
    hitClass: hit ? (hit.className || hit.tagName) : "none",
    hitIsPanel: hit ? panel.contains(hit) : false,
    injected: panel.dataset.injected === "1",
    wheelLog: window.__wheelLog.splice(0),
  };
};
