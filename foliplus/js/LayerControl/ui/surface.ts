// LayerControl UI — the structural surface of the `LayerUI` shell for the
// `ui/*` modules that program against it.
//
// Why this file exists: `ui/index.js` value-imports every submodule to build
// the delegates, and 26 submodules type-imported `LayerUI` back from
// `./index.js` — a type cycle that would turn `ui/index.js` into a
// cycle-participant rather than a plain barrel (a cycle through the barrel
// reorders module evaluation, which is what broke 13 tests when the barrels
// were first adopted). Relocating the class does not help: the delegates make
// the class file import the submodules either way, so any file the class
// lives in is imported back by them. Splitting the type out is the only cut
// that leaves the graph acyclic.
//
// The class pins this interface: `ui/index.js` declares
// `class LayerUI implements LayerUISurface`, so a member added to one side is
// a typecheck error on the other. Declarations are mirrored from the class,
// not retyped — inferred return types included.
//
// Keep it to what the `ui/*` modules actually read. Anything needing the
// constructor or the class identity takes the class type from `ui/index.js`.
import { type EventBus } from "#core/event/index.js";
import { type CreateColorAPI, type LayerRuntimeStore } from "#core/layer/index.js";
import type { Logger } from "#common/type.js";
import type { LayerController } from "../controller.js";
import type { LayerIntentStore } from "../domain/index.js";
import type { ProjectionBatch } from "./apply.js";
import type { FocusController } from "./focus/focusController.js";
import type { ListPanel } from "./listPanel/index.js";
import type { OverlayPanel } from "./overlayPanel/index.js";

/** What the `ui/*` modules read off the shell. See the header for the cycle
 *  this interface breaks, and `ui/index.js` for the class it mirrors. */
interface LayerUI {
  // ── env ──
  events: EventBus;
  config: ComponentConfig;
  T: (key: string) => string;
  _: (key: string) => string;
  log: Logger;

  // ── view subsystems ──
  listPanel: ListPanel;
  overlayPanel: OverlayPanel;
  focusController: FocusController;

  // ── stores + transient state ──
  readonly intentStore: LayerIntentStore;
  runtimeStore: LayerRuntimeStore;
  currentColor: string;
  colorSurface: CreateColorAPI | null;
  geometryMarqueeCleanup?: (() => void) | null;

  // ── DOM handler slots ──
  onChange: ((event: Event) => void) | null;
  onClick: ((event: Event) => void) | null;
  onFocusIn: ((event: FocusEvent) => void) | null;
  onFocusOut: ((event: FocusEvent) => void) | null;
  onDragStart: ((event: DragEvent) => void) | null;
  onDragOver: ((event: DragEvent) => void) | null;
  onDragLeave: ((event: DragEvent) => void) | null;
  onDragEnd: ((event: DragEvent) => void) | null;
  onDrop: ((event: DragEvent) => void) | null;
  onMoreClick: ((event: Event) => void) | null;
  onMoreMapClick: ((event: L.LeafletEvent) => void) | null;
  onZoomEnd: (() => void) | null;
  unsubscribeCountChange: (() => void) | null;
  unsubscribeControlAttached: (() => void) | null;
  unsubscribeEscape: (() => void) | null;
  unsubscribeLayerSignals: (() => void)[];

  // ── controller / DOM views ──
  readonly c: LayerController;
  readonly uiContainer: HTMLElement | null;

  // ── delegates the modules call on the shell ──
  activeLayerItem(): HTMLElement | null;
  refreshAllCounts(): void;
  saveState(): void;
  applyUserState(id?: string): ProjectionBatch;
  initTypesAndVisibility(): ProjectionBatch;
  handleOutsideMousedown(event: MouseEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
  openMoreMenu(item: HTMLElement): void;
  closeMoreMenu(setFocus: boolean): void;
  openAttrsPanel(item: HTMLElement): void;
  closeAttrsPanel(setFocus: boolean): void;
  openStylePanel(layerId: string): void;
  closeStylePanel(setFocus: boolean): void;
  openFilterPanel(item: HTMLElement): void;
  closeFilterPanel(setFocus: boolean): void;
  applyStyleLabelState(): void;
  renameLayer(layerId: string): void;
  finishRename(cancel?: boolean): void;
  focusLayer(layerId: string): void;
  isFocusing(): boolean;
  cancelFocus(): void;
  syncNoBasemap(): void;
}

export type { LayerUI };
