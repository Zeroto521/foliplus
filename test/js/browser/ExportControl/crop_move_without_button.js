// A pointermove whose button is already up: what this page observes after the
// user released the mouse over another window (no pointerup is delivered here).
point => {
  const target = document.querySelector(".foliplus-export-box");
  if (!target) return { error: "no box" };
  target.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      clientX: point.x,
      clientY: point.y,
      buttons: 0,
    }),
  );
  return { sent: true };
};
