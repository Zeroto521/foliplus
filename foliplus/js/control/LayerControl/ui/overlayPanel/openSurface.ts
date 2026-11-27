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
// Now `ui.overlayPanel.surface` is the single stored answer. Openers call
// `openSurface(ui, next)` (which closes whatever is open first, so every entry
// point gets exclusivity for free); closers call `closeSurface(ui)` or, from
// inside their own close path, `clearSurface(ui, kind)`. Readers use the
// derived getters on `OverlayPanel` — they project `surface`, never a second
// copy. The overflow menu's `.open` class is a render product: written when
// the element is built, never read back as state.
//
// Extension point — a sixth surface needs exactly three edits:
//   1. one member in `OpenSurface` below (its `kind` + anchoring payload),
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

/** The dispatch table. Deliberately populated by the owners rather than
 *  imported here: a table literal would make this module import the panels
 *  that import it (a cycle through the barrel is exactly what reordered module
 *  evaluation once already). */
const surfaceClosers = new Map<SurfaceKind, SurfaceCloser>();

/** Register the close path for one surface kind. Called once at module load by
 *  the kind's owner. */
const registerSurfaceCloser = (kind: SurfaceKind, close: SurfaceCloser): void => {
  surfaceClosers.set(kind, close);
};

/** Close whichever surface is open. Returns whether anything was open.
 *
 *  Each closer clears the state itself (through `clearSurface`); the fallback
 *  clear covers a closer that throws or a state a test set without a close
 *  path, so the machine can never keep pointing at a surface that is gone. */
const closeSurface = (ui: LayerUI): boolean => {
  const open = ui.overlayPanel.surface;
  if (!open) return false;
  surfaceClosers.get(open.kind)?.(ui);
  if (ui.overlayPanel.surface === open) ui.overlayPanel.surface = null;
  return true;
};

/** Open `next`, closing whatever else is open first. This is the exclusivity
 *  rule, in one place: no opener has to know the other kinds, and a caller
 *  that forgot `closeOverlays` still cannot leave two surfaces up. */
const openSurface = (ui: LayerUI, next: OpenSurface): void => {
  if (ui.overlayPanel.surface) closeSurface(ui);
  ui.overlayPanel.surface = next;
};

/** Clear the state iff `kind` is the open one. The per-kind closers call this
 *  from inside their own teardown; a re-entrant close of a different kind is a
 *  no-op instead of a clobber. */
const clearSurface = (ui: LayerUI, kind: SurfaceKind): void => {
  if (ui.overlayPanel.surface?.kind === kind) ui.overlayPanel.surface = null;
};

/** Every kind that has a closer registered. The guard test asserts this covers
 *  the whole `OpenSurface` kind set once the shell is imported. */
const surfaceCloserKinds = (): SurfaceKind[] => [...surfaceClosers.keys()];

export {
  clearSurface,
  closeSurface,
  openSurface,
  registerSurfaceCloser,
  surfaceCloserKinds,
};
export type { OpenSurface, SurfaceKind };
