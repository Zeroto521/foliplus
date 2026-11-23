async () => {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (fn, ms = 2000, step = 25) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await wait(step);
    }
  };
  const more = document.querySelector(".foliplus-layer-more-btn");
  if (!more) return false;
  more.click();
  const menuItem = await until(() =>
    document.querySelector('.foliplus-layer-more-menu [data-action="filter-layer"]'),
  );
  if (!menuItem) return false;
  menuItem.click();
  const panel = await until(() =>
    document.querySelector(".foliplus-layer-filter-panel"),
  );
  if (!panel) return false;
  const ref = document.createElement("div");
  ref.className = "row-layout-ref";
  const row = document.createElement("div");
  row.className = "foliplus-row";
  const c = document.createElement("div");
  c.className = "foliplus-row-content";
  c.textContent = "Reference";
  row.appendChild(c);
  ref.appendChild(row);
  document.body.appendChild(ref);
  const trigger = panel.querySelector(".foliplus-dropdown-trigger");
  if (!trigger) return false;
  trigger.click();
  const option = await until(() =>
    document.querySelector(".foliplus-dropdown-option.foliplus-row"),
  );
  return !!(option && document.querySelector(".row-layout-ref .foliplus-row"));
};
