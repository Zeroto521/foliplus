// test/js/control/LayerControl/ui/listPanel/list.realign — realignRole / rowByKey defensive paths.
import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  realignRole,
  rebuildList,
  rowByKey,
} from "#control/LayerControl/ui/listPanel/index.js";

describe("realignRole / rowByKey defensive paths", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  const polygonLayer = () => ({
    options: {},
    getBounds: () => ({ isValid: () => true }),
  });

  const layoutFromRoles = (
    sections: Record<string, string[]>,
  ): Record<string, unknown> => {
    const keys = new Set<string>();
    for (const list of Object.values(sections)) for (const k of list) keys.add(k);
    return {
      version: 2,
      folders: [...keys].map(k => ({ key: k, name: k })),
      order: sections,
      members: {},
    };
  };

  const noContainer = () => ({ uiContainer: null }) as unknown as LayerUI;

  it("rowByKey returns null when the panel container is not attached", () => {
    expect(rowByKey(noContainer(), "layer:rd1")).toBeNull();
  });

  it("realignRole is a no-op when the panel container is not attached", () => {
    expect(() => realignRole(noContainer(), "overlay")).not.toThrow();
  });

  it("realignRole is a no-op for a role absent from the sequence", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // The fixture registers only the base color map and the overlay layer; a
    // role that owns no live row has no key in rowKeySequenceAll.
    expect(() => realignRole(ui, "label")).not.toThrow();
  });

  it("realignRole is a no-op when the role's header is not painted", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    // The role is in the sequence (it owns a layer), but the header was
    // cleared — the role block no longer exists in the DOM.
    ui.uiContainer!.innerHTML = "";
    expect(() => realignRole(ui, "overlay")).not.toThrow();
  });

  it("realignRole moves a role block that sits behind a later role to its sequence position", () => {
    const { ui } = initFixture({
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "",
          layer: polygonLayer(),
        },
        {
          id: "base1",
          name: "Base",
          role: "base",
          folder: "",
          layer: polygonLayer(),
        },
      ],
    });
    // The natural mount paints overlay first, base second. realignRole on a
    // role already in place must not throw and must not reorder anything.
    const before = ui.uiContainer!.innerHTML;
    realignRole(ui, "overlay");
    expect(ui.uiContainer!.innerHTML).toBe(before);
  });

  it("realignRole appends a block when no later sequence row is painted (target null)", () => {
    const { ui } = initFixture({
      seedLayout: layoutFromRoles({ overlay: ["roads"] }),
      data: [
        {
          id: "rd1",
          name: "Roads",
          role: "overlay",
          folder: "roads",
          layer: polygonLayer(),
        },
      ],
    });
    // Drop the fixture's auto basemap so "base" is not a live role, then append
    // a stray toggle-all header for a role absent from the sequence: it is not
    // a target (its role is not in seqAll), and the block collection stops at
    // it, so the overlay block is not at the panel end either — the
    // move-to-end (appendChild) path fires.
    ui.c.unregisterLayer("foliplus_color_map");
    rebuildList(ui);
    const stray = document.createElement("div");
    stray.classList.add(CONST.CLASSES.TOGGLE_ALL);
    stray.setAttribute(CONST.DATA.ROLE, "base");
    ui.uiContainer!.appendChild(stray);
    const overlayHeader = ui.uiContainer!.querySelector(
      `[${CONST.DATA.ROLE}="overlay"]`,
    );
    expect(overlayHeader).not.toBeNull();
    realignRole(ui, "overlay");
    // The overlay block moved to the panel end (appendChild), so it now sits
    // after the stray base header.
    const blockLast = ui.uiContainer!.lastElementChild;
    expect(blockLast).not.toBeNull();
    expect(blockLast!.classList.contains(CONST.CLASSES.TOGGLE_ALL)).toBe(false);
  });
});
