// control/LayerControl/ui/overlayPanel/openSurface — the one "what is open"
// state machine for LayerControl's floating surfaces.
//
// Why this module exists: "what is open" used to be described by five
// independent fields (activeMenu / activeAttrsPanel / activeFilterPanel /
// activeRenameId+activeRenameRow / stylePanelLayerId) plus the DOM nodes they
// pointed at, and "opening A closes B" was spread across six OVERLAY_CLEAR
// subscriptions in lifecycle.ts. Adding a surface meant editing every one of
// them, and a missed cleanup left two surfaces up at once.
//
// Now the machine owns the only stored answer, in a per-panel WeakMap. Openers
// call `openSurface(ui, next)` (which closes whatever is open first, so every
// entry point gets exclusivity for free); closers call `closeSurface(ui)` or,
// from inside their own close path, `clearSurface(ui, kind)`. Readers use
// `ui.overlayPanel.surface` (a read-only getter that projects this store) or
// the derived getters on `OverlayPanel` — never a second copy. The write path
// is private to this module, so a reader cannot fork the state and a test
// cannot bypass the machine by assigning a field. The overflow menu's `.open`
// class is a render product: written when the element is built, never read back
// as state.
//
// Extension point — a sixth surface needs exactly three edits:
//   1. one member in `OpenSurface` below (its `kind` + anchoring payload) AND
//      the matching entry in `SURFACE_KINDS` (the compiler rejects a kind that
//      is missing from either side),
//   2. one `registerSurfaceCloser(kind, close)` in the module that owns the
//      surface's close function (see the bottom of menu.ts / attr.ts /
//      filter.ts / style/index.ts / rename.ts),
//   3. one derived getter on `OverlayPanel` (overlayPanel/index.ts) for its
//      readers.
// No other file describes "what is open", so the exclusivity rule and the
// close dispatch cannot drift apart.
import type { LayerUI } from "../surface.js";
import type { FilterPanelState } from "./filter.js";

/** The one floating surface that may be open, or null. See the extension
 *  point above before adding a member. */
type OpenSurface =
  | { kind: "attrs"; item: HTMLElement; panel: HTMLElement; layerId: string }
  | { kind: "filter"; state: FilterPanelState }
  | {
      kind: "menu";
      item: HTMLElement;
      menu: HTMLElement;
      layerId: string;
      /** The folder key the menu was opened for (folder rows only). */
      folderKey?: string;
      /** The role the menu was opened for (role rows only). */
      role?: string;
    }
  | { kind: "rename"; row: HTMLElement; layerId: string | null }
  | { kind: "style"; layerId: string };

type SurfaceKind = OpenSurface["kind"];

/** How one kind tears itself down: remove its DOM, release its subscriptions
 *  and clear its state. Written once per kind by the owning module. */
type SurfaceCloser = (ui: LayerUI) => void;

/** Runtime mirror of the `OpenSurface` kind set. Both halves of the extension
 *  point are compiler-checked: `satisfies` rejects a listed kind that is not a
 *  union member, and `_everyKindListed` rejects a union member that is not
 *  listed. That is what makes the closer-table test below an assertion instead
 *  of a tautology — a new kind cannot compile until it is listed here, and the
 *  test then fails until its owner registers a closer. */
const SURFACE_KINDS = [
  "attrs",
  "filter",
  "menu",
  "rename",
  "style",
] as const satisfies readonly SurfaceKind[];

type _MissingKind = Exclude<SurfaceKind, (typeof SURFACE_KINDS)[number]>;
const _everyKindListed: _MissingKind extends never ? true : never = true;

/** The dispatch table. Deliberately populated by the owners rather than
 *  imported here: a table literal would make this module import the panels
 *  that import it (a cycle through the barrel is exactly what reordered module
 *  evaluation once already). */
const surfaceClosers = new Map<SurfaceKind, SurfaceCloser>();

/** The single stored answer, one entry per OverlayPanel. A WeakMap (not a
 *  writable field) is what makes the state read-only for everyone but this
 *  module: `OverlayPanel.surface` projects it, and open/close/clear are the
 *  only writes in the program. */
const surfaces = new WeakMap<object, OpenSurface | null>();

/** Read the open surface for one panel. Readers normally go through the
 *  `OverlayPanel.surface` getter; this exists for the getter itself and for
 *  test fixtures that mirror the class. */
const readSurface = (panel: object): OpenSurface | null => surfaces.get(panel) ?? null;

const writeSurface = (ui: LayerUI, next: OpenSurface | null): void => {
  surfaces.set(ui.overlayPanel, next);
};

/** Register the close path for one surface kind. Called once at module load by
 *  the kind's owner; returns the closer it replaced so a test can restore the
 *  real one after proving the throwing path (production never unregisters). */
const registerSurfaceCloser = (
  kind: SurfaceKind,
  close: SurfaceCloser,
): SurfaceCloser | undefined => {
  const previous = surfaceClosers.get(kind);
  surfaceClosers.set(kind, close);
  return previous;
};

/** Close whichever surface is open. Returns whether anything was open.
 *
 *  Each closer clears the state itself (through `clearSurface`); the fallback
 *  clear runs in a `finally`, so a closer that throws mid-teardown still
 *  leaves the machine at null. Without that, `openSurface` would see the dead
 *  surface and dispatch the same throwing closer a second time — turning one
 *  broken panel into a wedged control that cannot open anything. */
const closeSurface = (ui: LayerUI): boolean => {
  const open = readSurface(ui.overlayPanel);
  if (!open) return false;
  try {
    surfaceClosers.get(open.kind)?.(ui);
  } finally {
    if (readSurface(ui.overlayPanel) === open) writeSurface(ui, null);
  }
  return true;
};

/** Open `next`, closing whatever else is open first. This is the exclusivity
 *  rule, in one place: no opener has to know the other kinds, and a caller
 *  that forgot `closeOverlays` still cannot leave two surfaces up. */
const openSurface = (ui: LayerUI, next: OpenSurface): void => {
  if (readSurface(ui.overlayPanel)) closeSurface(ui);
  writeSurface(ui, next);
};

/** Clear the state iff `kind` is the open one. The per-kind closers call this
 *  from inside their own teardown; a re-entrant close of a different kind is a
 *  no-op instead of a clobber. */
const clearSurface = (ui: LayerUI, kind: SurfaceKind): void => {
  if (readSurface(ui.overlayPanel)?.kind === kind) writeSurface(ui, null);
};

/** Every kind that has a closer registered. The guard test asserts this covers
 *  the whole `OpenSurface` kind set once the shell is imported. */
const surfaceCloserKinds = (): SurfaceKind[] => [...surfaceClosers.keys()];

export {
  SURFACE_KINDS,
  clearSurface,
  closeSurface,
  openSurface,
  readSurface,
  registerSurfaceCloser,
  surfaceCloserKinds,
};
export type { OpenSurface };
