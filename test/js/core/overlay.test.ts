import { afterEach, describe, expect, it } from "vitest";
import { isInsideOverlay } from "#core/overlay.js";

const node = (className?: string): HTMLElement => {
  const el = document.createElement("div");
  if (className) el.className = className;
  return el;
};

/** A panel mounted in the document, plus a node parked next to it under <body>
 *  — the shape a portalled list takes. Nothing registers it here: a class name
 *  is not ownership, so this fixture is the "nobody owns this press" case. */
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

  it("answers outside for a portalled node no overlay registered", () => {
    const { panel, portal, portalRow } = mount();
    // Outside the panel's subtree and unregistered: only ownership can make
    // this node part of the overlay (common/portalRoot), and nobody claimed it.
    expect(panel.contains(portalRow)).toBe(false);
    expect(isInsideOverlay(portal, panel)).toBe(false);
    expect(isInsideOverlay(portalRow, panel)).toBe(false);
  });

  it("rejects a press elsewhere in the document", () => {
    const { panel, outside } = mount();
    expect(isInsideOverlay(outside, panel)).toBe(false);
  });

  it("answers outside for a document-level target and for no target", () => {
    const { panel } = mount();
    expect(isInsideOverlay(document, panel)).toBe(false);
    expect(isInsideOverlay(null, panel)).toBe(false);
    // A non-node EventTarget (some synthetic dispatch paths) answers outside.
    expect(isInsideOverlay(new EventTarget(), panel)).toBe(false);
  });

  it("answers outside when the panel is missing", () => {
    const { portalRow } = mount();
    expect(isInsideOverlay(portalRow, null)).toBe(false);
  });
});
