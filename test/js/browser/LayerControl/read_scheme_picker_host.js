// Reads where the scheme picker's portalled list lives and whether the point at
// a color row's centre resolves into it.
//
// The pseudo-fullscreen regression: the fallback is a covering container on the
// map, so a list parked in <body> sat behind it and every row was unclickable.
() => {
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  const trigger = document.querySelector(".foliplus-style-scheme-trigger");
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const pseudo = document.querySelector(".leaflet-pseudo-fullscreen");
  const fullscreen = document.fullscreenElement;
  if (!trigger) return { ok: false, reason: "no-trigger" };

  const host = dropdown && dropdown.parentElement;
  const items = dropdown
    ? Array.from(dropdown.querySelectorAll(".foliplus-scheme-picker-item"))
    : [];
  const item = items[1] || items[0];
  const rect = item ? item.getBoundingClientRect() : null;
  const hit = rect
    ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    : null;
  return {
    ok: true,
    dropdownPresent: !!dropdown,
    panelVisible: !!panel && panel.getBoundingClientRect().height > 0,
    hostTag: host ? host.tagName : null,
    hostClass: host ? String(host.className) : null,
    hostIsPseudo: !!(pseudo && host && (host === pseudo || pseudo.contains(host))),
    fullscreenElementTag: fullscreen ? fullscreen.tagName : null,
    insideFullscreenElement: !!(
      fullscreen &&
      dropdown &&
      fullscreen.contains(dropdown)
    ),
    pseudoActive: !!pseudo,
    targetName: item ? item.getAttribute("data-scheme-name") : null,
    targetX: rect ? rect.left + rect.width / 2 : null,
    targetY: rect ? rect.top + rect.height / 2 : null,
    hitInsideDropdown: !!(
      hit &&
      hit.closest &&
      hit.closest(".foliplus-scheme-picker-dropdown")
    ),
    hitTag: hit ? hit.tagName : null,
    hitClass: hit && hit.className ? String(hit.className) : null,
  };
};
