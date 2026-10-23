// Shared value-classification breaks — the algorithms that split a set of
// numbers into N ordered class boundaries. Consumed today by HeatmapControl's
// hex-classification, and by LayerControl's value-based fill (T202) once that
// lands; the string protocol is stable so both sides stay in lockstep.
import { createLogger } from "#common/log.js";

const log = createLogger("foliplus");

/** The four classification methods this module knows how to compute. */
const METHOD = {
  JENKS: "jenks",
  QUANTILE: "quantile",
  EQUAL: "equal",
  HEADS: "heads",
} as const;

/** The closed set of method names this module implements. */
type ClassifyMethod = (typeof METHOD)[keyof typeof METHOD];

const CLASSIFY_METHODS: readonly string[] = Object.values(METHOD);

/** Whether `value` is one of the four method names — exact match, no trim
 *  and no case folding. A method is a protocol token, not a property key:
 *  unlike a GeoJSON field name, " equal " and "EQUAL" are different requests,
 *  and accepting either would let a record claim one algorithm while the
 *  classifier runs another. */
const isClassifyMethod = (value: unknown): value is ClassifyMethod =>
  typeof value === "string" && CLASSIFY_METHODS.includes(value);

/** The two methods that read the `simple-statistics` CDN global. `equal` and
 *  `heads` are pure arithmetic, so a page that never loaded the script can
 *  still classify. */
const needsSimpleStatistics = (method: ClassifyMethod): boolean =>
  method === METHOD.JENKS || method === METHOD.QUANTILE;

/** Thrown when one of those methods runs on a page that never loaded
 *  `simple-statistics`. Callers can tell this apart from a recoverable
 *  failure (a palette name that degrades to the fallback colour): the
 *  dependency is missing for the whole page, so re-rendering cannot fix it
 *  and the absence must be reported, not only degraded. */
class ClassifierDependencyError extends Error {}

/** Thrown when a caller asks for a method this module does not implement.
 *  A name outside the set used to fall into the equal split, so a stale or
 *  hand-edited record could claim one algorithm while the map ran another.
 *  Failing at the boundary is the only way that stays reported instead of
 *  silently re-meant. */
class ClassifyMethodError extends Error {}

/** Whether the `simple-statistics` global the classifier reads is present.
 *  `typeof` rather than a bare read: an unloaded CDN script leaves no
 *  binding at all, and reading one throws `ReferenceError` at the call site
 *  instead of returning false. */
const hasSimpleStatistics = (): boolean => typeof ss !== "undefined";

/**
 * Compute ordered class breaks for a set of values using the given method.
 *
 * Returns at least two breaks (lo, hi) for any non-empty input; empty input
 * yields an empty array. Breaks are monotonically non-decreasing so callers
 * can bisect them into class indices.
 */
const computeBreaks = (
  data: number[],
  numClasses: number,
  method: ClassifyMethod,
): number[] => {
  // The method is validated before anything else so an invalid config fails
  // the same way whatever the data: a caller must not learn that the method
  // is unrecognised only when the layer happens to have values.
  if (!isClassifyMethod(method)) {
    throw new ClassifyMethodError(
      log.msg("unknown classification method: " + String(method)),
    );
  }
  if (data.length === 0) return [];
  const sorted = data.slice().sort((a, b) => a - b);
  const n = sorted.length;
  // One value is the only case the methods cannot split. Two already reach
  // the picker's own 2-9 floor, so a two-feature layer asking for two
  // classes must get two rather than one.
  if (n === 1) return [sorted[0], sorted[0]];
  // The dependency check comes after the one-value shortcut: a single value
  // needs no classifier at all, so an unloaded CDN script must not throw for
  // it.
  if (needsSimpleStatistics(method) && !hasSimpleStatistics()) {
    throw new ClassifierDependencyError(
      log.msg("simple-statistics is not loaded; the " + method + " method needs it"),
    );
  }
  // Two is the floor, not three: the picker's own contract is 2-9 on both
  // sides (HeatmapControl.py's num_classes and the fill ramp's classes), so
  // asking for two classes must build two. Forcing three made the request a
  // different request, and one the caller's colour scale did not match,
  // since the scale asks for exactly the class count it was handed.
  numClasses = Math.max(2, Math.min(numClasses, n));

  const lo = sorted[0];
  const hi = sorted[n - 1];

  // No `default` arm: the guard above already turned away everything outside
  // the four names. Leaving it out is what makes a method added to METHOD
  // without an arm here a *typecheck* error - computeBreaks would have no
  // return on that path - instead of a runtime backstop nothing can reach.
  switch (method) {
    case METHOD.JENKS: {
      try {
        const clusters = ss.ckmeans(data, numClasses);
        const breaks: number[] = [clusters[0][0]];
        clusters.forEach(c => breaks.push(c[c.length - 1]));
        return breaks;
      } catch {
        /* fall through */
      }
      return [lo, hi];
    }
    case METHOD.QUANTILE: {
      const b: number[] = [lo];
      for (let i = 1; i < numClasses; i++) {
        b.push(ss.quantileSorted(sorted, i / numClasses));
      }
      return b.concat(hi);
    }
    case METHOD.HEADS: {
      const b: number[] = [lo];
      for (let i = 1; i < numClasses; i++) {
        b.push(sorted[Math.min(Math.floor((i * n) / numClasses), n - 1)]);
      }
      return b.concat(hi);
    }
    case METHOD.EQUAL: {
      const step = (hi - lo) / numClasses;
      const b: number[] = [];
      for (let i = 0; i <= numClasses; i++) b.push(lo + step * i);
      return b;
    }
  }
};

export {
  type ClassifyMethod,
  ClassifierDependencyError,
  ClassifyMethodError,
  METHOD,
  computeBreaks,
  isClassifyMethod,
};
