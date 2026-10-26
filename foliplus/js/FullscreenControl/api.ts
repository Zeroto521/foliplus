// Fullscreen API — standard names. All modern browsers ship the unprefixed
// Fullscreen API; the webkit prefix (last needed by Safari < 16.4, 2023) is
// dropped, so the standard DOM properties are used directly.
const FULLSCREEN_CHANGE = "fullscreenchange";

// Read lazily: `document.fullscreenEnabled` is document-level state that can flip
// (iframe policy, embedder restrictions) after this module is evaluated — a
// load-time snapshot would pin the branch choice for every later toggle, and
// could disagree with `getFullscreenEl()` within a single click.
const isEnabled = (): boolean =>
  "fullscreenEnabled" in document && document.fullscreenEnabled === true;
const getFullscreenEl = (): Element | null => document.fullscreenElement ?? null;

/** Whether the document's native fullscreen session belongs to *container*.
 *  Native fullscreen is document-global, so a sibling map's fullscreen element
 *  must not flip this control's state (or make its next click exit the other
 *  map). The element is this map's when it is the container, an ancestor
 *  wrapper, or a child the map fullscreened. */
const ownsFullscreen = (container: Element): boolean => {
  const fs = getFullscreenEl();
  return Boolean(
    fs && (fs === container || fs.contains(container) || container.contains(fs)),
  );
};

export { FULLSCREEN_CHANGE, getFullscreenEl, isEnabled, ownsFullscreen };
