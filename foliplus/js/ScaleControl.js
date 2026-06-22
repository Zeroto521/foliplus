(function() {
  const map = {{ this._parent.get_name() }};
  const _ = (key) => _LOCALE[key] || key;

  // Create the scale control, add it to the map, and get its container
  const wrap = L.control
    .scale({
      metric: {{ this.metric | tojson }},
      imperial: {{ this.imperial | tojson }},
      position: '{{ this.position }}'
    })
    .addTo(map)
    .getContainer();

  wrap.classList.add('custom-scale-wrap');

  {% if this.show_zoom %}
  // Create a zoom level label
  const zoomLabel = L.DomUtil.create('span', 'scale-zoom-label', wrap);

  // Update zoom label on zoom change
  const updateZoom = () => {
    zoomLabel.textContent = _('scale.zoom_label').replace('{zoom}', map.getZoom());
  };

  updateZoom();
  map.on('zoomend', updateZoom);
  {% endif %}
})();
