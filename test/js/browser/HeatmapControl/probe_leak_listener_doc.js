// Control group: verify the document/window count can see both leak shapes a
// HeatmapControl regression can take. If either doesn't move the number, the
// drift assertion in doc_listener_drift.js has no teeth.
//
// 1. A bare document listener — the pre-#408 shape of the outside-click
// handler — counts as an add, and its explicit removal counts as a removal.
// Without the removal half, a counter that only saw adds would report the
// same numbers for a leak-free run and a leaking one, and the drift gate's
// "flat" verdict would be meaningless.
//
// 2. A signal-managed listener — the post-#408 shape, and the one that gets
// cleaned on removeControl — must leave the count unchanged after its signal
// aborts. The engine drops {signal} listeners without calling
// removeEventListener, so this step is what pins the AbortController.prototype
// .abort patch in _probe/doc_listener_probe.js in place: remove it and this
// step reports a +1 that never comes back.
//
// The page is left as found, so `settled` must equal `before`.
() => {
  const sum = window.__probeDocSum;
  if (!sum) throw new Error("_probe/doc_listener_probe not installed");

  const before = sum().total;
  const noop = () => {};
  document.addEventListener("click", noop, { capture: true });
  const afterAdd = sum().total;
  document.removeEventListener("click", noop, { capture: true });
  const afterRemove = sum().total;

  const ac = new AbortController();
  const signalBound = () => {};
  document.addEventListener("click", signalBound, {
    signal: ac.signal,
    capture: true,
  });
  const afterSignalAdd = sum().total;
  ac.abort();
  const afterAbort = sum().total;

  return {
    before,
    addDelta: afterAdd - before,
    removeDelta: afterRemove - afterAdd,
    signalAddDelta: afterSignalAdd - afterRemove,
    abortDelta: afterAbort - afterSignalAdd,
    settled: afterAbort,
  };
};
