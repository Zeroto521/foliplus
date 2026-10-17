// Whether the injected sibling is both flagged `foliplus-hidden` AND
// actually `display: none` at computed-style time. The pair asserts
// `hide_others` wins over the sibling's inline `display: block` — the
// important-flag path, not just the class.
() => {
  const el = document.querySelector(".custom-ctrl");
  return (
    el.classList.contains("foliplus-hidden") && getComputedStyle(el).display === "none"
  );
};
