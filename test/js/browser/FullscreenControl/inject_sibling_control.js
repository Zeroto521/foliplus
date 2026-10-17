// Inject a sibling control with an inline `display: block` — the same
// shape a third-party Leaflet plugin would set. This is the input the
// `hide_others` gate has to override.
() => {
  const div = document.createElement("div");
  div.className = "leaflet-bar leaflet-control custom-ctrl";
  div.style.display = "block";
  div.innerHTML = "custom";
  document.querySelector(".leaflet-top.leaflet-right").appendChild(div);
};
