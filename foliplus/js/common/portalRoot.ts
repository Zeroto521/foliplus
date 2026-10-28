// common/portalRoot — which overlay owns a node that was mounted elsewhere.
//
// A floating panel dismisses itself on a press that lands "outside" it. An
// overlay may legitimately mount content on another host — the shared dropdown
// and the scheme picker both portal their list to <body> (or the surface
// covering the trigger) so it can paint above the panel — and that node is
// part of the overlay in every sense except the DOM tree.
//
// Ownership, not global membership: each registration carries the trigger it
// belongs to, so a node counts as inside the panel that owns that trigger and
// inside no other. A global set would let one open popup absorb a press aimed
// at an unrelated panel, and would make every panel's "is this mine" question
// answer yes.
//
// Registration is the *primitive's* job, not the panel's: the overlay that
// portals already knows when its node is live (mount) and dead (close). Panels
// ask one predicate (core/overlay's isInsideOverlay with their own element) and
// never learn a new selector when a third portal appears.

/** One live portalled node and the trigger of the overlay that owns it. */
interface PortalRoot {
  node: Node;
  owner: Element;
}

/** Live portalled roots. Bounded by the number of *open* overlays. */
const roots = new Set<PortalRoot>();

/** Register a portalled node under the trigger its overlay owns. Returns the
 *  release function; a repeated release is a no-op so a close-then-destroy
 *  sequence cannot remove a newer registration of the same node. */
const registerPortalRoot = (node: Node, owner: Element): (() => void) => {
  const entry: PortalRoot = { node, owner };
  roots.add(entry);
  return () => {
    roots.delete(entry);
  };
};

/** True when `node` belongs to a portal root owned by an overlay that lives in
 *  `scope` — the scope being the panel (or the panel container) asking. */
const isPortalOf = (node: Node, scope: Element | null): boolean => {
  if (!scope) return false;
  for (const root of roots) {
    if (root.node !== node && !root.node.contains(node)) continue;
    if (
      root.owner === scope ||
      scope.contains(root.owner) ||
      root.owner.contains(scope)
    ) {
      return true;
    }
  }
  return false;
};

export { isPortalOf, registerPortalRoot };
