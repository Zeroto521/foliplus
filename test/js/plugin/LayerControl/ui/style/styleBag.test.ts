import { describe, expect, it, vi } from "vitest";
import {
  FACE,
  STYLE_APPLY_SOURCE,
  STYLE_BAG_DEFAULTS,
  type StyleApplyFailure,
  cancelStyleDimApply,
  captureStyleBag,
  commitStyleDim,
  dropAllStyleDimApplies,
  dropStyleDimApplies,
  faceSlice,
  flushStyleDimApplies,
  flushStyleDimApply,
  hasStyleDimApply,
  releaseStyleApplyOwner,
  restoreStyleDim,
  scheduleStyleDimApply,
  setStyleApplyFailureReporter,
  styleBagOf,
  styleBaseOf,
  styleDimOverAuthor,
  styleDimPayload,
} from "#foliplus/LayerControl/ui/style/styleBag.js";

/** A Path-like leaf: options bag + receiver-bound setStyle (Leaflet
 *  `Path.setStyle` mutates `this.options` via setOptions). */
const makeLeaf = (options: Record<string, unknown> = {}) => {
  const leaf: any = { options: { ...options } };
  leaf.setStyle = function (style: Record<string, unknown>) {
    Object.assign(this.options, style);
  };
  return leaf;
};

describe("styleDimPayload", () => {
  it("always lights the face visibility bit", () => {
    expect(styleDimPayload({}, FACE.STROKE)).toEqual({ stroke: true });
    expect(styleDimPayload({}, FACE.FILL)).toEqual({ fill: true });
  });

  it("rides value keys alongside the bit and drops undefined ones", () => {
    expect(styleDimPayload({ color: "#f00", weight: undefined }, FACE.STROKE)).toEqual({
      stroke: true,
      color: "#f00",
    });
    expect(styleDimPayload({ fillColor: "#0f0", fillOpacity: 0.5 }, FACE.FILL)).toEqual(
      {
        fill: true,
        fillColor: "#0f0",
        fillOpacity: 0.5,
      },
    );
  });
});

describe("captureStyleBag / styleBagOf", () => {
  it("records the author's full bag once, including false visibility flags", () => {
    const leaf = makeLeaf({
      color: "#111111",
      weight: 3,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.1,
      fill: false,
    });
    const bag = captureStyleBag(leaf);
    expect(bag).toEqual({
      color: "#111111",
      weight: 3,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.1,
      fill: false,
    });
    expect(styleBagOf(leaf)).toBe(bag);
  });

  it("fills missing keys with Leaflet defaults", () => {
    const bag = captureStyleBag(makeLeaf());
    expect(bag).toEqual(STYLE_BAG_DEFAULTS);
  });

  it("does not re-capture after a write mutates options", () => {
    const leaf = makeLeaf({ stroke: false, fill: false });
    const bag = captureStyleBag(leaf);
    leaf.setStyle({ stroke: true, fill: true, color: "#f00" });
    expect(styleBagOf(leaf)).toBe(bag);
    expect(bag.stroke).toBe(false);
    expect(bag.fill).toBe(false);
  });
});

describe("commitStyleDim", () => {
  it("writes value keys and forces the face bit on", () => {
    const leaf = makeLeaf({ stroke: false, fill: false });
    commitStyleDim(leaf, { color: "#f00", weight: 4 }, FACE.STROKE);
    expect(leaf.options).toMatchObject({
      color: "#f00",
      weight: 4,
      stroke: true,
      fill: false,
    });
    commitStyleDim(leaf, { fillColor: "#0f0" }, FACE.FILL);
    expect(leaf.options).toMatchObject({ fillColor: "#0f0", fill: true });
  });
});

describe("restoreStyleDim", () => {
  it("restores one face from the bag and leaves the other alone", () => {
    const leaf = makeLeaf({
      color: "#111111",
      weight: 2,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: false,
    });
    commitStyleDim(leaf, { color: "#f00", weight: 9 }, "stroke");
    commitStyleDim(leaf, { fillColor: "#0f0", fillOpacity: 1 }, "fill");

    restoreStyleDim(leaf, FACE.STROKE);
    expect(leaf.options.stroke).toBe(false);
    expect(leaf.options.color).toBe("#111111");
    expect(leaf.options.weight).toBe(2);
    // fill face untouched by the stroke restore
    expect(leaf.options.fillColor).toBe("#0f0");
    expect(leaf.options.fill).toBe(true);

    restoreStyleDim(leaf, FACE.FILL);
    expect(leaf.options.fill).toBe(false);
    expect(leaf.options.fillColor).toBe("#222222");
    expect(leaf.options.fillOpacity).toBe(0.3);
  });

  it("is a no-op for a leaf that was never written", () => {
    const leaf = makeLeaf({ stroke: true });
    const setStyle = vi.spyOn(leaf, "setStyle");
    restoreStyleDim(leaf, FACE.STROKE);
    expect(setStyle).not.toHaveBeenCalled();
  });
});

describe("faceSlice", () => {
  it("returns only that face's keys from the bag", () => {
    const bag = {
      color: "#111111",
      weight: 2,
      stroke: false,
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: true,
    };
    expect(faceSlice(bag, FACE.STROKE)).toEqual({
      color: "#111111",
      weight: 2,
      stroke: false,
    });
    expect(faceSlice(bag, FACE.FILL)).toEqual({
      fillColor: "#222222",
      fillOpacity: 0.3,
      fill: true,
    });
  });
});

describe("styleBaseOf", () => {
  // Minimal LayerUI mock: styleBaseOf only touches ui.c.findLayer.
  const mockUi = (layer: unknown) => ({ c: { findLayer: () => layer } }) as any;

  // A Path-like leaf that also declares areal geometry, so the fill walk
  // reaches it the way `isArealStyleLeaf` reaches a real Polygon.
  const makeArealLeaf = (options: Record<string, unknown> = {}) => {
    const leaf = makeLeaf(options);
    leaf.feature = { geometry: { type: "Polygon" } };
    return leaf;
  };

  it("reads the first areal leaf's options before any capture", () => {
    const leaf = makeArealLeaf({
      color: "#111111",
      weight: 3,
      fillColor: "#222222",
      fillOpacity: 0.4,
    });
    expect(styleBaseOf(mockUi(leaf), "vec1")).toEqual({
      color: "#111111",
      weight: 3,
      fillColor: "#222222",
      fillOpacity: 0.4,
    });
  });

  it("prefers the captured bag over live options after a user write", () => {
    const leaf = makeArealLeaf({ color: "#111111", fillColor: "#222222" });
    // A user write captures the authored bag first, then mutates options.
    commitStyleDim(leaf, { color: "#ff0000" }, FACE.STROKE);
    expect(leaf.options.color).toBe("#ff0000"); // live options are polluted
    expect(styleBaseOf(mockUi(leaf), "vec1").color).toBe("#111111");
    // The fill face was never written — still read live from options.
    expect(styleBaseOf(mockUi(leaf), "vec1").fillColor).toBe("#222222");
  });

  it("returns Leaflet defaults for a layer that declares no style", () => {
    const leaf = makeLeaf();
    const base = styleBaseOf(mockUi(leaf), "vec1");
    expect(base.color).toBe(STYLE_BAG_DEFAULTS.color);
    expect(base.weight).toBe(STYLE_BAG_DEFAULTS.weight);
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    // fillOpacity stays nullable — the row layer's display falls back to
    // VISIBLE_FILL_OPACITY, not the bag's capture-time floor.
    expect(base.fillOpacity).toBeNull();
  });

  it("returns Leaflet defaults when the layer is null (late-binding miss)", () => {
    const base = styleBaseOf(mockUi(null), "ghost1");
    expect(base.color).toBe(STYLE_BAG_DEFAULTS.color);
    expect(base.weight).toBe(STYLE_BAG_DEFAULTS.weight);
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    expect(base.fillOpacity).toBeNull();
  });

  it("descends through a group to read the first leaf's style", () => {
    const leaf = makeLeaf({ color: "#0000ff", weight: 1.5 });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => fn(leaf)),
    };
    expect(styleBaseOf(mockUi(group), "grp1")).toMatchObject({
      color: "#0000ff",
      weight: 1.5,
    });
  });

  it("reads only the first leaf's fillColor — a later leaf's value never leaks in", () => {
    // The old fill-color reader walked every leaf and took the first
    // `fillColor != null`; `styleBaseOf` matches `authoredBorder`'s existing
    // semantics — take the FIRST leaf with `setStyle` and read ONLY that
    // leaf's options. For a mixed group where the first leaf declares no
    // fillColor but a later leaf does, the result is the default, not the
    // later leaf's value. This locks the unified semantics in place:
    // the panel shows the first feature's actual paint, even if a sibling
    // has a different fill, because that's what the author painted on the
    // first feature the map will hit.
    const firstLeaf = makeLeaf({ color: "#111111" }); // no fillColor
    const laterLeaf = makeLeaf({ color: "#222222", fillColor: "#00ff00" });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(firstLeaf);
        fn(laterLeaf);
      }),
    };
    const base = styleBaseOf(mockUi(group), "grp1");
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    expect(base.fillColor).not.toBe("#00ff00");
    // The border face still reads the first leaf's declared color.
    expect(base.color).toBe("#111111");
  });

  it("reads the fill face from the first areal leaf, past a leading line", () => {
    // A mixed layer whose first leaf is a line: the fill row must show the
    // polygon the fill actually writes to, not the line the walk meets first.
    // The old single-carrier reader handed the line's options to the fill
    // face, so the panel opened with a color the layer never painted.
    const line = makeLeaf({ color: "#111111", fillColor: "#222222" });
    const polygon = makeArealLeaf({
      color: "#333333",
      weight: 2,
      fillColor: "#abcdef",
      fillOpacity: 0.5,
    });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(line);
        fn(polygon);
      }),
    };
    const base = styleBaseOf(mockUi(group), "grp1");
    expect(base.fillColor).toBe("#abcdef");
    expect(base.fillOpacity).toBe(0.5);
    expect(base.fillColor).not.toBe("#222222");
    // The border face still reads the first setter - the stroke the first
    // feature paints - so one mixed layer feeds both rows from its own side.
    expect(base.color).toBe("#111111");
    expect(base.weight).toBe(STYLE_BAG_DEFAULTS.weight);
  });

  it("keeps a polygon-first mixed layer on its polygon for both faces", () => {
    const polygon = makeArealLeaf({
      color: "#aabbcc",
      weight: 3,
      fillColor: "#ddeeff",
      fillOpacity: 0.25,
    });
    const line = makeLeaf({ color: "#000000", fillColor: "#ffffff" });
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(polygon);
        fn(line);
      }),
    };
    expect(styleBaseOf(mockUi(group), "grp1")).toEqual({
      color: "#aabbcc",
      weight: 3,
      fillColor: "#ddeeff",
      fillOpacity: 0.25,
    });
  });

  it("falls back to defaults on the fill face when no leaf can carry a fill", () => {
    // A line-only layer: the fill row is never shown, but the reader must not
    // invent a fill either - it returns the face's default, as before.
    const line = makeLeaf({ color: "#555555", weight: 4, fillColor: "#666666" });
    const base = styleBaseOf(mockUi(line), "line1");
    expect(base.fillColor).toBe(STYLE_BAG_DEFAULTS.fillColor);
    expect(base.fillOpacity).toBeNull();
    expect(base.color).toBe("#555555");
    expect(base.weight).toBe(4);
  });

  it("resolves the fill carrier through a nested mixed group", () => {
    const inner = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(makeLeaf({ color: "#123456", fillColor: "#654321" }));
        fn(makeArealLeaf({ fillColor: "#fedcba", fillOpacity: 0.7 }));
      }),
    };
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(makeLeaf({ color: "#000000" }));
        fn(inner);
      }),
    };
    expect(styleBaseOf(mockUi(group), "grp1").fillColor).toBe("#fedcba");
    expect(styleBaseOf(mockUi(group), "grp1").color).toBe("#000000");
  });

  it("prefers the captured bag of the areal leaf after a user fill write", () => {
    const line = makeLeaf({ color: "#111111" });
    const polygon = makeArealLeaf({ color: "#333333", fillColor: "#abcdef" });
    // The user's write captures the polygon's authored bag first, then mutates
    // its live options. The fill face must still report the author's color.
    commitStyleDim(polygon, { fillColor: "#ff0000" }, FACE.FILL);
    const group: any = {
      options: {},
      eachLayer: vi.fn((fn: (child: unknown) => void) => {
        fn(line);
        fn(polygon);
      }),
    };
    const base = styleBaseOf(mockUi(group), "grp1");
    expect(base.fillColor).toBe("#abcdef");
    expect(base.color).toBe("#111111");
  });

  it("keeps the author's value when the override is undefined", () => {
    // The ramp's out-of-reach replay hands over { fillOpacity } and the
    // user's opacity may be undefined - an undefined entry must not blank
    // the author's value, it must leave it in force.
    const leaf = makeLeaf({ fillColor: "#112233", fillOpacity: 0.2, fill: true });
    expect(
      styleDimOverAuthor(leaf, { fillOpacity: undefined }, FACE.FILL, false),
    ).toEqual({
      fillColor: "#112233",
      fillOpacity: 0.2,
      fill: true,
    });
  });

  it("fill and border consumers share one reader — same output shape", () => {
    // The whole point of this helper is that fill and border rows read
    // from the same call site (`styleBaseOf`), so neither row can drift
    // from the other. Assert a single styleBaseOf call gives both faces
    // consistent values.
    const leaf = makeArealLeaf({
      color: "#aabbcc",
      weight: 2,
      fillColor: "#ddeeff",
      fillOpacity: 0.3,
    });
    const base = styleBaseOf(mockUi(leaf), "vec1");
    expect(base).toEqual({
      color: "#aabbcc",
      weight: 2,
      fillColor: "#ddeeff",
      fillOpacity: 0.3,
    });
  });
});

describe("per-id face sweeps", () => {
  // The queue is keyed on (face, layerId), and two per-id sweeps retire it:
  // `flushStyleDimApplies` at the panel-close boundary, `dropStyleDimApplies`
  // on unregister. Both enumerate `FACE` rather than a hand-written list, so
  // adding a face member reaches both. These two tests are the guard: the
  // expectation is derived from `FACE` on the same side as the code, so a
  // face the queue accepts but a sweep cannot reach fails here — the
  // hand-written list would have leaked a task after unregister and dropped
  // a trailing write when the panel closed.
  it("flush lands a trailing write on every face the queue accepts", () => {
    for (const face of Object.values(FACE)) {
      const runs = vi.fn();
      const id = `flush-${face}`;
      scheduleStyleDimApply(face, id, runs);
      expect(hasStyleDimApply(face, id)).toBe(true);
      flushStyleDimApplies(id);
      expect(runs, `${face} never flushed`).toHaveBeenCalledTimes(1);
    }
  });

  it("drop retires every face the queue accepts without running it", () => {
    for (const face of Object.values(FACE)) {
      const runs = vi.fn();
      const id = `drop-${face}`;
      scheduleStyleDimApply(face, id, runs);
      dropStyleDimApplies(id);
      expect(runs, `${face} ran after drop`).not.toHaveBeenCalled();
      expect(hasStyleDimApply(face, id), `${face} still held`).toBe(false);
    }
  });
});

describe("apply scheduler lifecycle", () => {
  // A box lives exactly as long as its frame is pending: the wrapper
  // reclaims the entry before the run, `cancel` reclaims it immediately,
  // and a failure inside the boundary is recorded instead of escaping the
  // frame. These pin the ownership contract the unregister drop and the
  // control-destroy dropAll rely on.
  it("execution reclaims the entry — a second flush is a no-op", () => {
    const runs = vi.fn();
    scheduleStyleDimApply(FACE.STROKE, "lc1", runs);
    flushStyleDimApply(FACE.STROKE, "lc1");
    expect(runs).toHaveBeenCalledTimes(1);
    expect(hasStyleDimApply(FACE.STROKE, "lc1")).toBe(false);
    flushStyleDimApply(FACE.STROKE, "lc1");
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it("cancel reclaims the entry", () => {
    const runs = vi.fn();
    scheduleStyleDimApply(FACE.FILL, "lc2", runs);
    cancelStyleDimApply(FACE.FILL, "lc2");
    expect(hasStyleDimApply(FACE.FILL, "lc2")).toBe(false);
    flushStyleDimApplies("lc2");
    expect(runs).not.toHaveBeenCalled();
  });

  it("a run that re-schedules the same key keeps its next frame", () => {
    // Reclamation happens BEFORE the run, so a re-entrant schedule builds a
    // fresh box instead of mutating the one currently executing — the next
    // frame is never lost to the reclaim.
    let count = 0;
    const reScheduling = vi.fn(() => {
      count += 1;
      if (count < 3) scheduleStyleDimApply(FACE.SIZE, "lc3", reScheduling);
    });
    scheduleStyleDimApply(FACE.SIZE, "lc3", reScheduling);
    flushStyleDimApply(FACE.SIZE, "lc3");
    expect(reScheduling).toHaveBeenCalledTimes(1);
    expect(hasStyleDimApply(FACE.SIZE, "lc3")).toBe(true);
    flushStyleDimApply(FACE.SIZE, "lc3");
    expect(reScheduling).toHaveBeenCalledTimes(2);
    expect(hasStyleDimApply(FACE.SIZE, "lc3")).toBe(true);
    flushStyleDimApply(FACE.SIZE, "lc3");
    expect(reScheduling).toHaveBeenCalledTimes(3);
    expect(hasStyleDimApply(FACE.SIZE, "lc3")).toBe(false);
  });

  it("a throwing run is recorded, not escaped — and later tasks still run", () => {
    const failures: StyleApplyFailure[] = [];
    setStyleApplyFailureReporter(failure => failures.push(failure));
    try {
      const boom = new Error("label boom");
      scheduleStyleDimApply(FACE.LABEL, "lc4", () => {
        throw boom;
      });
      expect(() => flushStyleDimApply(FACE.LABEL, "lc4")).not.toThrow();
      expect(failures).toEqual([
        {
          face: FACE.LABEL,
          layerId: "lc4",
          source: STYLE_APPLY_SOURCE,
          error: boom,
        },
      ]);

      const after = vi.fn();
      scheduleStyleDimApply(FACE.LABEL, "lc4", after);
      flushStyleDimApply(FACE.LABEL, "lc4");
      expect(after).toHaveBeenCalledTimes(1);
      expect(failures).toHaveLength(1);
    } finally {
      setStyleApplyFailureReporter(null);
    }
  });

  it("a custom source rides the box into the failure report", () => {
    const failures: StyleApplyFailure[] = [];
    setStyleApplyFailureReporter(failure => failures.push(failure));
    try {
      scheduleStyleDimApply(
        FACE.FILL,
        "lc5",
        () => {
          throw new Error("boom");
        },
        "foliplus:layer:item-count-change",
      );
      flushStyleDimApply(FACE.FILL, "lc5");
      expect(failures[0]?.source).toBe("foliplus:layer:item-count-change");
    } finally {
      setStyleApplyFailureReporter(null);
    }
  });

  it("dropAll reclaims every pending box without running it", () => {
    const a = vi.fn();
    const b = vi.fn();
    scheduleStyleDimApply(FACE.FILL, "lc6", a);
    scheduleStyleDimApply(FACE.LABEL, "lc7", b);
    dropAllStyleDimApplies();
    expect(hasStyleDimApply(FACE.FILL, "lc6")).toBe(false);
    expect(hasStyleDimApply(FACE.LABEL, "lc7")).toBe(false);
    flushStyleDimApplies("lc6");
    flushStyleDimApplies("lc7");
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("apply ownership", () => {
  // Two LayerControls on one page (two maps) must not share scheduler
  // state: a flush, a drop or a destroy owned by one UI may not cancel or
  // run the other's frames, and a late failure reports to the map that
  // scheduled it. The owner-less free functions above remain the test
  // facade; these pin the per-UI scope production uses.
  const ownerA = {};
  const ownerB = {};

  it("flushes and drops only the named owner's boxes", () => {
    const runA = vi.fn();
    const runB = vi.fn();
    scheduleStyleDimApply(FACE.FILL, "shared-id", runA, { owner: ownerA });
    scheduleStyleDimApply(FACE.FILL, "shared-id", runB, { owner: ownerB });

    flushStyleDimApply(FACE.FILL, "shared-id", ownerA);
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).not.toHaveBeenCalled();
    expect(hasStyleDimApply(FACE.FILL, "shared-id", ownerB)).toBe(true);

    dropStyleDimApplies("shared-id", ownerB);
    expect(hasStyleDimApply(FACE.FILL, "shared-id", ownerB)).toBe(false);
    flushStyleDimApply(FACE.FILL, "shared-id", ownerB);
    expect(runB).not.toHaveBeenCalled();
  });

  it("dropAll for one owner leaves the other owner's frame pending", () => {
    const runA = vi.fn();
    const runB = vi.fn();
    scheduleStyleDimApply(FACE.LABEL, "lcA", runA, { owner: ownerA });
    scheduleStyleDimApply(FACE.LABEL, "lcB", runB, { owner: ownerB });

    dropAllStyleDimApplies(ownerA);

    expect(hasStyleDimApply(FACE.LABEL, "lcA", ownerA)).toBe(false);
    expect(hasStyleDimApply(FACE.LABEL, "lcB", ownerB)).toBe(true);
    flushStyleDimApplies("lcB", ownerB);
    expect(runA).not.toHaveBeenCalled();
    expect(runB).toHaveBeenCalledTimes(1);
  });

  it("a failure reports to the owner's reporter, and release detaches it", () => {
    const failuresA: StyleApplyFailure[] = [];
    const failuresB: StyleApplyFailure[] = [];
    setStyleApplyFailureReporter(failure => failuresA.push(failure), ownerA);
    setStyleApplyFailureReporter(failure => failuresB.push(failure), ownerB);
    try {
      scheduleStyleDimApply(
        FACE.SIZE,
        "lcA",
        () => {
          throw new Error("a boom");
        },
        { owner: ownerA },
      );
      scheduleStyleDimApply(
        FACE.SIZE,
        "lcB",
        () => {
          throw new Error("b boom");
        },
        { owner: ownerB },
      );
      flushStyleDimApply(FACE.SIZE, "lcA");
      expect(failuresA).toHaveLength(1);
      expect(failuresA[0]?.layerId).toBe("lcA");
      expect(failuresB).toHaveLength(0);

      // Releasing A drops its reporter with its boxes: a frame that still
      // runs under that scope (a re-entrant schedule) records nothing on a
      // dead host.
      releaseStyleApplyOwner(ownerA);
      scheduleStyleDimApply(
        FACE.SIZE,
        "lcA2",
        () => {
          throw new Error("late boom");
        },
        { owner: ownerA },
      );
      flushStyleDimApply(FACE.SIZE, "lcA2", ownerA);
      expect(failuresA).toHaveLength(1);
    } finally {
      releaseStyleApplyOwner(ownerA);
      releaseStyleApplyOwner(ownerB);
    }
  });
});
