() => {
  const api = window.map.foliplus && window.map.foliplus.LayerAPI;
  if (!api) return null;

  // Everything after the opening tag is executable; nothing of it should land.
  const POISON =
    '<svg viewBox="0 0 4 4" onload="window.__pwn=1"><script>window.__pwn=2</script><rect width="2" height="2"/></svg>';

  const dump = (row) =>
    row
      ? {
          html: row.innerHTML,
          imgs: row.querySelectorAll("img").length,
          svgs: row.querySelectorAll("svg").length,
          scripts: row.querySelectorAll("script").length,
        }
      : null;

  api.registerLayer({ id: "__xss_probe__", name: "Probe", iconSvg: POISON });
  api.registerLayer({ id: "__xss_clean__", name: "Clean" });

  // Force a full re-render so both rows reach the innerHTML sinks.
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (ctrl) {
    const btn = ctrl.querySelector(".foliplus-toggle-btn");
    if (btn) btn.click();
  }

  const probeRow = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__xss_probe__"] .foliplus-type-icon-col'
  ) || document.querySelector(
    '.foliplus-layer-item[data-layer-id="__xss_probe__"] .foliplus-type-icon'
  );
  const cleanRow = document.querySelector(
    '.foliplus-layer-item[data-layer-id="__xss_clean__"] .foliplus-type-icon-col'
  ) || document.querySelector(
    '.foliplus-layer-item[data-layer-id="__xss_clean__"] .foliplus-type-icon'
  );

  api.unregisterLayer("__xss_probe__");
  api.unregisterLayer("__xss_clean__");

  return {
    ctrlPresent: !!ctrl,
    probe: dump(probeRow),
    clean: dump(cleanRow),
    leaked: ["__pwn1", "__pwn2", "__pwn3"].map((k) =>
      Object.prototype.hasOwnProperty.call(window, k)
    ),
  };
};
