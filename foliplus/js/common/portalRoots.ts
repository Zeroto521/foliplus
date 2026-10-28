// common/portalRoots — the registry of nodes an overlay portalled elsewhere.
//
// A floating panel dismisses itself on a document-capture press that lands
// "outside" it. An overlay may legitimately mount content on another host —
// the shared dropdown and the scheme picker both portal their list to <body>
// (or the surface covering the trigger) so it can paint above the panel — and
// that node is part of the overlay in every sense except the DOM tree.
//
// Registration is the *primitive's* job, not the panel's: every overlay that
// portals already knows when its node is live (mount) and dead (close), so it
// registers the node it owns and unregisters on teardown. Panels then ask one
// predicate (core/overlay's isInsideOverlay) and never learn a new selector
// when a third portal appears — the alternative, a per-panel portal selector
// argument, is how one panel ends up not knowing about one portal.

/** Live portalled roots. A Set of nodes, not selectors: the registrant owns the
 *  element, so ownership is exact and does not depend on a class surviving a
 *  restyle. Bounded by the number of *open* overlays. */
const portalRoots = new Set<Node>();

/** Register a portalled node as part of the overlay that mounted it. Returns
 *  the release function; call it when the node leaves the document. Idempotent
 *  per release so a close-then-destroy sequence cannot double-decrement. */
const registerPortalRoot = (node: Node): (() => void) => {
  portalRoots.add(node);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    portalRoots.delete(node);
  };
};

/** True when `node` belongs to a live portal root (is one, or sits inside one). */
const isInPortalRoot = (node: Node): boolean => {
  for (const root of portalRoots) {
    if (root === node || root.contains(node)) return true;
  }
  return false;
};

export { isInPortalRoot, registerPortalRoot };
