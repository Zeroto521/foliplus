(function () {
  // Record the computed z of every pane Leaflet creates, read one microtask
  // after createPane returns — i.e. after the whole synchronous register()
  // stack that created it has unwound. That is the value the first frame
  // paints; a reader that runs later is already past the ordering pass.
  //
  // Installed via page.add_init_script, which runs before the page's scripts,
  // so `L` does not exist yet. Poll for it: the map is initialized by the base
  // template scripts and the components' createPane calls come from later
  // script tags, so the hook lands in time.
  if (window.__t203Panes) return;
  window.__t203Panes = [];

  const install = () => {
    if (!window.L || window.__t203Hooked) return;
    window.__t203Hooked = true;
    clearInterval(window.__t203Timer);
    const real = window.L.Map.prototype.createPane;
    window.L.Map.prototype.createPane = function (name) {
      const pane = real.call(this, name);
      const entry = { name, zAtCreate: getComputedStyle(pane).zIndex };
      window.__t203Panes.push(entry);
      Promise.resolve().then(() => {
        entry.zAtMicrotask = getComputedStyle(pane).zIndex;
      });
      return pane;
    };
  };
  window.__t203Timer = setInterval(install, 0);
  install();
})();
