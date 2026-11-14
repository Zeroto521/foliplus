// Measures the ⋮ overflow menu geometry against its nearest clip container.
// Returns, for the first and last visible row, whether the open menu rect is
// fully inside the clip rect, which side it opened (above/below), and whether
// the menu is scrollable (scrollHeight > clientHeight) when it was capped.
async () => {
  const rows = () =>
    [...document.querySelectorAll(".foliplus-layer-item")].filter(
      r => r.offsetParent !== null,
    );
  const clip = () =>
    document.querySelector(".foliplus-panel-content").getBoundingClientRect();
  const openMenu = async btn => {
    btn.click();
    await new Promise(res => setTimeout(res, 30));
    return document.querySelector(".foliplus-layer-more-menu.open");
  };
  const closeMenu = () =>
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

  const result = { first: null, last: null };
  const all = rows();
  for (const [key, idx] of [
    ["first", 0],
    ["last", all.length - 1],
  ]) {
    const row = all[idx];
    if (!row) continue;
    const btn = row.querySelector(".foliplus-layer-more-btn");
    if (!btn) continue;
    const menu = await openMenu(btn);
    if (!menu) {
      result[key] = { error: "no open menu" };
      closeMenu();
      continue;
    }
    const m = menu.getBoundingClientRect();
    const c = clip();
    const inside =
      m.top >= c.top - 0.5 &&
      m.bottom <= c.bottom + 0.5 &&
      m.left >= c.left - 0.5 &&
      m.right <= c.right + 0.5;
    result[key] = {
      inside,
      side: menu.classList.contains("foliplus-layer-more-menu-up") ? "above" : "below",
      scrollable: menu.scrollHeight > menu.clientHeight,
      rect: {
        top: Math.round(m.top),
        bottom: Math.round(m.bottom),
        height: Math.round(m.height),
      },
      clip: {
        top: Math.round(c.top),
        bottom: Math.round(c.bottom),
      },
    };
    closeMenu();
  }
  return result;
};
