// test/js/snippet/LayerControl/folder_names — read the folder row order as
// data-folder-key values, so a browser test can assert block order after a drag.
() =>
  Array.from(document.querySelectorAll(".foliplus-layer-item-folder")).map(el =>
    el.getAttribute("data-folder-key"),
  );
