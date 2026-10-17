// True once a hint element exists AND its text matches the unsupported
// wording. The regex is `/not available/i` — the localized string for the
// reject path; case-insensitive so a locale variation still matches.
() => {
  const hint = document.querySelector(".foliplus-hint");
  return !!hint && /not available/i.test(hint.innerText);
};
