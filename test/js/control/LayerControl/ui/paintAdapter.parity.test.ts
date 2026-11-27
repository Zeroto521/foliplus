// test/js/control/LayerControl/ui/paintParity — the drawn paint against the panel
// snapshot: where they agree by construction, and the five classes where they
// legitimately differ.
//
// `readLayerPaint` answers what the map draws (per leaf), `getStyle` answers
// what the panel publishes (one effective value per dimension plus provenance).
// They agree wherever both read the same resolver/normalizer, and they diverge
// by design for perFeature layers, value/original modes, multicolor trees, the
// marker chassis preset vs an explicit marker_color, and opacity (whole-layer vs
// fill alpha). Each case below pins the behaviour it documents.
import { beforeEach, describe, expect, it } from "vitest";
import { readLayerPaint } from "#core/layer/index.js";
import { resolveChassisPaint } from "#core/leaflet/index.js";
import { normalizeHexColor } from "#platform/color.js";

class Marker {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  setIcon = () => this;
}

const arealOf = (options: Record<string, unknown>) => ({
  options,
  setStyle: () => undefined,
  getRadius: () => 5,
});

const groupOf = (...children: unknown[]) => ({
  eachLayer: (fn: (child: unknown) => void) => {
    for (const child of children) fn(child);
  },
});

describe("readLayerPaint vs the snapshot's readers", () => {
  beforeEach(() => {
    // The geometry predicate is `instanceof L.Marker`, so the stand-in has to
    // be the class the module resolves through window.L.
    (window as unknown as { L: { Marker: unknown } }).L.Marker = Marker;
  });

  it("defers the marker chassis to the same resolver the snapshot uses", () => {
    const marker = new Marker({ icon: { options: { className: "awesome-marker" } } });
    const paint = readLayerPaint(marker);
    expect(paint.kind).toBe("marker");
    // Both SNAPSHOT_READERS[MARKER_COLOR] and this read end at
    // resolveChassisPaint, so they cannot name two different chassis colours.
    expect(paint.color).toBe(resolveChassisPaint(marker as never));
  });

  it("normalizes a hex fill through the shared colour normalizer", () => {
    const paint = readLayerPaint(
      groupOf(arealOf({ fillColor: "#AbC", color: "#DeF" })),
    );
    expect(paint.color).toBe(normalizeHexColor("#AbC").toLowerCase());
    expect(paint.border).toBe(normalizeHexColor("#DeF").toLowerCase());
  });

  it("documents the multicolor class: a colour set, not one value", () => {
    const paint = readLayerPaint(
      groupOf(
        arealOf({ fillColor: "#ff0000" }),
        arealOf({ fillColor: "#0000ff" }),
        arealOf({ fillColor: "#00ff00" }),
      ),
    );
    expect(paint.multicolor).toBe(true);
    expect(paint.colors).toEqual(["#0000ff", "#00ff00", "#ff0000"]);
    // The snapshot reports ONE dimension (fill.color / fill.perFeature);
    // the set lives here, which is why perFeature layers read colour from
    // this module and provenance from the snapshot.
  });

  it("documents the transparent-fill class: the stroke takes over", () => {
    const paint = readLayerPaint(
      arealOf({ color: "#123456", fillColor: "#ff0000", fillOpacity: 0 }),
    );
    expect(paint.color).toBe("#123456");
    expect(paint.border).toBe("#123456");
  });

  it("documents the mixed-geometry class", () => {
    const paint = readLayerPaint(
      groupOf(arealOf({ fillColor: "#ff0000" }), new Marker({ icon: { options: {} } })),
    );
    expect(paint.kind).toBe("mixed");
  });
});
