// Wrap `map.foliplus.showHint` so every call increments a counter.
// Installed before the first toggle; the enter/exit pair reads the delta.
() => {
  window.__hintCount = 0;
  const orig = map.foliplus.showHint;
  map.foliplus.showHint = function (...args) {
    window.__hintCount++;
    return orig.apply(this, args);
  };
};
