// Centre of the bottom-right resize handle — the corner a resize drag grabs.
() => {
  const el = document.querySelector('.foliplus-export-handle[data-pos="br"]');
  if (!el) return { error: "no br handle" };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
