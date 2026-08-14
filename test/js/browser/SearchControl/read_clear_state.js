() => ({
  inputCleared: document.querySelector("input")?.value === "",
  delIconCount: document.querySelectorAll("[data-del-icon]").length,
  popupCount: document.querySelectorAll(".leaflet-popup").length,
});
