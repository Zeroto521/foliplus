// Computed color of a design token — never hardcode a hex/rgb in tests.
name => {
  const p = document.createElement("div");
  p.style.background = `var(${name})`;
  document.body.appendChild(p);
  const c = getComputedStyle(p).backgroundColor;
  p.remove();
  return c;
};
