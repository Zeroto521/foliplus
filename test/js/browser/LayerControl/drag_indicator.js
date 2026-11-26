arg => {
  const panel = document.querySelector(".foliplus-layer-ctrl");
  const all = [...panel.querySelectorAll(".foliplus-layer-item")];
  // Layer rows in DOM order; folder rows carry data-folder-key instead of an id.
  // Root rows only: a folder's member rows carry a data-layer-id too, and a
  // root layer hovering one of them is a refusal, not a reorder gap.
  const layers = all.filter(
    row =>
      row.getAttribute("data-layer-id") !== null &&
      row.getAttribute("data-folder-key") === null &&
      !row.classList.contains("foliplus-layer-item-group") &&
      // A folder's member row wraps its tree rail in .foliplus-fold-tree; the
      // drag code uses the same marker to tell a member row from a root row.
      row.querySelector(".foliplus-fold-tree") === null,
  );
  const byFolder = key => all.find(row => row.getAttribute("data-folder-key") === key);
  // A folder's member row wraps its tree rail; nothing else does.
  const memberRows = all.filter(
    row =>
      row.getAttribute("data-layer-id") !== null &&
      row.querySelector(".foliplus-fold-tree") !== null,
  );
  const baseRow = all.find(row => row.getAttribute("data-layer-type") === "base");
  const visibleRows = () => all.filter(row => rect(row).height > 0).length;
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
      outlineColor: cs.outlineColor,
      borderTopWidth: cs.borderTopWidth,
      borderBottomWidth: cs.borderBottomWidth,
      animationName: cs.animationName,
      animationIterationCount: cs.animationIterationCount,
      boxShadow: cs.boxShadow,
      expectedBorderWidth: pad("--foliplus-border-thick"),
      gapLineWidth: pad("--foliplus-drag-gap-line"),
      refuseColor: pad("--foliplus-drag-refuse"),
      acceptColor: pad("--foliplus-accent-primary"),
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
  // The row on the far side of the gap sinks: the insertion presses it in.
  const pushed = () =>
    all
      .filter(row => row.getAttribute("data-foliplus-push") !== null)
      .map(row => ({
        push: row.getAttribute("data-foliplus-push"),
        boxShadow: getComputedStyle(row).boxShadow,
        inset: getComputedStyle(row).boxShadow.includes("inset"),
      }));
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

  if (arg.scenario === "fold") {
    // The generic dragstart above already started the gesture; clear it first so
    // "before" really means before this drag.
    fire(source, "dragend", middle(source));
    const visibleBefore = visibleRows();
    fire(source, "dragstart", middle(source));
    const visibleDuring = visibleRows();
    // Read the folded rows' computed style while the gesture is still live: the
    // marker is session-only and the dragend teardown restores the rows.
    const folded = all
      .filter(row => row.getAttribute("data-foliplus-drag-folded") !== null)
      .map(row => ({
        display: getComputedStyle(row).display,
        height: rect(row).height,
      }));
    fire(source, "dragend", middle(source));
    fire(panel, "dragend", 0);
    return {
      visibleBefore,
      visibleDuring,
      visibleAfter: visibleRows(),
      foldedDuring: folded.length,
      foldedRows: folded,
    };
  }

  if (arg.scenario === "reset") {
    fire(source, "dragend", middle(source));
    return { marked: marked() };
  }

  const target =
    arg.targetKind === "base"
      ? baseRow
      : arg.targetKind === "member"
        ? memberRows[arg.member ?? 0]
        : arg.folder !== undefined
          ? byFolder(arg.folder)
          : layers[arg.target];
  const y =
    arg.zone === "before"
      ? top(target)
      : arg.zone === "after"
        ? bottom(target)
        : middle(target);
  fire(target, "dragover", y);

  if (arg.scenario === "hover") {
    return {
      target: styles(target),
      marked: marked(),
      source: styles(source),
      pushed: pushed(),
    };
  }

  if (arg.scenario === "symmetry") {
    return {
      target: styles(target),
      lineY: gapLineY(target),
      marked: marked(),
      pushed: pushed(),
    };
  }

  fire(target, "drop", y);
  return { target: styles(target), marked: marked() };
};
