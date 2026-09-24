() => {
  const row = document.querySelector(".foliplus-color-layer-item");
  if (!row) return null;
  const cb = row.querySelector('input[type="checkbox"]');
  const mapContainer = document.querySelector(".leaflet-container");
  return {
    hasCheckbox: !!cb,
    checked: cb ? cb.checked : null,
    active: mapContainer ? mapContainer.classList.contains("active") : false,
    colorBg: mapContainer
      ? mapContainer.style.getPropertyValue("--color-layer-bg")
      : "",
  };
};
