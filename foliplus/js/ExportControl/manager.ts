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

// ==================== ExportManager ====================

class ExportManager {
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

  // Method bodies live in crop.ts / session.ts / persistence.ts and are
  // installed via Object.assign below. Declared here so the class type
  // matches the pre-split public surface.
  declare onPointerDown: (event: PointerEvent) => void;
  declare onPointerMove: (event: PointerEvent) => void;
  declare onPointerUp: (event: PointerEvent) => void;
  declare onPointerCancel: (event: PointerEvent) => void;
  declare onKeyDown: (event: KeyboardEvent) => void;
  declare onKeyUp: (event: KeyboardEvent) => void;
  declare nudgeStart: (key: string) => void;
  declare nudgeStop: () => void;
  declare isEditing: () => boolean;
  declare applyRect: (r: CropRect, withHint?: boolean) => void;
  declare resetCropBox: () => void;
  declare nudgeCropBox: (key: string) => void;
  declare nudgeCropBoxDelta: (dx: number, dy: number) => void;
  declare defaultRect: () => CropRect;
  declare checkPixelLimit: (r: CropRect) => void;
  declare loadSavedBounds: () => void;
  declare saveBounds: (bounds: GeoBounds) => void;
  declare restoreFromSavedBounds: () => void;
  declare onMapChange: (skipHint?: boolean) => void;
  declare lockMap: () => void;
  declare unlockMap: () => void;
  declare doExport: () => void;
  declare doRender: (
    r: CropRect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds | undefined,
    onProgress?: (percent: number) => void,
  ) => Promise<void>;
  declare enlargeAndRender: (
    r: CropRect,
    scaleValue: number,
    bg: string | undefined,
    geoBounds: GeoBounds,
    vpW: number,
    vpH: number,
    onProgress?: (percent: number) => void,
  ) => void;
  declare onRenderSuccess: (
    canvas: HTMLCanvasElement,
    hideEls: NodeListOf<Element>,
  ) => void;
  declare finishExport: (canvas: HTMLCanvasElement) => Promise<void>;
  declare claimDownload: (blob: Blob, filename: string) => void;
  declare showPreview: (blob: Blob) => void;
  declare endExport: () => void;
  declare downloadGeoTiff: (canvas: HTMLCanvasElement, name: string) => void;
  declare onRenderError: (err: Error, hideEls: NodeListOf<Element>) => void;
  declare removeExportOverlay: () => void;

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

export { ExportManager, canvasToBlob };
export type { CropRect };
