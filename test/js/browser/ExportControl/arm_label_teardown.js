// Arm an annotation teardown inside the export render window.
//
// The export renders for seconds (tile pass, shadow pass), and annotation
// rendering can be torn down inside that window — a layer unload/re-register
// removes every label canvas. The task-22 fix freezes each layer's label
// canvas pixels synchronously at render() start, so a teardown in the render
// window cannot blank the exported labels. This snippet arms that teardown on
// the first image the export loads (Image / createImageBitmap) so it lands in
// the render window no matter how fast or slow the host is, and records that
// it fired on window.__labelTornDown.
() => {
  let armed = false;
  window.__labelTornDown = false;
  const tearDown = () => {
    if (window.__labelTornDown) return;
    window.__labelTornDown = true;
    window.__layerCtrl.mgr.annotation.unloadLayer("__export_ann__");
  };
  const arm = () => {
    if (armed) return;
    armed = true;
    tearDown();
  };
  const OrigImage = window.Image;
  window.Image = function (...a) {
    arm();
    return new OrigImage(...a);
  };
  window.Image.prototype = OrigImage.prototype;
  const origBitmap = window.createImageBitmap;
  if (origBitmap) {
    window.createImageBitmap = (...a) => {
      arm();
      return origBitmap.apply(window, a);
    };
  }
};
