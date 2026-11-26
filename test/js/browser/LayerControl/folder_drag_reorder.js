// test/js/snippet/LayerControl/folder_drag_reorder — drag the first folder
// block after the second and report the block order on both sides of the drop.
//
// The target row is measured AFTER the dragstart: a dragged block folds its
// members for the gesture, so the list compacts and a coordinate captured
// before the drag would aim below the row it was measured on.
() => {
  const panel = document.querySelector(".foliplus-layer-ctrl");
  const folders = () => [...panel.querySelectorAll(".foliplus-layer-item-folder")];
  const keys = () => folders().map(el => el.getAttribute("data-folder-key"));
  const before = keys();
  const dt = new DataTransfer();
  const fire = (el, type, y) =>
    el.dispatchEvent(
      new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        dataTransfer: dt,
        clientY: y,
      }),
    );
  const source = folders()[0];
  const sourceBox = source.getBoundingClientRect();
  fire(source, "dragstart", sourceBox.top + sourceBox.height / 2);
  const target = folders()[1];
  const box = target.getBoundingClientRect();
  const y = box.top + box.height * 0.85;
  fire(target, "dragover", y);
  fire(target, "drop", y);
  return { before, after: keys() };
};
