arg => {
  const panel = document.querySelector(".foliplus-layer-ctrl");
  const all = [...panel.querySelectorAll(".foliplus-layer-item")];
  // Layer rows in DOM order; folder rows carry data-folder-key instead of an id.
  const layers = all.filter(row => row.getAttribute("data-layer-id") !== null);
  const byFolder = key => all.find(row => row.getAttribute("data-folder-key") === key);
  const pad = name => getComputedStyle(panel).getPropertyValue(name).trim();
  const pseudo = (row, which) => {
    const cs = getComputedStyle(row, which);
    return {
      content: cs.content,
      animationName: cs.animationName,
      animationIterationCount: cs.animationIterationCount,
      borderTopWidth: cs.borderTopWidth,
      borderBottomWidth: cs.borderBottomWidth,
      borderTopColor: cs.borderTopColor,
      borderBottomColor: cs.borderBottomColor,
      top: cs.top,
      bottom: cs.bottom,
    };
  };
  const styles = row => {
    const cs = getComputedStyle(row);
    return {
      state: row.getAttribute("data-foliplus-drop"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      borderTopWidth: cs.borderTopWidth,
      borderBottomWidth: cs.borderBottomWidth,
      animationName: cs.animationName,
      animationIterationCount: cs.animationIterationCount,
      boxShadow: cs.boxShadow,
      expectedBorderWidth: pad("--foliplus-border-thick"),
      gapLineWidth: pad("--foliplus-drag-gap-line"),
      before: pseudo(row, "::before"),
      after: pseudo(row, "::after"),
    };
  };
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
  const rect = el => el.getBoundingClientRect();
  const top = el => rect(el).top + rect(el).height * 0.1;
  const middle = el => rect(el).top + rect(el).height * 0.5;
  const bottom = el => rect(el).top + rect(el).height * 0.9;
  const marked = () =>
    all
      .filter(row => row.getAttribute("data-foliplus-drop") !== null)
      .map(row => ({
        id: row.getAttribute("data-layer-id"),
        folder: row.getAttribute("data-folder-key"),
        state: row.getAttribute("data-foliplus-drop"),
      }));
  // The gap line's centre, in viewport coordinates: the insertion point the
  // pulse marks. BEFORE anchors to the row's top edge, AFTER to its bottom.
  const gapLineY = row => {
    const box = rect(row);
    const state = row.getAttribute("data-foliplus-drop");
    if (state === "before") {
      const line = parseFloat(pseudo(row, "::before").borderTopWidth) || 0;
      return box.top + (parseFloat(pseudo(row, "::before").top) || 0) + line / 2;
    }
    const line = parseFloat(pseudo(row, "::after").borderBottomWidth) || 0;
    return box.bottom + (parseFloat(pseudo(row, "::after").bottom) || 0) + line / 2;
  };

  const source =
    arg.sourceFolder !== undefined ? byFolder(arg.sourceFolder) : layers[arg.source];
  fire(source, "dragstart", middle(source));

  if (arg.scenario === "pickup") {
    return { source: styles(source), marked: marked() };
  }

  if (arg.scenario === "reset") {
    fire(source, "dragend", middle(source));
    return { marked: marked() };
  }

  const target = arg.folder !== undefined ? byFolder(arg.folder) : layers[arg.target];
  const y =
    arg.zone === "before"
      ? top(target)
      : arg.zone === "after"
        ? bottom(target)
        : middle(target);
  fire(target, "dragover", y);

  if (arg.scenario === "hover") {
    return { target: styles(target), marked: marked(), source: styles(source) };
  }

  if (arg.scenario === "symmetry") {
    return {
      target: styles(target),
      lineY: gapLineY(target),
      marked: marked(),
    };
  }

  fire(target, "drop", y);
  return { target: styles(target), marked: marked() };
};
