// control/LayerControl/ui/style/pickerHolder — the per-UI scheme-picker slot.
//
// The fill and border value rows each own one SchemePicker while their detail
// is mounted, plus the unregister for that picker's overlay-registry entry.
// The pair must be destroyed together when the panel closes or a mode switch
// rebuilds the detail, or a stale picker answers the next click. This holder
// is that lifecycle for any value channel: one WeakMap pair with one dispose.
import type { LayerUI } from "../surface.js";
import type { SchemePicker } from "#ui/index.js";

/** One panel channel's picker slot: register the live picker and its overlay
 *  unregister, then dispose both together. A channel that owns a picker (fill,
 *  border) creates one holder at module scope. */
type PickerHolder = {
  set: (ui: LayerUI, picker: SchemePicker, unregister: () => void) => void;
  dispose: (ui: LayerUI) => void;
};

const createPickerHolder = (): PickerHolder => {
  const pickerByUi = new WeakMap<LayerUI, SchemePicker>();
  const overlayByUi = new WeakMap<LayerUI, () => void>();
  return {
    set(ui, picker, unregister) {
      pickerByUi.set(ui, picker);
      overlayByUi.set(ui, unregister);
    },
    dispose(ui) {
      // The overlay entry first: unregistering closes the listbox, then the
      // picker destroys its own listeners.
      overlayByUi.get(ui)?.();
      overlayByUi.delete(ui);
      pickerByUi.get(ui)?.destroy();
      pickerByUi.delete(ui);
    },
  };
};

export { createPickerHolder };
