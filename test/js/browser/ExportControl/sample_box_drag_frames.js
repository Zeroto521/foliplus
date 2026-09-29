() =>
  new Promise(resolve => {
    // Sample the crop box's bounding rect for `frames` consecutive animation
    // frames; the caller drives a drag between `evaluate_handle` and
    // `json_value`, so any single frame that jumps past the natural per-step
    // delta is a mid-drag re-read of a stale rect.
    const box = document.querySelector(".foliplus-export-box");
    if (!box) return resolve({ error: "no box" });
    const frames = 40;
    const samples = [];
    let n = 0;
    const tick = () => {
      const r = box.getBoundingClientRect();
      samples.push({ l: r.left, t: r.top, w: r.width, h: r.height });
      if (++n < frames) requestAnimationFrame(tick);
      else resolve({ samples });
    };
    requestAnimationFrame(tick);
  });
