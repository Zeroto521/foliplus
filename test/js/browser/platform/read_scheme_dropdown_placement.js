// Measures where the shared scheme-picker list landed relative to its trigger.
//
// Used to prove the two consumers obey one flip rule: paint below unless the
// room below cannot hold the list and the room above is larger. Reports the
// rule's verdict next to the actual box so the test fails on disagreement, not
// on a hardcoded coordinate.
() => {
  const dropdown = document.querySelector(".foliplus-scheme-picker-dropdown");
  const trigger = document.querySelector(
    '.foliplus-scheme-picker-trigger[aria-expanded="true"]',
  );
  if (!dropdown || !trigger) return { ok: false };

  const t = trigger.getBoundingClientRect();
  const d = dropdown.getBoundingClientRect();
  const EDGE = 8;
  const GAP = 4;
  const CAP = 200;
  const natural = Math.min(dropdown.scrollHeight, CAP);
  const roomBelow = innerHeight - EDGE - t.bottom - GAP;
  const roomAbove = t.top - EDGE - GAP;
  const expectedFlip = roomBelow < natural && roomAbove > roomBelow;
  const flipped = d.bottom <= t.top + 1;

  return {
    ok: true,
    portal: dropdown.classList.contains("foliplus-scheme-picker-portal"),
    flipped,
    expectedFlip,
    ruleHolds: flipped === expectedFlip,
    trigger: { top: t.top, bottom: t.bottom, left: t.left, width: t.width },
    dropdown: {
      top: d.top,
      bottom: d.bottom,
      left: d.left,
      width: d.width,
      height: d.height,
    },
    viewport: { width: innerWidth, height: innerHeight },
    roomBelow,
    roomAbove,
    naturalHeight: natural,
    maxHeight: getComputedStyle(dropdown).maxHeight,
    scrolls: dropdown.scrollHeight > dropdown.clientHeight,
    items: dropdown.querySelectorAll(".foliplus-scheme-picker-item").length,
  };
};
