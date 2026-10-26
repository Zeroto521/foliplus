// Leaves fullscreen again, so a failed assertion cannot strand the page.
() => {
  if (!document.fullscreenElement || !document.exitFullscreen) {
    return Promise.resolve({ ok: true, wasFullscreen: false });
  }
  return document.exitFullscreen().then(
    () => ({ ok: true, wasFullscreen: true }),
    err => ({ ok: false, reason: (err && err.name) || String(err) }),
  );
};
