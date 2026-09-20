() => {
  // Click-through gate. The focus overlay pane's base class
  // `foliplus-layer-pane` carries `pointer-events: none` from focus.css, so
  // the pane div never eats a click even though the SVG renderer fills the
  // whole map while a focus is live. Without the base class the div defaulted
  // to `auto` and, sitting above every other layer pane, it blocked pointer
  // hits on the focused layer's own features during focus — a silent
  // regression this probe exists to catch.
  //
  // The mask and the dashed focus rect are both `interactive: false`, so they
  // carry no `.leaflet-interactive` class and stay under the
  // `path.foliplus-focus-{mask,rect} { pointer-events: none }` rule; the
  // focused layer's `.leaflet-interactive` path re-enables itself via
  // `.foliplus-layer-pane .leaflet-interactive { pointer-events: auto }`.
  //
  // We gate on `getComputedStyle(pane).pointerEvents === "none"` — the direct
  // invariant. A separate elementFromPoint assertion is tempting but flaky
  // here: after `dblclick` triggers focus, the focused layer's SVG renderer
  // rebuilds the path and the `.leaflet-interactive` class isn't always
  // restored before our 700ms sample, which would false-negative this gate.
  // The invariant we actually pin is the CSS rule on the overlay pane itself;
  // if the base class ever drops off, that rule goes with it and the assert
  // fires.
  const item = document.querySelector(
    ".foliplus-layer-item:not(.foliplus-color-layer-item)",
  );
  if (!item) return { row: false };
  item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

  return new Promise(resolve => {
    // fitBounds animates; wait past the duration so the overlay settles.
    setTimeout(() => {
      const pane = window.map.getPane("foliplus-focus-overlay");
      if (!pane) return resolve({ pane: false });
      resolve({
        pane: true,
        panePointerEvents: getComputedStyle(pane).pointerEvents,
      });
    }, 700);
  });
};
