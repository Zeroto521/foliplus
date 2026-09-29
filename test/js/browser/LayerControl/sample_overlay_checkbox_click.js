() =>
  new Promise(resolve => {
    // Click the first overlay row's checkbox while sampling every overlay row's
    // checked state on each animation frame; settles once two consecutive
    // samples agree. Any frame where a sibling checkbox differs from its start
    // state is the intermediate-rewrite "flash" this test pins against.
    const rows = Array.from(
      document.querySelectorAll(
        '.foliplus-layer-item:not([data-layer-type="base"]) input[type="checkbox"]',
      ),
    );
    if (rows.length < 2) return resolve({ error: "need >=2 overlay rows" });
    const startState = rows.map(cb => cb.checked);
    const targetRow = rows[0];

    const samples = [];
    let flip = false;
    const initial = startState.slice();
    const tick = () => {
      const now = rows.map(cb => cb.checked);
      samples.push(now.slice());
      if (now.some((v, i) => v !== initial[i])) flip = true;
      if (samples.length >= 2) {
        const prev = samples[samples.length - 2];
        if (prev.every((v, i) => v === now[i])) {
          return resolve({
            startState: initial,
            finalState: now,
            samples,
            anyTransientFlip: flip,
          });
        }
      }
      if (samples.length > 60) {
        return resolve({
          startState: initial,
          finalState: now,
          samples,
          anyTransientFlip: flip,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    targetRow.click();
  });
