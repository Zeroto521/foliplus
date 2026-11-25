// Wrap `map.foliplus.hint.set` so every call increments a counter.
// Installed before the first toggle; the enter/exit pair reads the delta.
() => {
  window.__hintCount = 0;
  const orig = map.foliplus.hint.set;
  map.foliplus.hint.set = function (...args) {
    window.__hintCount++;
    return orig.apply(this, args);
  };
};
