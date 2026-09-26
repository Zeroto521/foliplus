// Hatch fullscreen parity gate.
//
// The no-basemap hatch must look the same in fullscreen and non-fullscreen:
// light background + grid. The browser's native fullscreen API paints a UA
// black background over the container; the CSS fix adds an !important
// override for :fullscreen.no-base-map so the hatch background survives.
//
// Driver: window.__probe = { action: "read" }
//   read — return background-color + CSS rule check for both states
() => {
  const spec = window.__probe || { action: "read" };
  delete window.__probe;
  const map = window.map;
  if (!map) return { error: "map missing" };
  const container = map.getContainer();

  const readState = () => {
    const cs = getComputedStyle(container);
    return {
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage.startsWith("repeating-conic-gradient"),
      hasNoBaseMap: container.classList.contains("no-base-map"),
    };
  };

  // Check that the CSS rule for :fullscreen.no-base-map exists and sets
  // background-color to the same value as .no-base-map.
  let fullscreenRuleFound = false;
  let fullscreenBgColor = null;
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (
          rule.selectorText &&
          rule.selectorText.includes(":fullscreen") &&
          rule.selectorText.includes("no-base-map")
        ) {
          fullscreenRuleFound = true;
          fullscreenBgColor = rule.style.backgroundColor;
          break;
        }
      }
    } catch {
      // cross-origin sheet — skip
    }
    if (fullscreenRuleFound) break;
  }

  return {
    ok: true,
    state: readState(),
    fullscreenRuleFound,
    fullscreenBgColor,
  };
};
