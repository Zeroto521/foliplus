() => {
  // Focus-mode hide rule for Leaflet's native UI panes. `focus.css` already
  // hides every `foliplus-layer-pane:not(foliplus-focus-pane):not(foliplus-focus-basemap)`
  // while `.foliplus-is-focus-mode` is on — but marker shadows, hover
  // tooltips, and popups live in Leaflet's own `leaflet-{shadow,tooltip,popup}-pane`
  // divs (per the shadow-pane-ownership rule; markers are not migrated off
  // shadowPane). Without dedicated rules on the native panes, they escape the
  // focus-mode spotlight: a shadow keeps painting, a tooltip gets lifted above
  // by `liftZ("tooltipPane", 3)` on focus, and a popup can still open during
  // the focus animation.
  //
  // This probe pins the three dedicated selectors end-to-end: sample
  // `getComputedStyle(pane).visibility` before and after a focus on a polygon
  // layer. All three native panes are always in the DOM after `L.map()` init;
  // the tooltip pane's `.leaflet-tooltip` is opened programmatically (hover
  // timing is unreliable in headless), and the shadow pane is guaranteed to
  // carry an element by seeding a synthetic `.leaflet-shadow-image` — the
  // CSS rule is what pins, and we want the assertion to have something to
  // observe. The popup pane is a pure CSS-contract check (we do not open a
  // popup here — that is covered by `popup_closes_on_focus`).
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "map or ctrl not found" };

  // Seed a shadow element so the shadow-pane hide rule has something to
  // observe. Real markers in folium (awesome-markers default) do not carry a
  // shadow, so we inject one here — the CSS rule is pane-scoped, and the
  // element just has to exist for the visibility assertion to be meaningful.
  const shadowPane = map.getPane("shadowPane");
  if (shadowPane && !shadowPane.querySelector(".leaflet-shadow-image")) {
    const shadow = document.createElement("div");
    shadow.className = "leaflet-shadow-image";
    shadow.style.position = "absolute";
    shadow.style.width = "41px";
    shadow.style.height = "41px";
    shadow.style.left = "0";
    shadow.style.top = "0";
    shadowPane.appendChild(shadow);
  }

  const read = () => {
    const readOne = sel => {
      const el = document.querySelector(sel);
      return el
        ? { present: true, visibility: getComputedStyle(el).visibility }
        : { present: false, visibility: null };
    };
    return {
      containerFocus: map.getContainer().classList.contains("foliplus-is-focus-mode"),
      shadowPane: readOne(".leaflet-shadow-pane"),
      tooltipPane: readOne(".leaflet-tooltip-pane"),
      popupPane: readOne(".leaflet-popup-pane"),
      // Prove the panes actually hold something worth hiding — otherwise the
      // `visibility: hidden` assertion would pass vacuously.
      shadowImage: !!document.querySelector(".leaflet-shadow-image"),
      tooltipEl: !!document.querySelector(".leaflet-tooltip"),
    };
  };

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Open a tooltip on the marker we know is on the map (Python side
        // adds one and binds it). `openTooltip` guarantees the tooltip is
        // in the DOM inside `.leaflet-tooltip-pane` regardless of hover
        // timing — that's the whole reason we do not dispatch mousemove.
        const m = window.__testMarker;
        if (m && typeof m.openTooltip === "function") m.openTooltip();

        const before = read();

        // dblclick the first overlay layer row to trigger focus.
        const rows = Array.from(document.querySelectorAll(".foliplus-layer-item"));
        const overlayRow = rows.find(row => row.dataset.layerType !== "base");
        if (!overlayRow) return resolve({ error: "no overlay row", before });
        overlayRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

        setTimeout(() => {
          const during = read();
          // Release focus through the control's public API. `cancelFocus`
          // removes `.foliplus-is-focus-mode` from the container, which
          // releases the CSS rule in one shot.
          const ui = ctrl.mgr && ctrl.mgr.ui;
          if (ui && typeof ui.cancelFocus === "function") ui.cancelFocus();

          // Give the CSS rule one more frame to resolve after the class is
          // removed, so the "restored" sample is not racing the class removal.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve({
                before,
                during,
                after: read(),
                uiPresent: !!ui,
              });
            });
          });
        }, 700);
      });
    });
  });
};
