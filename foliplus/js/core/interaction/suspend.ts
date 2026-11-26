// core/interaction/suspend — suspend a whole map's interactive leaves, restore exactly them.
//
// The invariant holds in both directions: the collect pass remembers ONLY the
// leaves whose `options.interactive` was true at suspension time, and the
// restore closure re-enables exactly that set. Tiles, labels and
// non-interactive previews are never touched, and a leaf that was already
// non-interactive stays that way.
import { setInteractive } from "#core/layer/hitTarget.js";
import { walkLeaf } from "#core/layer/walkLeaf.js";

/**
 * Suspend interaction on every interactive leaf of a map and return a
 * restore closure. Centralizes the "exclusive map interaction" policy shared
 * by measure modes and export crop selection: while a component owns the map,
 * clicks must fall through to the map instead of firing feature handlers.
 *
 * Only leaves whose options.interactive is currently true are collected and
 * disabled, so the restore closure re-enables exactly those and leaves
 * everything else (tiles, labels, non-interactive previews) untouched.
 *
 * A `skip` predicate lets a caller exempt some leaves (e.g. edit mode keeps
 * its own measurement layers interactive while suspending everything else).
 *
 * @param {L.Map} map - Leaflet map.
 * @param {Function} [skip] - Optional predicate: leaves it returns true for
 *   are left interactive.
 * @returns {Function} Restore closure re-enabling the disabled leaves.
 */
const suspendMapInteractions = (
  map: L.Map,
  skip?: (leaf: L.Layer) => boolean,
): (() => void) => {
  const disabled: L.Layer[] = [];
  map.eachLayer(top => {
    walkLeaf(top, leaf => {
      if (skip?.(leaf)) return;
      const opts = leaf.options as L.LayerOptions & { interactive?: boolean };
      if (opts?.interactive) disabled.push(leaf);
    });
  });
  disabled.forEach(leaf => setInteractive(leaf, false));
  return () => disabled.forEach(leaf => setInteractive(leaf, true));
};

export { suspendMapInteractions };
