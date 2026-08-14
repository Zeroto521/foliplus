() => {
  // Click the search pin so the popup ends in the OPEN state (toggle off if
  // it was auto-opened at creation, then open again) → popupopen reveals ✕.
  const marker = document.querySelector(".leaflet-marker-icon:not(.foliplus-del-icon)");
  if (!marker) return false;
  if (document.querySelector(".leaflet-popup")) marker.click();
  marker.click();
  return true;
};
