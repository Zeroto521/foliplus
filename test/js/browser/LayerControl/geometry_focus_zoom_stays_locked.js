() => {
  // Wait for the geometry path to render
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!document.querySelector("path.leaflet-interactive"))
        return setTimeout(check, 50);
      const path = document.querySelector("path.leaflet-interactive");
      if (!path) return setTimeout(check, 50);
      // Focus the path to trigger the marquee
      path.setAttribute("tabindex", "-1");
      path.focus();
      // Wait for marquee to appear
      const waitMarquee = () => {
        if (document.querySelector("path.foliplus-focus-marquee"))
          return collectState();
        setTimeout(waitMarquee, 50);
      };
      waitMarquee();
    };
    const collectState = () => {
      const path = document.querySelector("path.leaflet-interactive");
      const marquee = document.querySelector("path.foliplus-focus-marquee");
      if (!path || !marquee) {
        resolve({ error: "path or marquee missing" });
        return;
      }
      const toBB = el => {
        const b = el.getBBox();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const before = {
        geomBB: toBB(path),
        marqueeBB: toBB(marquee),
        marqueeD: marquee.getAttribute("d"),
        zoom: map.getZoom(),
      };
      // Zoom in 2 levels
      map.setZoom(map.getZoom() + 2);
      // Wait for moveend + 2 rAF (the fix defers redraw to rAF)
      let done = false;
      map.on("moveend", function once() {
        // After moveend, wait 2 rAF for the browser to reflow and our fix to run
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (done) return;
            done = true;
            // Re-query the marquee — the rAF redraw replaces the old element.
            const mq2 = document.querySelector("path.foliplus-focus-marquee");
            const after = {
              geomBB: toBB(path),
              marqueeBB: mq2 ? toBB(mq2) : null,
              marqueeD: mq2 ? mq2.getAttribute("d") : null,
              zoom: map.getZoom(),
            };
            resolve({ before, after });
          }),
        );
      });
      // Safety timeout
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ before, after: null });
        }
      }, 5000);
    };
    check();
  });
};
