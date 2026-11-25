arg => {
  const panel = document.querySelector(".foliplus-layer-ctrl");
  const all = () => [...panel.querySelectorAll(".foliplus-layer-item")];
  const layers = () => all().filter(row => row.getAttribute("data-layer-id") !== null);
  const rect = el => el.getBoundingClientRect();
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
  const ids = () => layers().map(row => row.getAttribute("data-layer-id"));
  const before = ids();
  const source = layers()[arg.source];
  const target = layers()[arg.target];
  fire(source, "dragstart", rect(source).top + rect(source).height / 2);
  fire(target, "dragover", rect(target).top + rect(target).height * 0.9);
  fire(target, "drop", rect(target).top + rect(target).height * 0.9);
  return {
    before,
    marked: all()
      .filter(row => row.getAttribute("data-foliplus-drop") !== null)
      .map(row => ({
        id: row.getAttribute("data-layer-id"),
        state: row.getAttribute("data-foliplus-drop"),
      })),
    after: ids(),
  };
};
