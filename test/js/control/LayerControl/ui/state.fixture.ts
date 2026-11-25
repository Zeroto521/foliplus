// test/js/control/LayerControl/ui/style/state.fixture — shared stubs for the state aspect suites.
import { type PaneSpec } from "#foliplus/core/layer/index.js";
import { LayerIntentStore } from "#control/LayerControl/domain/index.js";

/** The pane spec list `createLayers` derives from an ordered name list: the
 *  first name is the base pane, everything after it a `sub`. */
export const specs = (...names: string[]): PaneSpec[] =>
  names.map((name, i) => ({ role: i === 0 ? "base" : "sub", order: i, name }));

/** Build a LayerIntentStore from the old two-map fixture shape. */
export const makeStore = (
  intents: Record<string, Record<string, unknown>> = {},
  provenance: Record<string, string[]> = {},
): LayerIntentStore => {
  const store = new LayerIntentStore();
  store.replaceIntents(intents as never);
  store.replaceProvenance(provenance as never);
  return store;
};
