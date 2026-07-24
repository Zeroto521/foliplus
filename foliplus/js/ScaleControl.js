(function () {
  const CONST = {
    name: "ScaleControl",
  };

  // ==================== Runtime Guard ====================
  if (!window.foliplus || !window.foliplus.SVGs) {
    console.error(`[${CONST.name}] foliplus runtime not found, plugin disabled.`);
    return;
  }

  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => (window.foliplus && window.foliplus.gt ? window.foliplus.gt(k) : k);

  // ==================== Control Setup ====================
  const wrap = L.control
    .scale({
      metric: {{ this.metric | tojson }},
      imperial: false,
      position: "{{ this.position }}",
    })
    .addTo(map)
    .getContainer();

  wrap.classList.add("foliplus-scale-wrap");

  {% if this.show_zoom %};
  // ==================== Zoom Label ====================
  const zoomLabel = L.DomUtil.create("span", "foliplus-scale-zoom-label", wrap);
  const updateZoom = () => {
    zoomLabel.textContent = _(`${CONST.name}.zoom_label`).replace(
      "{zoom}",
      map.getZoom(),
    );
  };

  updateZoom();
  map.on("zoomend", updateZoom);
  map.on("unload", () => map.off("zoomend", updateZoom));
  {% endif %};
})();
