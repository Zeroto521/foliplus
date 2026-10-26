import { afterEach, describe, expect, it } from "vitest";
import { isInsideOverlay } from "#common/overlay.js";

const node = (className?: string): HTMLElement => {
  const el = document.createElement("div");
  if (className) el.className = className;
  return el;
};

/** A panel mounted in the document, plus a "portalled" node parked next to it
 *  under <body> — the shape the scheme picker's dropdown takes. */
const mount = () => {
  const panel = node("foliplus-panel");
  const inner = node();
  panel.appendChild(inner);
  const portal = node("foliplus-portal");
  const portalRow = node("foliplus-portal-row");
  portal.appendChild(portalRow);
  const outside = node();
  document.body.append(panel, portal, outside);
  return { panel, inner, portal, portalRow, outside };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isInsideOverlay", () => {
  it("accepts a press inside the panel, at any depth", () => {
    const { panel, inner } = mount();
    expect(isInsideOverlay(panel, panel)).toBe(true);
    expect(isInsideOverlay(inner, panel)).toBe(true);
  });

  it("accepts a press on a portalled node when the overlay names one", () => {
    const { panel, portal, portalRow } = mount();
    const selector = ".foliplus-portal";
    // The portalled node is outside the panel's subtree, so only the portal
    // selector can classify it as part of the overlay.
    expect(panel.contains(portalRow)).toBe(false);
    expect(isInsideOverlay(portal, panel, selector)).toBe(true);
    expect(isInsideOverlay(portalRow, panel, selector)).toBe(true);
  });

  it("rejects a portalled node when the overlay names no portal", () => {
    const { panel, portalRow } = mount();
    expect(isInsideOverlay(portalRow, panel)).toBe(false);
  });

  it("rejects a press elsewhere in the document", () => {
    const { panel, outside } = mount();
    expect(isInsideOverlay(outside, panel, ".foliplus-portal")).toBe(false);
  });

  it("answers outside for a document-level target and for no target", () => {
    const { panel } = mount();
    expect(isInsideOverlay(document, panel, ".foliplus-portal")).toBe(false);
    expect(isInsideOverlay(null, panel, ".foliplus-portal")).toBe(false);
    // A non-node EventTarget (some synthetic dispatch paths) answers outside.
    expect(isInsideOverlay(new EventTarget(), panel)).toBe(false);
  });

  it("answers outside when the panel is missing", () => {
    const { portalRow } = mount();
    expect(isInsideOverlay(portalRow, null, ".foliplus-portal")).toBe(true);
    expect(isInsideOverlay(portalRow, null)).toBe(false);
  });
});
