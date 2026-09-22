// Control group: deliberately register ONE bare document listener (no
// cleanup owner) and verify the document/window count can see it. If a real
// leak of this magnitude doesn't move the number, the drift assertion in
// doc_listener_drift.js has no teeth.
//
// Both directions are asserted: the removal at the end must bring the count
// back down. Without that, a counter that only saw adds would report the
// same numbers for a leak-free run and a leaking one, and the drift gate's
// "flat" verdict would be meaningless.
//
// The listener is removed before the probe returns, so the page is left as it
// was found.
() => {
  const sum = window.__probeDocSum;
  if (!sum) throw new Error("_probe/doc_listener_probe not installed");
  const before = sum().total;
  const noop = () => {};
  document.addEventListener("click", noop, { capture: true });
  const afterAdd = sum().total;
  document.removeEventListener("click", noop, { capture: true });
  const afterRemove = sum().total;
  return {
    before,
    addDelta: afterAdd - before,
    removeDelta: afterRemove - afterAdd,
  };
};
