// core/overlay — the shared "is this press inside my overlay" predicate.
//
// A floating panel dismisses itself on a document-capture mousedown that lands
// outside it. "Outside" is not the same as "not a descendant of the panel": an
// overlay may mount content somewhere else in the document — the shared scheme
// picker portals its dropdown to <body> (or the fullscreen element) so the list
// can paint above the panel that owns the trigger. That node is part of the
// overlay in every sense except the DOM tree, so a predicate that only walks
// the panel's subtree dismisses the panel out from under the click the user
// aimed at the overlay: the press is classified as "outside", the panel closes
// before the click reaches the portalled row, and the overlay eats its own
// interaction.
//
// One predicate for every panel: the attributes, filter and style panels all
// dismiss on the same document-capture recipe, and three hand-written subtree
// checks are how one of them ends up not knowing about a portal.
//
// Ownership comes from the overlay itself: a portal registers the node it
// mounted (common/portalRoots) while that node is live, so a new portal is
// covered everywhere the moment its primitive registers — no panel needs a new
// selector. `portalSelector` remains for the callers that predate the
// registry (the scheme picker's panels pass it explicitly); the two paths
// agree, and the registry is checked first so a registered node wins even if a
// caller forgets its selector.
import { isInPortalRoot } from "#common/portalRoots.js";

/** True when `target` belongs to the overlay owned by `panel`: a descendant of
 *  the panel itself, a node some overlay registered as its portal root, or a
 *  node matched by the caller's own `portalSelector`.
 *
 *  `target` is typed as `EventTarget` because a document-level dispatch may
 *  name the document itself, which has no `closest()`; `null` and non-node
 *  targets answer "outside", the same verdict the call sites gave them before
 *  this helper existed. */
const isInsideOverlay = (
  target: EventTarget | null,
  panel: Element | null,
  portalSelector?: string,
): boolean => {
  if (!target || typeof (target as Node).nodeType !== "number") return false;
  const node = target as Node;
  if (panel?.contains(node)) return true;
  // A live portal root is owned by some overlay that mounted it; whichever
  // panel is asking, a press on that node belongs to an overlay, not the page.
  if (isInPortalRoot(node)) return true;
  if (!portalSelector) return false;
  // Node.ELEMENT_NODE is 1; spelled out so the helper stays a leaf module.
  const element =
    node.nodeType === 1 ? (node as Element) : (node as Node).parentElement;
  return element?.closest(portalSelector) != null;
};

export { isInsideOverlay };
