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

type ElementAttrs = Record<string, any>;
type Child = HTMLElement | string | number | { html: string } | null | undefined;

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
  el(tag: string, attrs: ElementAttrs | null = {}, ...children: Child[]): HTMLElement {
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
        else if (BOOL_PROPS.has(key)) (el as any)[key] = val === "" || val === true;
        else if (PROPS.has(key)) (el as any)[key] = val;
        else if (EVENTS.has(key)) (el as any)[key] = val;
        else el.setAttribute(key, String(val));
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (
        typeof child === "object" &&
        "html" in child &&
        (child as { html: string }).html
      ) {
        el.insertAdjacentHTML("beforeend", (child as { html: string }).html);
      } else {
        el.append(child as any);
      }
    }
    return el;
  },
};

/**
 * Create an icon button — a <button> whose content is an SVG/HTML string.
 * Shorthand for the repeated `dom.el("button", { class, title, aria-label,
 * parent, onclick }, { html: svg })` pattern used across components.
 */
const createIconButton = (opts: {
  class: string;
  title?: string;
  ariaLabel?: string;
  svg: string;
  parent?: HTMLElement;
  onclick?: (e: Event) => void;
  data?: Record<string, unknown>;
}): HTMLButtonElement => {
  const attrs: ElementAttrs = {
    class: opts.class,
    title: opts.title,
    parent: opts.parent,
    onclick: opts.onclick,
  };
  if (opts.ariaLabel !== undefined) attrs["aria-label"] = opts.ariaLabel;
  if (opts.data) {
    for (const [k, v] of Object.entries(opts.data)) attrs[`data-${k}`] = v;
  }
  return dom.el("button", attrs, { html: opts.svg }) as HTMLButtonElement;
};

/**
 * Stop event propagation and prevent default.
 * Handles both DOM events and Leaflet's wrapped events (e.originalEvent).
 */
const stopEvent = (e: any): void => {
  const d = e.originalEvent || e;
  d?.stopPropagation?.();
  d?.preventDefault?.();
};

/** Escape HTML special characters in a string. */
const escapeHTML = (str: unknown): string => {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(str).replace(/[&<>"']/g, m => map[m]);
};

/**
 * Build a popup HTML string for a location marker.
 */
const buildPopupHtml = (
  lng: number,
  lat: number,
  addr: string | null,
  titleText: string,
  loadingText: string,
  locLabelText: string,
  addrLabelText: string,
): string => {
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
    addrHtml as Child,
  ).outerHTML;
};

/**
 * Create a location marker with a popup and add it to the map.
 */
const createLocationMarker = (
  map: any,
  lng: number,
  lat: number,
  addr: string | null,
  titleText: string,
  loadingText: string,
  locLabelText: string,
  addrLabelText: string,
  closeLabelText: string,
  code?: string,
  existing?: any,
  layerGroup?: any,
  onAddress?: (addr: string) => void,
  openPopup = true,
): any => {
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
      foliplus.reverseGeocode(map, lng, lat, code).then((resolved: string) => {
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
