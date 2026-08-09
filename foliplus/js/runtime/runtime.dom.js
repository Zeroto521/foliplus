// DOM helpers and popup/marker utilities for the foliplus runtime.
//
import * as SVGs from "../shared/icon.js";
import { reverseGeocode } from "./runtime.geocode.js";

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

/** @type {import("./runtime.dom.js")} */
const foliplusDom = {
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
  const foliplus = window.foliplus || {};
  const addrHtml =
    addr && addr.includes("LOADING")
      ? { html: `${SVGs.LOADING} ${loadingText}` }
      : addr || loadingText;

  return foliplusDom.el(
    "div",
    { class: "foliplus-popup-content" },
    foliplusDom.el("b", null, titleText),
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
  const foliplus = window.foliplus || {};
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
    reverseGeocode(map, lng, lat, code).then((resolved) => {
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
  return marker;
};

export { buildPopupHtml, createLocationMarker, foliplusDom };
