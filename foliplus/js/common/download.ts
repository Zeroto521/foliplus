// File download — the single place that owns a download anchor. Producers
// hand over a blob and a filename; centralising the anchor lifecycle here
// means the revoke policy cannot drift between components.

/** Milliseconds to keep an object URL alive after the download is triggered.
 *  A delay is required — an anchor clicked from a detached element can be
 *  aborted if the URL is revoked in the same tick. Exported artifacts are
 *  large (HD maps, GeoTIFFs), so this is generous rather than minimal. */
const DEFAULT_REVOKE_DELAY = 10000;

/**
 * Download `blob` as a file named `filename`.
 * @param revokeDelayMs How long to keep the object URL before releasing it.
 *   Default {@link DEFAULT_REVOKE_DELAY}.
 */
const download = (
  blob: Blob,
  filename: string,
  revokeDelayMs = DEFAULT_REVOKE_DELAY,
) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;

  anchor.download = filename;

  anchor.rel = "noopener";

  anchor.style.display = "none";
  // Cleanup lives in a finally so a throw from appendChild, click, or remove
  // cannot leak the object URL or strand the anchor in the DOM — the very
  // leak centralising the anchor here is meant to prevent.
  try {
    document.body.appendChild(anchor);

    anchor.click();
  } finally {
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);
  }
};

export { download, DEFAULT_REVOKE_DELAY };
