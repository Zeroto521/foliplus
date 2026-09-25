// ExportControl manager — class skeleton; crop/session/persistence bodies are
// installed on ExportManager.prototype so method names and this.x() call-through
// stay identical to the pre-split surface.
import { type EventBus, ensureEvents } from "#core/event/index.js";
import { type ModeManager, ensureModes } from "#core/mode.js";
import { createScopedTranslator } from "#common/locale.js";
import { type RafLoop } from "#common/rafLoop.js";
import {
  type CropRect,
  type CropState,
  type DragState,
  type GeoBounds,
  cropMethods,
} from "./crop.js";
import { registerInteractions } from "./interaction.js";
import { type SavedBounds, persistenceMethods } from "./persistence.js";
import { type TileLoadStats } from "./renderer/index.js";
import { canvasToBlob, sessionMethods } from "./session.js";
import {
  lockCropBox,
  removeCropBox,
  showCropBox,
  showGlobalHint,
  showHintWithInfo,
  unlockCropBox,
  updateBoxStyle,
} from "./ui.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).
const T = createScopedTranslator(CONF);

// Full instance surface. Merged with the class below so `this: ExportManager`
// in crop/session/persistence typechecks across the import cycle.
export interface ExportManager {
  map: L.Map;
  conf: ComponentConfig;
  T: (key: string) => string;
  modes: ModeManager;
  events: EventBus;
  dragCleanup?: () => void;
  interactionCleanup?: () => void;
  escapeCleanup?: () => void;
  cropMousedownCleanup?: () => void;
  mapContainer: HTMLElement;
  cropState: CropState | null;
  exportCtrl: HTMLElement | null;
  exportToolBar: HTMLElement | null;
  exportOverlay: HTMLElement | null;
  isExporting: boolean;
  pixelOverLimit: boolean;
  lastScreenRect: CropRect | null;
  savedBounds: SavedBounds | null;
  lastTileFailures: TileLoadStats[] | null;
  dragState: DragState;
  nudgeLoop?: RafLoop;
  nudgeMapRect?: DOMRect;
  nudgeActiveKey?: string;
  scheduler: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  mapMoveCleanup: (() => void) | null;
  showCropBox: () => void;
  lockCropBox: (skipHint?: boolean) => void;
  unlockCropBox: () => void;
  removeCropBox: () => void;
  updateBoxStyle: (el: HTMLElement, r: CropRect) => void;
  showHintWithInfo: (r: CropRect, instruction?: string) => void;
  showGlobalHint: (text: string, duration: number, withLoadingIcon?: boolean) => void;
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onPointerCancel(event: PointerEvent): void;
  onKeyDown(event: KeyboardEvent): void;
  onKeyUp(event: KeyboardEvent): void;
  nudgeStart(key: string): void;
  nudgeStop(): void;
  isEditing(): boolean;
  applyRect(r: CropRect, withHint?: boolean): void;
  resetCropBox(): void;
  nudgeCropBox(key: string): void;
  nudgeCropBoxDelta(dx: number, dy: number): void;
  defaultRect(): CropRect;
  checkPixelLimit(r: CropRect): void;
  loadSavedBounds(): void;
  saveBounds(bounds: GeoBounds): void;
  restoreFromSavedBounds(): void;
  onMapChange(skipHint?: boolean): void;
  lockMap(): void;
  unlockMap(): void;
  doExport(): void;
  doRender(
    r: CropRect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds | undefined,
    onProgress?: (percent: number) => void,
  ): Promise<void>;
  enlargeAndRender(
    r: CropRect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds,
    vpW: number,
    vpH: number,
    onProgress?: (percent: number) => void,
  ): void;
  onRenderSuccess(canvas: HTMLCanvasElement, hideEls: NodeListOf<Element>): void;
  finishExport(canvas: HTMLCanvasElement): Promise<void>;
  claimDownload(blob: Blob, filename: string): void;
  showPreview(blob: Blob): void;
  endExport(): void;
  downloadGeoTiff(canvas: HTMLCanvasElement, name: string): void;
  onRenderError(err: Error, hideEls: NodeListOf<Element>): void;
  removeExportOverlay(): void;
  attachUI(ctrl: HTMLElement, toolBar: HTMLElement): void;
  registerShortcuts(): void;
  unregisterShortcuts(): void;
}

// ==================== ExportManager ====================

export class ExportManager {
  map: L.Map;
  /** Component config — carried on the instance so the UI modules read it
   *  from `mgr.conf` instead of a module-level free variable. */
  conf: ComponentConfig;
  /** Translator bound to `conf`, created once in the constructor. */
  T: (key: string) => string;
  /** Per-map mode manager / event bus — bound once in the constructor
   *  (ensure-style getters return the cached instance). */
  modes: ModeManager;
  events: EventBus;
  dragCleanup?: () => void;
  interactionCleanup?: () => void;
  escapeCleanup?: () => void;
  cropMousedownCleanup?: () => void;
  mapContainer: HTMLElement;
  cropState: CropState | null;
  exportCtrl: HTMLElement | null;
  exportToolBar: HTMLElement | null;
  exportOverlay: HTMLElement | null;
  isExporting: boolean;
  pixelOverLimit: boolean;
  lastScreenRect: CropRect | null;
  savedBounds: SavedBounds | null;
  /** Per-layer tile load stats from the most recent render, read by
   *  finishExport to warn about CORS-blocked tile sources over the success
   *  label.  Reset at the start of each export. */
  lastTileFailures: TileLoadStats[] | null;
  dragState: DragState;
  nudgeLoop?: RafLoop;
  nudgeMapRect?: DOMRect;
  nudgeActiveKey?: string;
  /**
   * Overridable timer function for the smooth-nudge rafLoop. Defaults to
   * setTimeout (production). Browser tests inject a no-op so each rafLoop
   * runs exactly one synchronous tick, making the one-step-per-keydown
   * behavior deterministic without touching global state.
   */
  scheduler: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  declare mapMoveCleanup: (() => void) | null;

  // Mounted UI helpers (assigned in constructor).
  declare showCropBox: () => void;
  declare lockCropBox: (skipHint?: boolean) => void;
  declare unlockCropBox: () => void;
  declare removeCropBox: () => void;
  declare updateBoxStyle: (el: HTMLElement, r: CropRect) => void;
  declare showHintWithInfo: (r: CropRect, instruction?: string) => void;
  declare showGlobalHint: (
    text: string,
    duration: number,
    withLoadingIcon?: boolean,
  ) => void;

  constructor(
    mapInstance: L.Map,
    scheduler: (
      fn: () => void,
      ms: number,
    ) => ReturnType<typeof setTimeout> = setTimeout,
  ) {
    this.map = mapInstance;
    this.mapContainer = this.map.getContainer();
    this.scheduler = scheduler;
    this.conf = CONF;
    this.T = T;
    this.modes = ensureModes(this.map);
    this.events = ensureEvents(this.map);

    this.cropState = null;
    this.exportCtrl = null;
    this.exportToolBar = null;
    this.exportOverlay = null;
    this.isExporting = false;
    this.pixelOverLimit = false;
    this.lastScreenRect = null;
    this.savedBounds = null;
    this.lastTileFailures = null;
    this.loadSavedBounds();

    this.dragState = {
      dragging: false,
      dragType: null,
      lastX: 0,
      lastY: 0,
    };

    this.onMapChange = this.onMapChange.bind(this);

    // Mount UI functions directly on this instance
    this.showCropBox = () => showCropBox(this);
    this.lockCropBox = (skipHint?: boolean) => lockCropBox(this, skipHint);
    this.unlockCropBox = () => unlockCropBox(this);
    this.removeCropBox = () => removeCropBox(this);
    this.updateBoxStyle = (el: HTMLElement, r: CropRect) => updateBoxStyle(this, el, r);
    this.showHintWithInfo = (r: CropRect, instruction?: string) =>
      showHintWithInfo(this, r, instruction);
    this.showGlobalHint = (text: string, duration: number, withLoadingIcon?: boolean) =>
      showGlobalHint(this, text, duration, withLoadingIcon);
  }

  attachUI(ctrl: HTMLElement, toolBar: HTMLElement) {
    this.exportCtrl = ctrl;
    this.exportToolBar = toolBar;
  }

  registerShortcuts(): void {
    this.interactionCleanup = registerInteractions(this);
  }

  unregisterShortcuts(): void {
    this.interactionCleanup?.();
    this.interactionCleanup = undefined;
  }
}

// Install the split method bodies on the prototype. Own-property assignment
// (not a wrapper) keeps `this.x()` call-through spyable and the runtime cost
// identical to the pre-split class methods.
Object.assign(ExportManager.prototype, cropMethods, persistenceMethods, sessionMethods);

export { type CropRect, canvasToBlob };
