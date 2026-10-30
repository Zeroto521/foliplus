() => {
  const list = [...document.querySelectorAll('.foliplus-dropdown-list')].find(l => !l.hidden);
  if (!list) return { open: 0 };
  const r = list.getBoundingClientRect();
  const top = document.elementsFromPoint(
    Math.round(r.left + r.width / 2),
    Math.round(r.top + r.height / 2),
  )[0] || null;
  const option = list.querySelector('.foliplus-dropdown-option:not([disabled])');
  const or = option ? option.getBoundingClientRect() : null;
  return {
    open: 1,
    rect: [Math.round(r.width), Math.round(r.height)],
    zIndex: getComputedStyle(list).zIndex,
    topIsInsideList: top ? list.contains(top) : false,
    topTag: top ? top.tagName.toLowerCase() + '.' + String(top.className || '').slice(0, 40) : null,
    option: option
      ? {
          label: (option.textContent || '').trim(),
          x: Math.round(or.left + or.width / 2),
          y: Math.round(or.top + or.height / 2),
        }
      : null,
  };
}
