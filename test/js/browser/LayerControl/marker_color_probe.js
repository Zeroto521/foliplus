async (arg = []) => {
  const [color] = Array.isArray(arg) ? arg : ["red"];
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (!panel) return { panel: false };
  const row = panel.querySelector(".foliplus-style-marker-color-row");
  if (!row) return { panel: true, row: false };
  const trigger = row.querySelector(".foliplus-dropdown-trigger");
  if (!trigger) return { panel: true, row: true, trigger: false };
  const flush = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const readMarker = () => {
    const el = document.querySelector(".leaflet-marker-pane .awesome-marker, .foliplus-layer-pane .awesome-marker, .awesome-marker");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      backgroundImage: cs.backgroundImage,
      backgroundPosition: cs.backgroundPosition,
      size: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
      html: el.innerHTML,
      hasChassisClass: /awesome-marker-icon-/.test(el.className),
      glyph: (() => { const i = el.querySelector("i"); return i ? { cls: i.className, color: getComputedStyle(i).color } : null; })(),
    };
  };
  // Dump ALL marker-ish elements after the write.
  const dumpAll = () => {
    const els = Array.from(document.querySelectorAll(".awesome-marker, .leaflet-marker-icon, .foliplus-marker-glyph, [class*=awesome-marker]"));
    return els.map(el => ({ cls: el.className, inDoc: document.contains(el), parent: el.parentElement ? el.parentElement.className : null }));
  };
  const before = readMarker();
  trigger.click();
  await flush();
  await new Promise(r=>setTimeout(r,180));
  const lists = Array.from(document.querySelectorAll(".foliplus-dropdown-list"));
  const list = lists.find(l => l.querySelectorAll(".foliplus-dropdown-option").length > 0);
  if (!list) return { panel: true, row: true, trigger: true, option: false, before };
  const option = Array.from(list.querySelectorAll(".foliplus-dropdown-option")).find(
    o => (o.getAttribute("data-value") || o.textContent.trim()) === color
  );
  if (!option) return { panel: true, row: true, trigger: true, option: false, before };
  option.click();
  await flush();
  const after = readMarker();
  const allAfter = dumpAll();
  return { panel: true, row: true, trigger: true, option: true, before, after, allAfter, color };
};
