// Open the style icon panel, pick one glyph, and report the rendered marker
// box before and after the write. The write path is what consumes the
// declared size, so the marker element is rebuilt by the glyph commit.
//
// arg: [glyph]
// returns: { before, after, cellFound }  with before/after = [{tag, cls, box:[w,h]}]
async (arg = []) => {
  const glyph = arg[0] || "map-pin";
  const shot = () =>
    Array.from(
      document.querySelectorAll(
        ".awesome-marker, img.leaflet-marker-icon, .leaflet-marker-icon",
      ),
    ).map(el => ({
      tag: el.tagName,
      cls: el.className.slice(0, 80),
      box: [
        Math.round(el.getBoundingClientRect().width),
        Math.round(el.getBoundingClientRect().height),
      ],
    }));
  const before = shot();
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { error: "no style panel", before, cellFound: false };
  const trigger = panel.querySelector(".foliplus-style-icon-trigger");
  if (!trigger) return { error: "no icon trigger", before, cellFound: false };
  trigger.click();
  await new Promise(r => setTimeout(r, 250));
  const cell = document.querySelector('[data-glyph="' + glyph + '"]');
  const cellFound = !!cell;
  if (cell) cell.click();
  await new Promise(r => setTimeout(r, 300));
  return { before, after: shot(), cellFound };
};
