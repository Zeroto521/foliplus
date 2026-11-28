// control/LayerControl/ui/style/pickerHolder — the per-UI scheme-picker slot.
//
// The fill and border value rows each own one SchemePicker while their detail
// is mounted. The pair must be destroyed together when the panel closes or a
// mode switch rebuilds the detail, or a stale picker answers the next click.
// This holder is that lifecycle for any value channel: one WeakMap slot with one
// dispose. The picker's overlay registration is the picker's own (the listbox
// engine registers the open list through the injected registry hook and
// unregisters it on close), so the holder no longer tracks an unregister.
import type { LayerUI } from "../surface.js";
import type { SchemePicker } from "#ui/index.js";

/** One panel channel's picker slot: register the live picker, then dispose it. A
 *  channel that owns a picker (fill, border) creates one holder at module
 *  scope. */
type PickerHolder = {
  set: (ui: LayerUI, picker: SchemePicker) => void;
  dispose: (ui: LayerUI) => void;
};

const createPickerHolder = (): PickerHolder => {
  const pickerByUi = new WeakMap<LayerUI, SchemePicker>();
  return {
    set(ui, picker) {
      pickerByUi.set(ui, picker);
    },
    dispose(ui) {
      pickerByUi.get(ui)?.destroy();
      pickerByUi.delete(ui);
    },
  };
};

export { createPickerHolder };
