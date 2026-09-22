// ExportControl interaction — keyboard + pointer event registration.
import { ensureInteraction } from "#core/interaction.js";
import * as CONST from "./const.js";
import type { ExportManager } from "./manager.js";

// Keys that confirm / reset / nudge the crop box. They require map container
// focus (so typing into other inputs elsewhere doesn't move the box) and are
// all routed through onKeyDown.
const CROP_KEYS = ["Enter", "r", "R", ...CONST.NUDGE_KEYS];

const registerInteractions = (mgr: ExportManager): (() => void) => {
  const im = ensureInteraction(mgr.map);
  const container = mgr.map.getContainer();

  // All shortcuts registered under a single component name so the returned
  // cleanup function unregisters them all at once when the crop box is removed.
  return im.register(CONF.name, [
    // Escape: global — dismiss crop box from anywhere.
    { key: "Escape", handler: e => mgr.onKeyDown(e as KeyboardEvent) },
    // Enter / R / arrows: container-bound, routed through onKeyDown.
    ...CROP_KEYS.map(key => ({
      key,
      container,
      handler: (e: Event) => mgr.onKeyDown(e as KeyboardEvent),
    })),
    // Arrow keyup: stop the smooth-nudge loop on release. Document-bound
    // (not container-bound) because the keydown is container-bound but
    // focus can leave the map between down and up (click elsewhere, Tab);
    // if the matching keyup were container-bound it'd be filtered out and
    // the rafLoop would drift forever. onKeyUp only acts on arrow keys and
    // stops the loop, so firing globally is safe.
    ...CONST.NUDGE_KEYS.map(key => ({
      key,
      event: "keyup",
      handler: (e: Event) => mgr.onKeyUp(e as KeyboardEvent),
    })),
  ]);
};

// Pointer events, not mouse events: `mouse*` has no capture contract, so one
// dropped move mid-drag leaks the incremental delta and the box lands short
// of the cursor. Pointers also cover touch and pen, where the drop is most
// likely — a touch pinch cancels the pointer and never delivers a mouseup,
// which is what leaves the drag listeners registered and the box stuck.
const registerDrag = (mgr: ExportManager): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-drag`, [
    {
      event: "pointermove",
      handler: (e: Event) => mgr.onPointerMove(e as PointerEvent),
    },
    {
      event: "pointerup",
      handler: (e: Event) => {
        mgr.onPointerUp(e as PointerEvent);
      },
    },
    {
      event: "pointercancel",
      handler: (e: Event) => {
        mgr.onPointerCancel(e as PointerEvent);
      },
    },
  ]);
};

const registerCropMouseDown = (
  mgr: ExportManager,
  element: HTMLElement,
): (() => void) => {
  return ensureInteraction(mgr.map).register(`${CONF.name}-crop`, [
    {
      event: "pointerdown",
      element,
      handler: (e: Event) => mgr.onPointerDown(e as PointerEvent),
    },
  ]);
};

export { registerInteractions, registerDrag, registerCropMouseDown };
