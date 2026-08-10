// DOM helpers and popup/marker utilities for foliplus components.
//
// Imported statically by components. Reverse geocoding is NOT imported here —
// it lives in the runtime singleton (runtime.geocode.js) and is accessed
// lazily via `foliplus.reverseGeocode` at call time, so the geocoder's shared
// cache/throttle state is not duplicated into every component bundle.
import * as SVGs from "./icon.js";

// ── DOM constants ───────────────────────────────────────────────
const BOOL_PROPS = new Set([
  "checked",
  "selected",
  "disabled",
  "readOnly",
  "indeterminate",
  "defaultChecked",
]);
const PROPS = new Set(["value", "defaultValue"]);
const EVENTS = new Set([
  "onclick",
  "ondblclick",
  "onchange",
  "oninput",
  "onmouseover",
  "onmouseout",
  "onkeydown",
  "onkeyup",
  "onkeypress",
  "onsubmit",
  "onfocus",
  "onblur",
  "onload",
  "onerror",
  "onwheel",
  "onpointerdown",
  "onpointermove",
  "onpointerup",
  "ontouchstart",
  "ontouchmove",
  "ontouchend",
  "onmousedown",
  "onmousemove",
  "onmouseup",
]);
const PIN = {
  SIZE: [24, 36],
  ANCHOR: [12, 36],
  POPUP_ANCHOR: [0, -36],
  Z_OFFSET: 10000,
};
const POPUP_MAX_WIDTH = 300;

/** @type {import("./dom.js")} */
const dom = {
  /**
   * Create an element with attributes, properties, events, and children.
   *
   * Supported attrs keys:
   * - `class` → sets `className` (string, supports `" "` separated tokens)
   * - `style` → if object, merges via `Object.assign(el.style, val)`;
   *             if string, sets `el.style.cssText = val`
   * - `value`, `defaultValue` → set as DOM property
   * - `checked`, `selected`, `disabled`, `readOnly` → set as boolean DOM property (`""` → `true`)
   * - `onclick`, `onchange`, `oninput`, etc. → assigned as event handler
   * - `parent` → auto-append to parent element (HTMLElement)
   * - `innerHTML` → set via `el.innerHTML = val`
   * - any other key → set via `el.setAttribute(key, String(val))`
   *
   * Children can be:
   * - `string` / `number` → appended as TextNode
   * - `{ html: "..." }` → inserted via `insertAdjacentHTML("beforeend", ...)`
   * - `HTMLElement` → appended via `appendChild`
   */
  el(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, val] of Object.entries(attrs)) {
        if (val == null) continue;
        if (key === "class") el.className = val;
        else if (key === "style") {
          if (typeof val === "object") Object.assign(el.style, val);
          else el.style.cssText = val;
        } else if (key === "parent") val.appendChild(el);
        else if (key === "innerHTML") el.innerHTML = val;
        else if (BOOL_PROPS.has(key)) el[key] = val === "" || val === true;
        else if (PROPS.has(key)) el[key] = val;
        else if (EVENTS.has(key)) el[key] = val;
        else el.setAttribute(key, String(val));
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (child.html) el.insertAdjacentHTML("beforeend", child.html);
      else el.append(child);
    }
    return el;
  },
};

/**
 * Create an icon button — a <button> whose content is an SVG/HTML string.
 * Shorthand for the repeated `dom.el("button", { class, title, aria-label,
 * parent, onclick }, { html: svg })` pattern used across components.
 * @param {object} opts
 * @param {string} opts.class - CSS class(es) for the button
 * @param {string} [opts.title] - Tooltip text
 * @param {string} [opts.ariaLabel] - aria-label attribute
 * @param {string} opts.svg - SVG/HTML string placed inside the button
 * @param {HTMLElement} [opts.parent] - Parent element to append to
 * @param {Function} [opts.onclick] - Click handler
 * @param {Object} [opts.data] - Extra attributes as `data-*` (key → data-key)
 * @returns {HTMLButtonElement}
 */
const createIconButton = ({
  class: cls,
  title,
  ariaLabel,
  svg,
  parent,
  onclick,
  data,
}) => {
  const attrs = { class: cls, title, parent, onclick };
  if (ariaLabel !== undefined) attrs["aria-label"] = ariaLabel;
  if (data) {
    for (const [k, v] of Object.entries(data)) attrs[`data-${k}`] = v;
  }
  return dom.el("button", attrs, { html: svg });
};

/**
 * Stop event propagation and prevent default.
 * Handles both DOM events and Leaflet's wrapped events (e.originalEvent).
 * @param {Event|L.Event} e - DOM event or Leaflet event.
 */
const stopEvent = e => {
  const d = e.originalEvent || e;
  d?.stopPropagation?.();
  d?.preventDefault?.();
};

/** Escape HTML special characters in a string.
 *  @param {string} str - String to escape.
 *  @returns {string} Escaped string. */
const escapeHTML = str => {
  return String(str).replace(
    /[&<>"']/g,
    m =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
  );
};

/**
 * Build a popup HTML string for a location marker.
 * @param {number} lng Longitude
 * @param {number} lat Latitude
 * @param {string|null} addr Address text or null (triggers loading indicator)
 * @param {string} titleText Resolved popup title text
 * @param {string} loadingText Resolved loading text
 * @param {string} locLabelText Resolved location label text
 * @param {string} addrLabelText Resolved address label text
 * @returns {string} HTML string
 */
const buildPopupHtml = (
  lng,
  lat,
  addr,
  titleText,
  loadingText,
  locLabelText,
  addrLabelText,
) => {
  const addrHtml =
    addr && addr.includes("LOADING")
      ? { html: `${SVGs.LOADING} ${loadingText}` }
      : addr || loadingText;

  return dom.el(
    "div",
    { class: "foliplus-popup-content" },
    dom.el("b", null, titleText),
    { html: "<br>" },
    `${locLabelText}${lng},${lat}`,
    { html: "<br>" },
    addrLabelText,
    addrHtml,
  ).outerHTML;
};

/**
 * Create a location marker with a popup and add it to the map.
 * @param {L.Map} map Leaflet map instance
 * @param {number} lng Longitude
 * @param {number} lat Latitude
 * @param {string} addr Address string (null = pending reverse geocode)
 * @param {string} titleText Resolved popup title text
 * @param {string} loadingText Resolved loading text
 * @param {string} locLabelText Resolved location label text
 * @param {string} addrLabelText Resolved address label text
 * @param {string} closeLabelText Resolved close button tooltip text
 * @param {string} [code] Locale code for reverse geocode
 * @param {L.Marker} [existing] Existing marker to remove before creating new one
 * @param {L.LayerGroup} [layerGroup] Optional layer group to add the marker to
 * @param {Function} [onAddress] Called with the resolved address
 * @param {boolean} [openPopup=true] Whether to auto-open the popup
 * @returns {L.Marker} The newly created marker
 */
const createLocationMarker = (
  map,
  lng,
  lat,
  addr,
  titleText,
  loadingText,
  locLabelText,
  addrLabelText,
  closeLabelText,
  code,
  existing,
  layerGroup,
  onAddress,
  openPopup = true,
) => {
  if (existing) map.removeLayer(existing);
  const target = layerGroup || map;
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: "",
      html: SVGs.PIN_ICON,
      iconSize: PIN.SIZE,
      iconAnchor: PIN.ANCHOR,
      popupAnchor: PIN.POPUP_ANCHOR,
    }),
    zIndexOffset: PIN.Z_OFFSET,
  });
  target.addLayer(marker);
  marker.bindPopup(
    buildPopupHtml(lng, lat, addr, titleText, loadingText, locLabelText, addrLabelText),
    { maxWidth: POPUP_MAX_WIDTH },
  );
  if (openPopup) marker.openPopup();
  // Add title to Leaflet's popup close button for hover tooltip.
  const popupEl = marker.getPopup();
  if (popupEl) {
    const closeBtn = popupEl._closeButton;
    if (closeBtn) closeBtn.title = closeLabelText || "";
  }
  if (!addr) {
    // Lazy access to the runtime singleton geocoder (kept out of this bundle).
    const foliplus = window.foliplus || {};
    if (foliplus.reverseGeocode) {
      foliplus.reverseGeocode(map, lng, lat, code).then(resolved => {
        if (onAddress) onAddress(resolved);
        if (marker && marker.getPopup() && marker.getPopup().isOpen()) {
          marker.setPopupContent(
            buildPopupHtml(
              lng,
              lat,
              resolved,
              titleText,
              loadingText,
              locLabelText,
              addrLabelText,
            ),
          );
        }
      });
    }
  }
  return marker;
};

export {
  buildPopupHtml,
  createIconButton,
  createLocationMarker,
  dom,
  escapeHTML,
  stopEvent,
};
