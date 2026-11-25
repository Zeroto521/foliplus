// test/js/control/LayerControl/ui/style/list.fixture — shared stubs for the list aspect suites.
import { attachedPanel } from "../fixture.js";
import { ROLE } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { LayerIntentStore } from "#control/LayerControl/domain/index.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getNavigableItems } from "#control/LayerControl/ui/listPanel/index.js";

export const makeUi = () =>
  ({
    intentStore: new LayerIntentStore(),
    renamedNames: {},
    c: { layerRegistry: { get: () => undefined } },
    T: (k: string) => k,
  }) as unknown as LayerUI;

/** Layer rows for n overlays + m base maps. */
export const benchData = (overlays: number, bases: number) => [
  ...Array.from({ length: overlays }, (_, i) => ({
    id: `overlay_${i}`,
    name: `Overlay ${i}`,
    role: "overlay" as const,
  })),
  ...Array.from({ length: bases }, (_, i) => ({
    id: `base_${i}`,
    name: `Base ${i}`,
    role: "base" as const,
  })),
];

export const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

/** Whether this engine refuses `focus()` on a `display: none` subtree.
 *
 *  The folded-survivor case below stages a folded row with an inline
 *  `display: none` and depends on the engine declining to focus it — the same
 *  refusal a browser applies to a folded group. jsdom only added that rule (a
 *  computed `display` check in its focus helper) in 30.1.0; on 30.0.x the
 *  focus lands, so there the test's *premise* — not its assertions — is false
 *  and the neighbour walk is unreachable. Probing the engine instead of
 *  pinning a version keeps the case honest on both: it runs where the refusal
 *  exists and skips where it does not.
 */
export const refusesHiddenFocus = (() => {
  const probe = document.createElement("div");
  probe.setAttribute("tabindex", "0");
  probe.style.display = "none";
  document.body.appendChild(probe);
  probe.focus();
  const declined = document.activeElement !== probe;
  // Leave the document as found: if the probe took focus, give it back.
  if (!declined) probe.blur();
  probe.remove();
  return declined;
})();

/** Child sequence signature: layer rows by id, anchors by group. */
export const childKeys = (ui: LayerUI) =>
  Array.from(attachedPanel(ui).children).map(
    el =>
      el.getAttribute(CONST.DATA.LAYER_ID) ?? `role:${el.getAttribute("data-role")}`,
  );

/** The panel sequence renderInitialList would emit for this registry: each
 *  group's anchor before its first row, rows in registry order. */
export const registryKeys = (manager: LayerController): string[] => {
  const keys: string[] = [];
  let seenOverlay = false;
  let seenBase = false;
  for (const layerInfo of manager.layers) {
    if (layerInfo.role !== ROLE.BASE && !seenOverlay) {
      seenOverlay = true;
      keys.push(`role:${ROLE.OVERLAY}`);
    }
    if (layerInfo.role === ROLE.BASE && !seenBase) {
      seenBase = true;
      keys.push(`role:${ROLE.BASE}`);
    }
    keys.push(layerInfo.id);
  }
  return keys;
};

/** The five cursor ledgers a membership change must keep on one row: the
 *  numeric index, the FOCUSED marker, the one roving tab stop, and where
 *  DOM focus actually is. All read as row identities, not positions. */
export const cursorLedger = (ui: LayerUI) => {
  const idOf = (el: Element | null | undefined) =>
    el
      ? (el.getAttribute(CONST.DATA.LAYER_ID) ?? `role:${el.getAttribute("data-role")}`)
      : null;
  const items = getNavigableItems(ui);
  return {
    active: idOf(items[ui.listPanel.activeIdx ?? -1]),
    marked: idOf(attachedPanel(ui).querySelector(`.${CONST.CLASSES.FOCUSED}`)),
    tabStops: items.filter(el => el.tabIndex === 0).map(el => idOf(el)),
    domFocus: idOf(
      (document.activeElement as HTMLElement | null)?.closest?.(CONST.SEL.LAYER_ITEM) ??
        null,
    ),
  };
};
