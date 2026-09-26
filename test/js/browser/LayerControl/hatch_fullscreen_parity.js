// Hatch fullscreen parity gate.
//
// Requirement: the no-basemap hatch looks the same in fullscreen and outside
// it. The way it breaks is an *absent opaque background*: with
// `background-color: transparent` the container shows the page behind it
// normally, but in fullscreen it shows the UA `::backdrop` (black) — "white +
// grid" outside, "black + grid" inside.
//
// Two facts shape what can be asserted here:
//   - The element's own background is what makes the backdrop invisible, so
//     the decisive check is that it is OPAQUE and light. That is falsifiable:
//     `transparent` fails it.
//   - The backdrop itself is not observable — `getComputedStyle` describes the
//     element, not the backdrop, and headless Chromium does not composite the
//     backdrop into a screenshot (measured: identical pixels with a transparent
//     and an opaque background). So "fullscreen vs non-fullscreen pixel
//     parity" cannot be the assertion; the parity asserted here is of the
//     element's own paint (colour + hatch), which must not change on entering
//     fullscreen.
//
// Fullscreen needs transient user activation, so the caller arms a button here
// and clicks it with a real input event between the two reads.
//
// Driver: window.__probe = { action: "arm" | "read" }
//   arm  — add the no-basemap state and mount the fullscreen trigger
//   read — return the container's computed paint state (default)
() => {
  const spec = window.__probe || { action: "read" };
  delete window.__probe;
  const map = window.map;
  if (!map) return { error: "map missing" };
  const container = map.getContainer();

  /** Split a computed colour into its channels so the caller can assert on
   *  opacity and lightness without string-matching rgb()/rgba() forms. */
  const channels = color => {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map(s => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };

  const read = () => {
    const cs = getComputedStyle(container);
    return {
      bg: cs.backgroundColor,
      rgba: channels(cs.backgroundColor),
      hatch: cs.backgroundImage.startsWith("repeating-conic-gradient"),
      isFull: document.fullscreenElement === container,
    };
  };

  if (spec.action === "arm") {
    container.classList.add("no-base-map");
    const btn = document.createElement("button");
    btn.id = "foliplus-fs-trigger";
    btn.textContent = "fs";
    btn.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
    btn.addEventListener("click", () => container.requestFullscreen());
    document.body.appendChild(btn);
    return { ok: true, state: read() };
  }

  return { ok: true, state: read() };
};
