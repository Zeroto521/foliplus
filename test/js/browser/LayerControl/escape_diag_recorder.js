// Diagnostic recorder: captures the keydown dispatch + panel/portal mutations
// around the Escape press. Injected by a temporary Python diagnostic; NOT an
// assertion — it only records evidence to stdout. Removed after diagnosis.
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
      portalHost: portal && portal.parentElement ? portal.parentElement.className : null,
      triggerExpanded: trigger ? trigger.getAttribute("aria-expanded") : null,
      activeTag: ae ? String(ae.tagName) : null,
      activeClass: ae ? String(ae.className) : null,
      t: performance.now(),
    };
  };

  rec.before = snap();

  // Capture + bubble document keydown listeners: how many dispatches, who
  // stopped / prevented first, and what the event target was.
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
  document.addEventListener("keydown", onKey("capture"), true);
  document.addEventListener("keydown", onKey("bubble"), false);

  // MutationObserver: watch the style panel and the portal host for subtree
  // removal / class changes, plus document.body for portal detach.
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      const target = m.target;
      const label = target && target.className ? String(target.className) : (target && target.tagName ? String(target.tagName) : "?");
      if (m.type === "childList") {
        rec.mutations.push({ type: "childList", added: m.addedNodes.length, removed: m.removedNodes.length, target: label, t: performance.now() });
      } else if (m.type === "attributes") {
        rec.mutations.push({ type: "attributes", attr: m.attributeName, target: label, t: performance.now() });
      }
    }
  });
  const panel = document.querySelector(".foliplus-layer-style-panel");
  if (panel) mo.observe(panel, { childList: true, subtree: true, attributes: true, attributeOldValue: true });
  mo.observe(document.body, { childList: true, subtree: false });

  return rec.before;
};
