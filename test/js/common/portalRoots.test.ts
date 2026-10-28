// Tests for common/portalRoots — the registry that lets an overlay that
// portals its content still count a press on that content as its own.
import { afterEach, describe, expect, it } from "vitest";
import { isInsideOverlay } from "#core/overlay.js";
import { isInPortalRoot, registerPortalRoot } from "#common/portalRoots.js";

const node = (className?: string): HTMLElement => {
  const el = document.createElement("div");
  if (className) el.className = className;
  return el;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("registerPortalRoot", () => {
  it("reports the registered node and its descendants", () => {
    const root = node("portal");
    const row = node("row");
    root.appendChild(row);
    document.body.appendChild(root);
    const release = registerPortalRoot(root);
    try {
      expect(isInPortalRoot(root)).toBe(true);
      expect(isInPortalRoot(row)).toBe(true);
    } finally {
      release();
    }
    expect(isInPortalRoot(root)).toBe(false);
    expect(isInPortalRoot(row)).toBe(false);
  });

  it("ignores nodes outside every registered root", () => {
    const root = node("portal");
    const sibling = node("sibling");
    document.body.append(root, sibling);
    const release = registerPortalRoot(root);
    try {
      expect(isInPortalRoot(sibling)).toBe(false);
    } finally {
      release();
    }
  });

  it("treats a repeated release as a no-op", () => {
    // One owner per portalled node: ownership is the node itself, so closing a
    // popup that already tore down must not throw or unregister anything else.
    const root = node("portal");
    const other = node("other-portal");
    document.body.append(root, other);
    const release = registerPortalRoot(root);
    const releaseOther = registerPortalRoot(other);
    release();
    release();
    expect(isInPortalRoot(root)).toBe(false);
    expect(isInPortalRoot(other)).toBe(true);
    releaseOther();
    expect(isInPortalRoot(other)).toBe(false);
  });

  it("makes isInsideOverlay accept a press on the portalled node", () => {
    const panel = node("panel");
    const portalList = node("portal");
    const row = node("row");
    portalList.appendChild(row);
    document.body.append(panel, portalList);
    const release = registerPortalRoot(portalList);
    try {
      expect(isInsideOverlay(row, panel)).toBe(true);
    } finally {
      release();
    }
    expect(isInsideOverlay(row, panel)).toBe(false);
  });
});
