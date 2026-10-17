// Flip `document.fullscreenEnabled` to `false` at runtime. Installed only
// AFTER every module has been evaluated, so only a lazy `isEnabled` read
// (per call) picks it up — a module-load snapshot stays on the native
// branch and this test catches that regression.
() => {
  Object.defineProperty(document, "fullscreenEnabled", {
    value: false,
    configurable: true,
  });
};
