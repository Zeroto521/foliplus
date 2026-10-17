// Predicate for ``page.wait_for_function``: the element matching ``sep``
// has picked up a glow (its computed ``box-shadow`` is not ``none``) —
// the recipe property that marks a row as lit.
sep => {
  const r = document.querySelector(sep);
  return r ? getComputedStyle(r).boxShadow !== "none" : false;
};
