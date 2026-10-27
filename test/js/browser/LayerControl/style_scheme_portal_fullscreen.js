// Requests fullscreen on the document element from inside the page.
//
// The picker re-hosts its portalled list into document.fullscreenElement on a
// fullscreenchange. Headless browsers may refuse the request without a user
// gesture or lack the API entirely, so the caller reports the reason instead of
// failing the suite; the re-host itself is also pinned by the jsdom tests.
() => {
  if (!document.documentElement.requestFullscreen) {
    return Promise.resolve({ ok: false, reason: "no-fullscreen-api" });
  }
  let pending;
  try {
    pending = document.documentElement.requestFullscreen();
  } catch (err) {
    return Promise.resolve({ ok: false, reason: (err && err.name) || String(err) });
  }
  return pending.then(
    () => ({
      ok: true,
      fullscreen: !!document.fullscreenElement,
      dropdownParentTag: (() => {
        const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
        return dropdown && dropdown.parentElement
          ? dropdown.parentElement.tagName
          : null;
      })(),
      rehosted:
        !!document.fullscreenElement &&
        !!document.querySelector(".foliplus-scheme-picker-portal") &&
        document.fullscreenElement.contains(
          document.querySelector(".foliplus-scheme-picker-portal"),
        ),
    }),
    err => ({ ok: false, reason: (err && err.name) || String(err) }),
  );
};
