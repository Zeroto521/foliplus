// Shared value-classification breaks — the algorithms that split a set of
// numbers into N ordered class boundaries. Consumed today by HeatmapControl's
// hex-classification, and by LayerControl's value-based fill (T202) once that
// lands; the string protocol is stable so both sides stay in lockstep.

/** The four classification methods this module knows how to compute. */
const METHOD = {
  JENKS: "jenks",
  QUANTILE: "quantile",
  EQUAL: "equal",
  HEADS: "heads",
} as const;

/** A method name accepted by {@link computeBreaks}. */
type ClassifyMethod = (typeof METHOD)[keyof typeof METHOD];

/**
 * Compute ordered class breaks for a set of values using the given method.
 *
 * Returns at least two breaks (lo, hi) for any non-empty input; empty input
 * yields an empty array. Breaks are monotonically non-decreasing so callers
 * can bisect them into class indices.
 */
const computeBreaks = (data: number[], nClasses: number, method: string): number[] => {
  if (data.length === 0) return [];
  const sorted = data.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n <= 2) return [sorted[0], sorted[n - 1]];
  nClasses = Math.max(3, Math.min(nClasses, n));

  const lo = sorted[0];
  const hi = sorted[n - 1];

  if (method === METHOD.JENKS) {
    try {
      const clusters = ss.ckmeans(data, nClasses);
      const breaks: number[] = [clusters[0][0]];
      clusters.forEach(c => breaks.push(c[c.length - 1]));
      return breaks;
    } catch (_e) {
      /* fall through */
    }
    return [lo, hi];
  } else if (method === METHOD.QUANTILE) {
    const b: number[] = [lo];
    for (let i = 1; i < nClasses; i++) {
      b.push(ss.quantileSorted(sorted, i / nClasses));
    }
    return b.concat(hi);
  } else if (method === METHOD.HEADS) {
    const b: number[] = [lo];
    for (let i = 1; i < nClasses; i++) {
      b.push(sorted[Math.min(Math.floor((i * n) / nClasses), n - 1)]);
    }
    return b.concat(hi);
  }
  const step = (hi - lo) / nClasses;
  const b: number[] = [];
  for (let i = 0; i <= nClasses; i++) b.push(lo + step * i);
  return b;
};

export { METHOD, computeBreaks };
export type { ClassifyMethod };
