// Tests for common/portalRoot — the per-overlay ownership of portalled nodes.
import type * as L from "leaflet";
import { afterEach, describe, expect, it } from "vitest";
import { isInsideOverlay } from "#core/overlay.js";
import {
  OVERLAY_IDS,
  type OverlayEntry,
  ensureOverlayRegistry,
} from "#core/overlayRegistry.js";
import { isPortalOf, registerPortalRoot } from "#common/portalRoot.js";

const node = (className?: string): HTMLElement => {
  const el = document.createElement("div");
  if (className) el.className = className;
  return el;
};

/** Two panels, each with its own trigger, and a portalled list per trigger —
 *  the shape two open overlays take on one page. */
const mount = () => {
  const panelA = node("panel-a");
  const triggerA = node("trigger-a");
  panelA.appendChild(triggerA);
  const panelB = node("panel-b");
  const triggerB = node("trigger-b");
  panelB.appendChild(triggerB);
  const listA = node("list-a");
  const rowA = node("row-a");
  listA.appendChild(rowA);
  const listB = node("list-b");
  listB.appendChild(node("row-b"));
  document.body.append(panelA, panelB, listA, listB);
  return { panelA, triggerA, panelB, triggerB, listA, rowA, listB };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("registerPortalRoot", () => {
  it("attributes the portalled node to the panel that owns the trigger", () => {
    const { panelA, triggerA, listA, rowA } = mount();
    const release = registerPortalRoot(listA, triggerA);
    try {
      expect(isPortalOf(listA, panelA)).toBe(true);
      expect(isPortalOf(rowA, panelA)).toBe(true);
    } finally {
      release();
    }
    expect(isPortalOf(listA, panelA)).toBe(false);
    expect(isPortalOf(rowA, panelA)).toBe(false);
  });

  it("does not lend the node to another overlay", () => {
    // The whole point of per-entry ownership: panel B must not see panel A's
    // portalled list as its own, or a press on A's row would keep B open too.
    const { panelA, triggerA, panelB, listA, rowA } = mount();
    const release = registerPortalRoot(listA, triggerA);
    try {
      expect(isPortalOf(rowA, panelB)).toBe(false);
      expect(isInsideOverlay(rowA, panelA)).toBe(true);
      expect(isInsideOverlay(rowA, panelB)).toBe(false);
    } finally {
      release();
    }
  });

  it("ignores nodes outside the registered root", () => {
    const { panelA, triggerA, listB } = mount();
    const release = registerPortalRoot(listB, triggerA);
    try {
      expect(isPortalOf(node("stray"), panelA)).toBe(false);
    } finally {
      release();
    }
  });

  it("treats a repeated release as a no-op", () => {
    const { panelA, triggerA, listA } = mount();
    const release = registerPortalRoot(listA, triggerA);
    release();
    release();
    expect(isPortalOf(listA, panelA)).toBe(false);
  });

  it("attributes the row to the owning entry, not to a higher-ranked one", () => {
    // The dispatcher's own containment: entry A owns the trigger, entry B does
    // not. owningEntry() must answer A even though B outranks it in
    // ESC_PRIORITY — ranking decides between surfaces that both contain the
    // target, never whether an unrelated surface contains it.
    const { panelA, triggerA, panelB, listA, rowA } = mount();
    const registry = ensureOverlayRegistry({
      on: () => undefined,
    } as unknown as L.Map);
    const entry = (id: string, panels: Element[]): OverlayEntry => ({
      id,
      dismissOn: "mousedown",
      isOpen: () => true,
      close: () => undefined,
      panels: () => panels,
      pressPriority: 0,
    });
    const style = entry(OVERLAY_IDS.LAYER_STYLE, [panelA]);
    const menu = entry(OVERLAY_IDS.LAYER_MENU, [panelB]);
    const releaseStyle = registry.register(style);
    const releaseMenu = registry.register(menu);
    const releasePortal = registerPortalRoot(listA, triggerA);
    try {
      expect(registry.contains(style, rowA)).toBe(true);
      expect(registry.contains(menu, rowA)).toBe(false);
      expect(registry.owningEntry(rowA)).toBe(style);
    } finally {
      releasePortal();
      releaseStyle();
      releaseMenu();
      registry.destroy();
    }
  });

  it("makes isInsideOverlay accept a press on the owned row only", () => {
    const { panelA, triggerA, listA, rowA } = mount();
    const release = registerPortalRoot(listA, triggerA);
    try {
      expect(isInsideOverlay(rowA, panelA)).toBe(true);
    } finally {
      release();
    }
    expect(isInsideOverlay(rowA, panelA)).toBe(false);
  });
});
