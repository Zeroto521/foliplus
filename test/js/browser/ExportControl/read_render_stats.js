() => {
  // The stats of the last render, exposed on the manager for tests (and for
  // console diagnostics). failedAssets counts every image the export could
  // not read back (sprites, icons, inline SVG blobs).
  const mgr = window.__exportManager;
  if (!mgr) return { error: "no export manager" };
  return mgr.lastRenderStats || null;
};
