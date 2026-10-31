() => {
  // Focus-mode hide rules. `focus.css` hides every
  // `foliplus-layer-pane:not(foliplus-focus-pane):not(foliplus-focus-basemap)`
  // while `.foliplus-is-focus-mode` is on — and marker shadows ARE
  // foliplus-layer-panes now: each marker layer carries its own shadow pane
  // (PaneRole.SHADOW, moved in by PaneManager.pinLateContent), so the layer
  // rule hides a non-focused layer's shadows while the focused layer keeps
  // its own. The shared `leaflet-shadow-pane` has no dedicated rule anymore
  // (the blanket hide this probe used to pin took the focused marker layer's
  // own shadows down with everyone else's). Hover tooltips and popups still
  // live in Leaflet's own `leaflet-{tooltip,popup}-pane` divs outside any
  // layer pane, so their two dedicated rules remain — a tooltip gets lifted
  // above the mask by `liftZ("tooltipPane", 3)` on focus, and a popup can
  // open during the focus animation.
  //
  // This probe seeds a synthetic shadow into the test marker's layer shadow
  // pane (folium's awesome-marker icons carry no shadow of their own), then
  // samples computed visibility before / during / after a focus on a
  // polygon layer. The tooltip is opened programmatically via `openTooltip`
  // (hover timing is unreliable in headless); the popup pane is a pure
  // CSS-contract check (popup opening is covered by `popup_closes_on_focus`).
  const map = window.map;
  const ctrl = window.__layerCtrl;
  if (!map || !ctrl) return { error: "map or ctrl not found" };

  // Pane elements carry their NAME as a class (`leaflet-<name>-pane`), not
  // an id — Leaflet's createPane never sets an id. Derive the marker layer's
  // shadow pane from the icon pane's class token: base name
  // `foliplus-pane-75` → shadow pane class `leaflet-foliplus-pane-75-shadow-pane`.
  const iconPane = window.__testMarker?.getElement?.()?.parentElement ?? null;
  const shadowPaneClass = iconPane
    ? (() => {
        const stem = Array.from(iconPane.classList).find(
          c => c !== "leaflet-pane" && c.startsWith("leaflet-") && c.endsWith("-pane"),
        );
        return stem
          ? `leaflet-${stem.slice("leaflet-".length, -"-pane".length)}-shadow-pane`
          : null;
      })()
    : null;
  const markerShadowPane = shadowPaneClass
    ? iconPane.parentElement.querySelector(`.${shadowPaneClass}`)
    : null;
  const shadowPaneId = shadowPaneClass;
  if (markerShadowPane && !markerShadowPane.querySelector(".foliplus-shadow-probe")) {
    const shadow = document.createElement("div");
    shadow.className = "foliplus-shadow-probe";
    shadow.style.position = "absolute";
    shadow.style.width = "41px";
    shadow.style.height = "41px";
    shadow.style.left = "0";
    shadow.style.top = "0";
    markerShadowPane.appendChild(shadow);
  }

  const read = () => {
    const readOne = sel => {
      const el = document.querySelector(sel);
      return el
        ? { present: true, visibility: getComputedStyle(el).visibility }
        : { present: false, visibility: null };
    };
    const probe = document.querySelector(".foliplus-shadow-probe");
    return {
      containerFocus: map.getContainer().classList.contains("foliplus-is-focus-mode"),
      // Leaflet's shared shadow pane — no dedicated rule anymore.
      shadowPane: readOne(".leaflet-shadow-pane"),
      // The test marker layer's own shadow pane and the probe inside it.
      markerShadowPane: shadowPaneClass ? readOne(`.${shadowPaneClass}`) : null,
      shadowProbe: probe
        ? { present: true, visibility: getComputedStyle(probe).visibility }
        : { present: false, visibility: null },
      tooltipPane: readOne(".leaflet-tooltip-pane"),
      popupPane: readOne(".leaflet-popup-pane"),
      // Prove the panes actually hold something worth hiding — otherwise the
      // `visibility: hidden` assertions would pass vacuously.
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
                shadowPaneId,
              });
            });
          });
        }, 700);
      });
    });
  });
};
