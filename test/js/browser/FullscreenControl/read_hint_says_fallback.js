// True once a hint element exists AND its text matches the fallback wording.
// The regex is `/maximized/i` — the localized string for the pseudo-fallback
// path; case-insensitive so a locale variation still matches.
() => {
  const hint = document.querySelector(".foliplus-hint");
  return !!hint && /maximized/i.test(hint.innerText);
};
