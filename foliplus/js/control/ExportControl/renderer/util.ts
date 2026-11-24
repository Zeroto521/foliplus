// Shared helpers and types for the ExportControl renderer passes.
// Moved from renderer.ts — nothing here depends on L or the DOM beyond the
// types themselves, so every pass module can import without a cycle.
import type { RenderCtx, TileLoadStats } from "../type.js";
import { createLogger } from "#platform/log.js";

const log = createLogger(CONFIG.name);

/** True when a layer's tiles predominantly failed to load — most often a tile
 *  source that rejects CORS requests (the map renders fine as opaque images,
 *  but the export's independent CORS fetch cannot get them); missing-tile
 *  404s or rate limits can pile up the same way.  Sporadic misses (ocean
 *  404s, blips) stay below the threshold. */
const isCorsBlocked = (stats: TileLoadStats): boolean =>
  stats.total > 0 && stats.failed > 0 && stats.failed / stats.total > 0.5;

/** Load items with a bounded in-flight count (preserves array order on resolve). */
const pooledEach = async <T, R>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R | null> | R | null,
): Promise<Array<R | null>> => {
  if (items.length === 0) return [];
  const cap = Math.max(1, maxConcurrency);
  const results = new Array<R | null>(items.length);
  let next = 0;
  const enqueue = async (): Promise<void> => {
    const idx = next++;
    if (idx >= items.length) return;
    try {
      const value = await fn(items[idx], idx);
      results[idx] = value ?? null;
    } catch (err) {
      log.warn("tile load failed:", err);
      results[idx] = null;
    }
    await enqueue();
  };
  await Promise.all(Array.from({ length: cap }, enqueue));
  return results;
};

/** Accumulate CSS opacity up the ancestor chain — `opacity` does not inherit,
 *  so a pane's 0.4 must be multiplied with each child's own 0.5 to reach the
 *  composited 0.2. Stops at the map container (its own opacity is 1 by
 *  definition; anything above is page chrome, not layer content). */
const effectiveOpacity = (container: HTMLElement, el: HTMLElement): number => {
  let alpha = 1;
  for (let n: HTMLElement | null = el; n && n !== container; n = n.parentElement) {
    const v = window.getComputedStyle(n).opacity;
    if (v && v !== "1" && v !== "") {
      alpha *= parseFloat(v);
    }
  }
  return Math.max(0, Math.min(1, alpha));
};

/** Apply a drawing operation under a given alpha, restoring the previous value. */
const withAlpha = (
  ctx: CanvasRenderingContext2D,
  alpha: number,
  draw: () => void,
): void => {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  try {
    draw();
  } finally {
    ctx.globalAlpha = prev;
  }
};

/** Computed SVG presentation properties a standalone clone has to carry
 *  inline. The clone is serialised and rasterised through an <img>, which has
 *  no access to the page stylesheet — a fill/stroke that comes from a CSS
 *  class or custom property is lost and the shape falls back to the default
 *  black paint. Text props are included so a <text> node keeps its font. */
const SVG_STYLE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "visibility",
  "display",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
] as const;

/** Copy the live computed presentation styles of `svgEl` and its descendants
 *  onto the serialised `clone`, walking the two trees in parallel.
 *
 *  An element whose own computed `display` is "none" is removed from the
 *  clone instead of styled: the clone goes through an <img>, which ignores
 *  inline display, so removal is the only reliable exclusion. */
const inlineSVGComputedStyles = (svgEl: SVGElement, clone: SVGElement): void => {
  const originals = svgEl.querySelectorAll("*");
  const clones = clone.querySelectorAll("*");
  for (let i = 0; i < clones.length && i < originals.length; i++) {
    const cs = window.getComputedStyle(originals[i]);
    if (cs.getPropertyValue("display") === "none") {
      clones[i].remove();
      continue;
    }
    const inline = clones[i] as SVGElement;
    for (const prop of SVG_STYLE_PROPS) {
      const value = cs.getPropertyValue(prop);
      if (!value || value === "none") continue;
      // A standalone clone defaults to black fill; "painted black" needs no
      // inline declaration and the skip keeps the serialised SVG small.
      if (prop === "fill" && value === "rgb(0, 0, 0)") continue;
      inline.style.setProperty(prop, value);
    }
  }
};

/** Record an image the export could not read back. Deduplicated by source
 *  (the same sprite is referenced by many elements), collected on the render
 *  context so the renderer can report and count it once. */
const noteAssetFailure = (rc: RenderCtx, src: string, error: unknown): void => {
  const failures = (rc.failedAssets ??= []);
  if (failures.some(failure => failure.src === src)) return;
  failures.push({
    src,
    reason: error instanceof Error ? error.message : String(error),
  });
};

export {
  isCorsBlocked,
  pooledEach,
  effectiveOpacity,
  withAlpha,
  SVG_STYLE_PROPS,
  inlineSVGComputedStyles,
  noteAssetFailure,
};
