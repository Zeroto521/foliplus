// Shared support snippet (not a probe): the computed row-layout contract of one
// row element — the height it resolves to (min-height / height), its horizontal
// insets and box model, plus each row-family token resolved to a real length.
//
// A custom property read straight off a computed style keeps its token stream
// (var() is substituted but calc() is not evaluated), so every family token is
// resolved through a throwaway element that uses it in a real property: the
// caller then compares a row's computed height with a real px value instead of
// a token string.
({ selector, root } = {}) => {
  const scope = root ? document.querySelector(root) : document;
  const el = scope ? scope.querySelector(selector) : null;
  if (!el) return { ok: false, reason: "no-element", selector };
  const cs = getComputedStyle(el);
  const resolve = (name, prop) => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:0";
    probe.style[prop] = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe)[prop];
    probe.remove();
    return value;
  };
  return {
    ok: true,
    selector,
    minHeight: cs.minHeight,
    height: cs.height,
    paddingLeft: cs.paddingLeft,
    paddingRight: cs.paddingRight,
    boxSizing: cs.boxSizing,
    rectHeight: el.getBoundingClientRect().height,
    listRowToken: resolve("--foliplus-row-min-height", "minHeight"),
    menuRowToken: resolve("--foliplus-menu-row-h", "minHeight"),
    toggleSizeToken: resolve("--foliplus-toggle-size", "minHeight"),
    ctrlSizeToken: resolve("--foliplus-ctrl-size", "height"),
    layerPadToken: resolve("--foliplus-layer-item-pad-x", "paddingLeft"),
    spaceSmToken: resolve("--foliplus-space-sm", "paddingLeft"),
  };
};
