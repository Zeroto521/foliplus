arg => {
  const panel = document.querySelector(".foliplus-layer-ctrl");
  const rows = () => [...panel.querySelectorAll(".foliplus-layer-item")];
  const rect = el => el.getBoundingClientRect();
  const mid = el => rect(el).top + rect(el).height / 2;
  const pick = el =>
    el.getAttribute("data-layer-id") || "folder:" + el.getAttribute("data-folder-key");
  const isMember = row => row.querySelector(".foliplus-fold-tree") !== null;
  const isRoot = row =>
    row.getAttribute("data-layer-id") !== null &&
    row.getAttribute("data-folder-key") === null &&
    !row.classList.contains("foliplus-layer-item-group") &&
    !isMember(row);
  const layers = () => rows().filter(isRoot);
  // Folder keys are normalized to lower case, while the fixture names a
  // folder "Roads": compare case-insensitively so a test can say either.
  const folderRow = key => {
    const wanted = String(key).toLowerCase();
    return rows().find(
      row => (row.getAttribute("data-folder-key") || "").toLowerCase() === wanted,
    );
  };
  const memberRows = () =>
    rows().filter(row => row.getAttribute("data-layer-id") !== null && isMember(row));
  const baseRow = () =>
    rows().find(row => row.getAttribute("data-layer-type") === "base");
  const token = name => getComputedStyle(panel).getPropertyValue(name).trim();
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
      boxShadow: cs.boxShadow,
      top: cs.top,
      bottom: cs.bottom,
    };
  };
  const alphaOf = value => {
    const slash = value.lastIndexOf("/");
    if (value.startsWith("color(") && slash !== -1) {
      return Number.parseFloat(value.slice(slash + 1));
    }
    const match = value.match(/rgba?\([^)]*\)/);
    if (!match) return value === "transparent" ? 0 : 1;
    const parts = match[0].replace(/rgba?\(|\)/g, "").split(",");
    return parts.length === 4 ? Number.parseFloat(parts[3]) : 1;
  };
  const frame = row => {
    const cs = getComputedStyle(row);
    const before = pseudo(row, "::before");
    const after = pseudo(row, "::after");
    const hasLine =
      (before.content !== "none" && before.borderTopWidth !== "0px") ||
      (after.content !== "none" && after.borderBottomWidth !== "0px");
    const box = rect(row);
    const lineY =
      hasLine && before.borderTopWidth !== "0px"
        ? box.top +
          (Number.parseFloat(before.top) || 0) +
          Number.parseFloat(before.borderTopWidth) / 2
        : hasLine
          ? box.bottom +
            (Number.parseFloat(after.bottom) || 0) +
            Number.parseFloat(after.borderBottomWidth) / 2
          : null;
    const chevron = row.querySelector(".foliplus-layer-fold-btn");
    return {
      key: pick(row),
      role: row.getAttribute("data-layer-type"),
      state: row.getAttribute("data-foliplus-drop"),
      push: row.getAttribute("data-foliplus-push"),
      display: cs.display,
      opacity: cs.opacity,
      animationName: cs.animationName,
      animationIterationCount: cs.animationIterationCount,
      cursor: cs.cursor,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      backgroundColor: cs.backgroundColor,
      backgroundAlpha: alphaOf(cs.backgroundColor),
      boxShadow: cs.boxShadow,
      transform: cs.transform,
      chevronAnimation: chevron ? getComputedStyle(chevron).animationName : null,
      hasLine,
      lineY,
      before,
      after,
    };
  };

  if (arg.action === "drag" || arg.action === "drop") {
    const source =
      arg.sourceFolder !== undefined
        ? folderRow(arg.sourceFolder)
        : layers()[arg.source];
    source.setAttribute("data-test-source", "1");
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
    fire(source, "dragstart", mid(source));
    if (arg.target !== undefined || arg.folder !== undefined || arg.targetKind) {
      const target =
        arg.targetKind === "base"
          ? baseRow()
          : arg.targetKind === "member"
            ? memberRows()[arg.member ?? 0]
            : arg.folder !== undefined
              ? folderRow(arg.folder)
              : layers()[arg.target];
      const y =
        arg.zone === "before"
          ? rect(target).top + rect(target).height * 0.1
          : arg.zone === "after"
            ? rect(target).top + rect(target).height * 0.9
            : mid(target);
      fire(target, "dragover", y);
      if (arg.action === "drop") fire(target, "drop", y);
    }
  }

  if (arg.action === "dragend") {
    const source = rows().find(row => row.getAttribute("data-test-source") === "1");
    if (source) {
      source.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, cancelable: true, composed: true }),
      );
      source.removeAttribute("data-test-source");
    }
    return { ok: true };
  }

  const frames = rows().map(frame);
  const hint = document.querySelector(".foliplus-hint");
  return {
    frames,
    marked: frames
      .filter(f => f.state !== null)
      .map(f => ({ key: f.key, state: f.state })),
    pushed: frames
      .filter(f => f.push !== null)
      .map(f => ({ key: f.key, push: f.push })),
    lineRows: frames.filter(f => f.hasLine).map(f => f.key),
    visibleRows: frames.filter(f => f.display !== "none").length,
    ids: layers().map(row => row.getAttribute("data-layer-id")),
    // Row order as the panel paints it, blocks and members included.
    order: rows().map(pick),
    members: memberRows().map(row => ({
      id: row.getAttribute("data-layer-id"),
      folder: row.getAttribute("data-folder-key"),
    })),
    // The persisted layout, read back from storage: "the position survives a
    // reload" is about the record, not about the DOM that happens to be open.
    layout: (() => {
      const key = Object.keys(localStorage).find(k => k.includes("layer_layout"));
      // The record is a wrapper (version + data): hand back the document.
      const raw = key ? JSON.parse(localStorage.getItem(key)) : null;
      return raw && raw.data ? raw.data : raw;
    })(),
    hint: hint ? hint.textContent.trim() : null,
    tokens: {
      line: token("--foliplus-drag-line"),
      inset: token("--foliplus-drag-line-inset"),
      sourceOpacity: token("--foliplus-drag-source-opacity"),
      pulseDuration: token("--foliplus-drag-pulse-duration"),
      pulseTarget: token("--foliplus-drag-pulse-target"),
      joinFill: token("--foliplus-drag-join-fill"),
    },
  };
};
