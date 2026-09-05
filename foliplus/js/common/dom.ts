// DOM helpers and popup/marker utilities for foliplus components.
//
// Imported statically by components. Reverse geocoding is NOT imported here —
// it lives in the runtime singleton (geocode.js) and is accessed
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
const PIN: {
  SIZE: [number, number];
  ANCHOR: [number, number];
  POPUP_ANCHOR: [number, number];
  Z_OFFSET: number;
} = {
  SIZE: [24, 36],
  ANCHOR: [12, 36],
  POPUP_ANCHOR: [0, -36],
  Z_OFFSET: 10000,
};
const POPUP_MAX_WIDTH = 300;

/** Attribute value: primitives, style object, event handler, or parent element. */
type AttrVal =
  | string
  | number
  | boolean
  | null
  | EventListener
  | HTMLElement
  | Record<string, string>;
type ElementAttrs = Record<string, AttrVal | undefined>;
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
        if (key === "class") el.className = String(val);
        else if (key === "style") {
          if (typeof val === "object" && val !== null && !("appendChild" in val)) {
            const styleObj: Record<string, string> = val as Record<string, string>;
            Object.assign(el.style, styleObj);
          } else el.style.cssText = String(val);
        } else if (key === "parent") (val as HTMLElement).appendChild(el);
        else if (key === "innerHTML") el.innerHTML = String(val);
        else if (BOOL_PROPS.has(key)) Reflect.set(el, key, val === "" || val === true);
        else if (PROPS.has(key)) Reflect.set(el, key, val);
        else if (EVENTS.has(key)) {
          const handler = val as EventListener;
          Reflect.set(el, "on" + key.slice(2), handler);
        } else el.setAttribute(key, String(val));
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (
        typeof child === "object" &&
        "html" in child &&
        (child as { html: string }).html
      )
        el.insertAdjacentHTML("beforeend", (child as { html: string }).html);
      else if (typeof child === "number") el.append(String(child));
      else el.append(child as string | HTMLElement);
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
  onclick?: (event: Event) => void;
  data?: Record<string, string | number | boolean>;
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
const stopEvent = (event: Event | { originalEvent?: Event }): void => {
  const d = (event as { originalEvent?: Event }).originalEvent ?? (event as Event);
  (
    d as Event & { stopPropagation?: () => void; preventDefault?: () => void }
  )?.stopPropagation?.();
  (
    d as Event & { stopPropagation?: () => void; preventDefault?: () => void }
  )?.preventDefault?.();
};

/** Escape HTML special characters in a string. */
const escapeHTML = (str: string | number | boolean | null | undefined): string => {
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
  map: L.Map,
  lng: number,
  lat: number,
  addr: string | null,
  titleText: string,
  loadingText: string,
  locLabelText: string,
  addrLabelText: string,
  closeLabelText: string,
  code?: string,
  existing?: L.Marker | null,
  layerGroup?: L.LayerGroup | L.Map,
  onAddress?: (addr: string) => void,
  openPopup = true,
): L.Marker => {
  if (existing) map.removeLayer(existing);
  const target = (layerGroup ?? map) as L.Map | L.LayerGroup;
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
    const closeBtn = (popupEl as L.Popup & { _closeButton?: HTMLAnchorElement })
      ._closeButton;
    if (closeBtn) closeBtn.title = closeLabelText || "";
  }
  if (!addr) {
    // Lazy access to the runtime singleton geocoder (kept out of this bundle).
    const foliplus = window.foliplus;
    if (foliplus?.reverseGeocode) {
      void foliplus
        .reverseGeocode(map, lng, lat, code)
        .then((resolved: string) => {
          if (onAddress) onAddress(resolved);
          if (marker && marker.getPopup && marker.getPopup()?.isOpen()) {
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
        })
        .catch(() => undefined);
    }
  }
  return marker;
};

/**
 * Update a layer item's label and its toggle input's aria-label with a new
 * display name.
 *
 * Only the toggle input is touched: it is the one toggle control on a row,
 * so the name must reach assistive tech — but via aria-label, never via
 * `title`, because `title` is the Select/Deselect tooltip slot (Select/Deselect
 * for a data row, the type label for the color basemap row).
 *
 * @param item Parent item element with `data-layer-id` (optional).
 * @param name New display name to apply.
 * @returns The updated label element, or null if not found.
 */
const updateItemLabel = (
  item: HTMLElement | null,
  name: string,
): HTMLLabelElement | null => {
  if (!item) return null;
  const label = item.querySelector("label") as HTMLLabelElement | null;
  if (!label) return null;
  label.textContent = name;
  // The row's toggle input announces the same name as the label cell. A data
  // row's toggle is its checkbox; the color basemap row's is the color swatch,
  // and it has no checkbox — without this the basemap swatch would keep
  // announcing the locale default after a rename.
  const toggle = item.querySelector(
    'input[type="checkbox"], input[type="color"]',
  ) as HTMLInputElement | null;
  if (toggle && toggle.getAttribute("aria-label") !== name)
    toggle.setAttribute("aria-label", name);
  return label;
};

/**
 * Remove an inline edit input from its label element. Used to tear down a
 * rename input after commit/cancel. The caller owns restoring the label text
 * (via updateItemLabel) — this only detaches the input.
 *
 * @param label The label element containing the inline edit input.
 * @returns The removed input element, or null if not found.
 */
const removeInlineEditInput = (
  label: HTMLLabelElement | null,
): HTMLInputElement | null => {
  if (!label) return null;
  const input = label.querySelector("input") as HTMLInputElement | null;
  if (input) label.removeChild(input);
  return input;
};

/**
 * Replace a label's text content with an inline text input for editing.
 *
 * Handles Enter (commit), Escape (cancel), and blur (commit if non-empty).
 * The input is appended into the label element; the caller owns removing it
 * and restoring the label text after the edit completes.
 *
 * Returns the created input element (already focused and selected).
 */
const createInlineEditInput = (opts: {
  label: HTMLLabelElement;
  initialValue: string;
  className: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  /** Called when the edit ends without committing — Escape (reason "escape")
   *  or an empty/whitespace Enter (reason "empty"). Callers can distinguish
   *  silent abandon from a rejected empty value (e.g. to show a hint). */
  onCancel: (reason: "escape" | "empty") => void;
  /** Gate blur-commit: only true while the edit is still the active one.
   *  Guards against a double-commit when Enter/Escape tear the input down
   *  (removing the focused element fires blur, which would re-commit stale
   *  value). Defaults to "always active". */
  isActive?: () => boolean;
}): HTMLInputElement => {
  const input = dom.el("input", {
    type: "text",
    value: opts.initialValue,
    class: opts.className,
    "aria-label": opts.ariaLabel,
  }) as HTMLInputElement;

  const commit = (value: string) => {
    if (opts.isActive && !opts.isActive()) return;
    const trimmed = value.trim();
    if (trimmed.length > 0) opts.onCommit(trimmed);
    else opts.onCancel("empty");
  };

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    // Stop every key from reaching the document-level InteractionManager —
    // otherwise ArrowLeft/Right (registered as layer shortcuts) preventDefault
    // and swallow the caret move, and Ctrl+Arrow would reorder the layer while
    // the user edits the name. The browser keeps its default caret/typing.
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commit(input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      opts.onCancel("escape");
    } else {
      event.stopPropagation();
    }
  });
  input.addEventListener("blur", () => commit(input.value));

  opts.label.textContent = "";
  opts.label.appendChild(input);
  input.focus();
  input.select();
  return input;
};

export {
  buildPopupHtml,
  createIconButton,
  createInlineEditInput,
  createLocationMarker,
  dom,
  escapeHTML,
  removeInlineEditInput,
  stopEvent,
  updateItemLabel,
};
