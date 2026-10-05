// Shared helpers and types for the ExportControl renderer passes.
// Moved from renderer.ts — nothing here depends on L or the DOM beyond the
// types themselves, so every pass module can import without a cycle.
import { createLogger } from "#common/log.js";
import type { TileLoadStats } from "../type.js";

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

export { isCorsBlocked, pooledEach, effectiveOpacity, withAlpha };
