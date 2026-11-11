// Verify the task-76 chassis custom-color paint paths in a real Leaflet
// runtime: the derived marker's DOM after a write carries the right chassis
// mechanism (sprite class for a preset at alpha 100, a chassis <span> with
// sprite + opacity for a preset at alpha < 100, mask + flat background-color
// for a custom hex), the glyph <i> stays a sibling and fully opaque, and the
// container clears the library sprite when a span carries the chassis.
//
// The row is [color swatch | opacity number] (the #1025 shape): writing a hex
// dispatches "input" on the swatch, writing an opacity dispatches "input" on
// the number field (bindLiveNumber commits in-range values).
//
// arg: { hex: "#38aadd"|"#ff9900", opacity: 100|50|0 }
// returns: { ok, hex, opacity, marker, span, glyph, container }
async (arg = {}) => {
  const { hex, opacity } = arg;
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { ok: false, error: "no style panel" };
  const row = panel.querySelector(".foliplus-style-marker-color-row");
  if (!row) return { ok: false, error: "no marker color row" };
  const swatch = row.querySelector('input[type="color"]');
  const number = row.querySelector(".foliplus-style-marker-color-opacity-number");
  if (!swatch || !number) return { ok: false, error: "missing swatch/number input" };

  const flush = () =>
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Commit hex if provided.
  if (typeof hex === "string") {
    swatch.value = hex;
    swatch.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  }
  // Commit opacity if provided.
  if (typeof opacity === "number") {
    number.value = String(opacity);
    number.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
  }

  // Read the marker element.
  const el = document.querySelector(
    ".leaflet-marker-pane .awesome-marker, .foliplus-layer-pane .awesome-marker, .awesome-marker",
  );
  if (!el) return { ok: false, error: "no marker element" };
  const cs = getComputedStyle(el);
  const span = el.querySelector(".foliplus-marker-chassis");
  const glyph = el.querySelector("i");
  return {
    ok: true,
    hex: hex ?? null,
    opacity: opacity ?? null,
    marker: {
      cls: el.className,
      containerBackgroundImage: cs.backgroundImage,
      containerBackgroundPosition: cs.backgroundPosition,
      hasChassisClass: /awesome-marker-icon-/.test(el.className),
      hasSpan: !!span,
    },
    span: span
      ? {
          cls: span.className,
          backgroundImage: getComputedStyle(span).backgroundImage,
          backgroundPosition: getComputedStyle(span).backgroundPosition,
          maskImage: getComputedStyle(span).maskImage,
          maskPosition: getComputedStyle(span).maskPosition,
          backgroundColor: getComputedStyle(span).backgroundColor,
          opacity: getComputedStyle(span).opacity,
          hasGlyph: !!span.querySelector("i"),
        }
      : null,
    glyph: glyph
      ? {
          cls: glyph.className,
          color: getComputedStyle(glyph).color,
          opacity: getComputedStyle(glyph).opacity,
        }
      : null,
  };
};
