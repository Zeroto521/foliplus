(function() {
  // ==================== Dependencies ====================
  const map = {{ this._parent.get_name() }};
  const _ = (k) => window.foliplus.gt(k);

  // ==================== Control Setup ====================
  const wrap = L.control
    .scale({
      metric: {{ this.metric | tojson }},
      imperial: false,
      position: '{{ this.position }}'
    })
    .addTo(map)
    .getContainer();

  wrap.classList.add('scale-wrap');

  {% if this.show_zoom %}
  // ==================== Zoom Label ====================
  const zoomLabel = L.DomUtil.create('span', 'scale-zoom-label', wrap);
  const updateZoom = () => {
    zoomLabel.textContent = _('scale.zoom_label').replace('{zoom}', map.getZoom());
  };

  updateZoom();
  map.on('zoomend', updateZoom);
  {% endif %}
})();
