// Enhanced diagnostic recorder: keydown at window/document/bubble, DOM
// relationship of the picker trigger<->portal, and panel/portal mutations.
// TEMP — removed after diagnosis; assertions untouched.
() => {
  const rec = { events: [], mutations: [], before: null, after: null };
  window.__escapeRec = rec;

  const snap = () => {
    const panel = document.querySelector(".foliplus-layer-style-panel");
    const portal = document.querySelector(".foliplus-scheme-picker-portal");
    const trigger = document.querySelector(".foliplus-style-scheme-trigger");
    const ae = document.activeElement;
    return {
      panelOpen: !!panel,
      panelClass: panel ? String(panel.className) : null,
      panelVisible: panel ? panel.getBoundingClientRect().height > 0 : false,
      portalCount: document.querySelectorAll(".foliplus-scheme-picker-portal").length,
      portalVisible: portal ? portal.getBoundingClientRect().height > 0 : false,
      portalId: portal ? (portal.getAttribute("id") || null) : null,
      portalConnected: portal ? portal.isConnected : false,
      triggerExpanded: trigger ? trigger.getAttribute("aria-expanded") : null,
      triggerControls: trigger ? trigger.getAttribute("aria-controls") : null,
      // count every element that looks like a common/dropdown popup or scheme picker
      dropdownPopups: document.querySelectorAll(".foliplus-dropdown, .foliplus-scheme-picker-dropdown").length,
      openTriggers: Array.from(document.querySelectorAll('[aria-expanded="true"]')).map(e => String(e.className).slice(0,60)),
      schemeTriggers: Array.from(document.querySelectorAll(".foliplus-style-scheme-trigger")).map(e => ({
        expanded: e.getAttribute("aria-expanded"),
        controls: e.getAttribute("aria-controls"),
        cls: String(e.className).slice(0,50),
      })),
      schemePortals: Array.from(document.querySelectorAll(".foliplus-scheme-picker-portal")).map(e => ({
        id: e.getAttribute("id"),
        connected: e.isConnected,
        rect: e.getBoundingClientRect().height,
      })),
      activeTag: ae ? String(ae.tagName) : null,
      activeClass: ae ? String(ae.className) : null,
      t: performance.now(),
    };
  };

  rec.before = snap();

  const onKey = (phase) => (e) => {
    rec.events.push({
      phase,
      key: e.key,
      defaultPrevented: e.defaultPrevented,
      targetTag: e.target && e.target.tagName ? String(e.target.tagName) : null,
      targetClass: e.target && e.target.className ? String(e.target.className) : null,
      t: performance.now(),
    });
  };
  window.addEventListener("keydown", onKey("window-capture"), true);
  document.addEventListener("keydown", onKey("document-capture"), true);
  window.addEventListener("keydown", onKey("window-bubble"), false);
  document.addEventListener("keydown", onKey("document-bubble"), false);

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const target = m.target;
      const label = target && target.className ? String(target.className) : (target && target.tagName ? String(target.tagName) : "?");
      if (m.type === "childList") {
        rec.mutations.push({ type: "childList", added: m.addedNodes.length, removed: m.removedNodes.length, target: label, t: performance.now() });
      } else if (m.type === "attributes") {
        rec.mutations.push({ type: "attributes", attr: m.attributeName, target: label, old: m.oldValue, t: performance.now() });
      }
    }
  });
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (panel) mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeOldValue: true });
  mo.observe(document.body, { childList: true, subtree: false });

  return rec.before;
};
