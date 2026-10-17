// Predicate for ``page.wait_for_function``: the drag handle at
// ``selector`` (optionally at query-list index ``index``) has reached
// opacity ``target``. The grip is the only recipe property with an
// opacity transition, so polling times the transition out before the
// measurement is trusted.
([selector, index, target]) => {
  const matches = document.querySelectorAll(selector);
  const el = matches[index ?? 0];
  return el ? getComputedStyle(el).opacity === target : false;
};
