() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  // Everything after the opening tag is executable; nothing of it should land.
  const POISON =
    '<svg viewBox="0 0 4 4" onload="window.__pwn=1"><script>window.__pwn=2</script><rect width="2" height="2"/></svg>';

  const dump = row =>
    row
      ? {
          html: row.innerHTML,
          imgs: row.querySelectorAll("img").length,
          svgs: row.querySelectorAll("svg").length,
          scripts: row.querySelectorAll("script").length,
        }
      : null;

  // A spinner whose `class` must keep matching a CSS rule after the gate.
  // Dropping `xmlns` makes Chromium re-emit it on every element when serialising
  // back through `innerHTML`, which turns `class` into an SVG-namespace attr no
  // selector can match. jsdom writes both shapes identically, so only this
  // test can see it.
  api.registerLayer({
    id: "__xss_spin__",
    name: "Spin",
    iconSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" class="foliplus-spin" viewBox="0 0 4 4"><rect width="2" height="2"/></svg>',
  });
  api.registerLayer({ id: "__xss_probe__", name: "Probe", iconSvg: POISON });
  api.registerLayer({ id: "__xss_clean__", name: "Clean" });

  // Force a full re-render so both rows reach the innerHTML sinks.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl) {
    const btn = ctrl.querySelector(".foliplus-toggle-btn");
    if (btn) btn.click();
  }

  const probeRow =
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_probe__"] .foliplus-type-icon-col',
    ) ||
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_probe__"] .foliplus-type-icon',
    );
  const cleanRow =
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_clean__"] .foliplus-type-icon-col',
    ) ||
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_clean__"] .foliplus-type-icon',
    );
  const spinRow =
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_spin__"] .foliplus-type-icon-col',
    ) ||
    document.querySelector(
      '.foliplus-layer-item[data-layer-id="__xss_spin__"] .foliplus-type-icon',
    );

  // The live DOM, not the serialised string: this is what has to round-trip
  // back through a second `innerHTML` write.
  const live = spinRow
    ? (() => {
        const svg = spinRow.querySelector("svg");
        if (!svg) return null;
        return {
          xmlnsCount: (svg.outerHTML.match(/xmlns/g) || []).length,
          class: svg.getAttribute("class"),
          matches: svg.matches(".foliplus-spin"),
        };
      })()
    : null;

  api.unregisterLayer("__xss_probe__");
  api.unregisterLayer("__xss_clean__");
  api.unregisterLayer("__xss_spin__");

  return {
    ctrlPresent: !!ctrl,
    probe: dump(probeRow),
    clean: dump(cleanRow),
    spin: live,
    leaked: ["__pwn1", "__pwn2", "__pwn3"].map(k =>
      Object.prototype.hasOwnProperty.call(window, k),
    ),
  };
};
