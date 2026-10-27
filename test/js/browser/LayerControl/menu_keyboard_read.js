// Read which floating surface is open after an activation: the style panel,
// the attributes panel, the inline rename input, the armed delete entry, the
// overflow menu itself, and how many overlay rows are left. Panels are queried
// document-wide because each one mounts next to its own row.
() => ({
  styleOpen: !!document.querySelector(".foliplus-layer-style-panel"),
  attrsOpen: !!document.querySelector(".foliplus-layer-attrs-panel"),
  renameInput: !!document.querySelector(".foliplus-layer-rename-input"),
  deleteArmed: !!document.querySelector(
    ".foliplus-layer-more-menu-delete-armed",
  ),
  menuOpen: !!document.querySelector(".foliplus-layer-more-menu.open"),
  rows: document.querySelectorAll(".foliplus-layer-item[data-layer-type=overlay]")
    .length,
});
