// test/js/control/LayerControl/ui/style/drag.fixture — shared stubs for the drag aspect suites.
import { attachedPanel, initFixture } from "../fixture.js";
import { vi } from "vitest";
import { type LayerInfo, ROLE } from "#foliplus/core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";

export const dragEvent = (
  target: HTMLElement,
  dataTransfer = {},
  clientY = 0,
): DragEvent =>
  ({
    target,
    clientY,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer,
  }) as unknown as DragEvent;

/** Pin a row's box. jsdom reports a zero-height rect for every element, and a
 *  zero-height row is the "into" zone — the before/after edges only exist once
 *  the row has a height. */
export const pinRect = (row: HTMLElement, top: number, height: number): void => {
  row.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

/** Overlay rows for a real fixture: n data layers, ids `L<i>`. */
export const overlays = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `L${i}`,
    name: `L${i}`,
    role: "overlay" as const,
  }));

export const rowOf = (ui: LayerUI, id: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.LAYER_ID}="${id}"]`) as HTMLElement;

export const orderOf = (manager: { layers: readonly LayerInfo[] }) =>
  manager.layers.filter(l => l.role === ROLE.OVERLAY).map(l => l.id);

export const makeUi = (
  opts: {
    layers?: LayerInfo[];
    containers?: string[];
  } = {},
): LayerUI => {
  const layers =
    opts.layers ??
    (opts.containers ?? []).map(id => ({ id, name: id, role: "overlay" }) as LayerInfo);
  const uiContainer = document.createElement("div");
  for (const id of opts.containers ?? []) {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    row.setAttribute(CONST.DATA.LAYER_ID, id);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    row.appendChild(box);
    uiContainer.appendChild(row);
  }
  return {
    uiContainer,
    foldedRoles: {},
    listPanel: {
      foldedRoles: {},
      checkedCount: {},
      dragEntry: null,
      lastDragHintAt: 0,
      lastDragOverItem: null,
    },
    saveFoldState: vi.fn(),
    lastDragOverItem: null,
    c: {
      layers,
      findLayer: vi.fn(() => ({ options: {} })),
      map: {
        on: vi.fn(),
        off: vi.fn(),
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
        addLayer: vi.fn(),
        foliplus: { hint: { set: vi.fn(), clear: vi.fn(), registerIcon: vi.fn() } },
      },
      debouncedEnforce: vi.fn(),
      saveOrder: vi.fn(),
      enforceOrder: vi.fn(),
      reorderLayer: vi.fn(),
      layerRegistry: {
        get: (id: string) => layers.find(l => l.id === id),
        indexOf: (entry: LayerInfo) => layers.indexOf(entry),
        indexOfId: (id: string) => layers.findIndex(l => l.id === id),
        at: (idx: number) => layers[idx],
      },
      persistence: { schedule: vi.fn() } as any,
    },
  } as unknown as LayerUI;
};

/** A layout document with the given overlay folder keys in block order. */
export const folderViewDoc = (keys: string[]) => ({
  version: 2,
  folders: keys.map(k => ({ key: k, name: k })),
  order: { overlay: keys },
  members: {},
});

export const folderFixture = (keys: string[]) =>
  initFixture({
    seedLayout: folderViewDoc(keys),
    data: keys.map(k => ({
      id: `${k}1`,
      name: `${k}1`,
      role: "overlay" as const,
      folder: k,
      layer: { options: {}, eachLayer: vi.fn() },
    })),
  });

export const folderRowOf = (ui: LayerUI, key: string): HTMLElement =>
  attachedPanel(ui).querySelector(`[${CONST.DATA.FOLDER_KEY}="${key}"]`) as HTMLElement;

/** A layer group layer stub, so isGroupDrag answers true. */
export const groupLayerFixture = () => ({
  options: {},
  eachLayer: vi.fn(),
  _layers: {},
  addLayer: vi.fn(),
  getLayers: vi.fn(() => []),
});
