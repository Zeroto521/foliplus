// PanelStore — control-side UI transient state defaults.
//
// T270 phase 2: the fields that rode LayerUI move into the store; the suite
// pins the initial shape so a field added later starts from a sane default.
import { describe, expect, it } from "vitest";
import { PanelStore } from "#foliplus/LayerControl/ui/panelStore.js";

describe("PanelStore defaults", () => {
  it("fold/drag/keyboard state starts empty", () => {
    const ps = new PanelStore();
    expect(ps.foldedGroups.size).toBe(0);
    expect(ps.checkedCount).toEqual({});
    expect(ps.dragIdx).toBeNull();
    expect(ps.lastDragHintAt).toBe(0);
    expect(ps.lastDragOverItem).toBeNull();
    expect(ps.pressInPanel).toBe(false);
    expect(ps.activeIdx).toBeNull();
    expect(ps.listCursor).toBeNull();
    expect(ps.interactionCleanup).toBeUndefined();
  });

  it("open-panel / rename slots start closed", () => {
    const ps = new PanelStore();
    expect(ps.activeMenu).toBeNull();
    expect(ps.activeAttrsPanel).toBeNull();
    expect(ps.stylePanelLayerId).toBeNull();
    expect(ps.activeRenameId).toBeNull();
  });

  it("handler slots start null (retired in phase 3)", () => {
    const ps = new PanelStore();
    for (const key of [
      "onChange",
      "onInput",
      "onClick",
      "onFocusIn",
      "onFocusOut",
      "onDragStart",
      "onDragOver",
      "onDragLeave",
      "onDragEnd",
      "onDrop",
      "onMoreClick",
      "onMoreMenuClick",
      "onMoreMapClick",
      "onZoomEnd",
      "unsubscribeCountChange",
      "unsubscribeControlAttached",
      "attrsOutsideHandler",
      "styleOutsideHandler",
      "attrsUnsubscribe",
      "styleUnsubscribe",
      "styleRefresh",
      "styleZoomEndHandler",
      "geometryMarqueeCleanup",
    ] as const) {
      expect((ps as Record<string, unknown>)[key]).toBeNull();
    }
  });
});
