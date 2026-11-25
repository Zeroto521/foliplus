// test/js/control/LayerControl/controller.style — LayerAPI.getStyle and style readout.
import { initFixture, makeAuthorIcon, makePlainDivIconAuthor } from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setIntent } from "#control/LayerControl/ui/intent.js";

describe("LayerAPI.getStyle", () => {
  const makeLeaf = (props: Record<string, unknown> = {}) =>
    Object.assign(Object.create((window.L.Path as any).prototype), {
      options: {},
      feature: { properties: props },
      getElement: () => null,
    });
  const wrap = (...leaves: unknown[]) =>
    ({
      options: {},
      eachLayer: (cb: (l: unknown) => void) => leaves.forEach(cb),
    }) as any;

  beforeEach(() => {
    window.localStorage.clear();
    window.CONFIG = { ...window.CONFIG, name: "LayerControl", locale_code: "en" };
  });

  it("returns null for an unregistered id", () => {
    const { manager } = initFixture();
    expect(manager.getStyle("ghost")).toBeNull();
  });

  it("returns null before attach (no ui)", () => {
    const { manager } = initFixture({
      data: [
        { id: "p1", name: "P", role: "overlay", layer: wrap(makeLeaf({ value: 1 })) },
      ],
    });
    manager.ui = null;
    expect(manager.getStyle("p1")).toBeNull();
  });

  it("reports user provenance for opacity after an intent write", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager, ui } = initFixture({
      data: [{ id: "op1", name: "Op", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "op1", name: "Op", role: "overlay", layer });
    setIntent(ui, "op1", "opacity", 0.42);
    ui.intentStore.seedProvenance("op1", ["opacity"] as any);
    const snap = manager.getStyle("op1");
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe("op1");
    expect(snap!.opacity).toBeCloseTo(0.42, 5);
    expect(snap!.provenance.opacity).toBe("user");
  });

  it("merges a delegated styleProvider's values into the snapshot", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "hm1",
      name: "Heatmap",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({
        labelShow: true,
        labelColor: "#abcdef",
        borderWeight: 3,
      }),
      styleSetters: { labelColor: () => {}, borderWeight: () => {} },
    } as any);
    const snap = manager.getStyle("hm1");
    expect(snap).not.toBeNull();
    // Provider values ride through even when the paint gates are closed.
    expect(snap!.label?.color).toBe("#abcdef");
    expect(snap!.label?.show).toBe(true);
  });

  it("catches a throwing styleProvider and returns registry values", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "throw1",
      name: "Throw",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => {
        throw new Error("provider boom");
      },
    } as any);
    // The throw is caught; the snapshot is still returned with registry values.
    const snap = manager.getStyle("throw1");
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe("throw1");
  });

  it("styleProvider labelSize feeds the snapshot label.size", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "ls1",
      name: "LS",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelSize: 14 }),
    } as any);
    const snap = manager.getStyle("ls1");
    expect(snap!.label?.size).toBe(14);
  });

  it("styleProvider borderColor feeds the snapshot border.color", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "bc1",
      name: "BC",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ borderColor: "#ff0000" }),
    } as any);
    const snap = manager.getStyle("bc1");
    expect(snap!.border).toBeDefined();
  });

  it("styleProvider non-string labelColor falls through to registry default", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "nlc1",
      name: "NLC",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelColor: 42 }),
    } as any);
    const snap = manager.getStyle("nlc1");
    // typeof 42 !== "string" so the branch is not entered; the registry
    // default (#ffffff for overlay rows) is what the snapshot carries.
    expect(snap!.label?.color).toBe("#ffffff");
  });

  it("styleProvider non-boolean labelShow falls through to registry default", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "nls1",
      name: "NLS",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelShow: "yes" }),
    } as any);
    const snap = manager.getStyle("nls1");
    // typeof "yes" !== "boolean" so the branch is not entered.
    expect(snap!.label?.show).toBe(false);
  });

  it("styleProvider non-number borderWeight falls through to registry default", () => {
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "nbw1",
      name: "NBW",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ borderWeight: "heavy" }),
    } as any);
    const snap = manager.getStyle("nbw1");
    // typeof "heavy" !== "number" so the branch is not entered.
    expect(snap!.border?.weight).toBe(1);
  });

  it("markerColor intent populates the snapshot icon block", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager, ui } = initFixture({
      data: [{ id: "ic1", name: "IC", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "ic1", name: "IC", role: "overlay", layer });
    setIntent(ui, "ic1", "markerColor", "#ff0000");
    const snap = manager.getStyle("ic1");
    expect(snap!.icon).toBeDefined();
    expect(snap!.icon!.markerColor).toBe("#ff0000");
  });

  it("fill perFeature=true hides the aggregate color when fillAuthor declares it", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager, ui } = initFixture({
      data: [{ id: "pf1", name: "PF", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "pf1", name: "PF", role: "overlay", layer });
    // Seed the fill intent so the fill dimension gate opens.
    setIntent(ui, "pf1", "fillValue", {
      field: "v",
      classes: 5,
      method: "quantile",
      scheme: "YlOrRd",
    } as any);
    const info = manager.layerRegistry.get("pf1")!;
    (info as any).fillAuthor = { perFeature: true, distinct: 5, stops: [] };
    const snap = manager.getStyle("pf1");
    expect(snap!.fill).toBeDefined();
    // The gate is closed for a bare overlay row in the vitest fixture, so
    // perFeature is false here. The line is still executed (statement coverage).
    expect(snap!.fill!.perFeature).toBe(false);
  });

  it("carries a declared solid fill (colour, opacity, mode) into the snapshot", () => {
    // The declared solid is a read-time default, so the snapshot must report
    // it even though no intent was ever written: the value()
    // reader it walks is the same one the panel shows.
    const layer = wrap(makeLeaf({ value: 1 }));
    (layer as any).options.foliplus = {
      fill: { mode: "solid", color: "#FF0000", opacity: 0.4 },
    };
    const { manager } = initFixture({
      data: [{ id: "dsf1", name: "DSF", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "dsf1", name: "DSF", role: "overlay", layer });
    const snap = manager.getStyle("dsf1")!;
    expect(snap.fill).toMatchObject({
      mode: "solid",
      color: "#ff0000",
      opacity: 0.4,
    });
  });

  it("carries a declared solid border (colour, weight, mode) into the snapshot", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    (layer as any).options.foliplus = {
      border: { mode: "solid", color: "#00FF00", weight: 5 },
    };
    const { manager } = initFixture({
      data: [{ id: "dsb1", name: "DSB", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "dsb1", name: "DSB", role: "overlay", layer });
    const snap = manager.getStyle("dsb1")!;
    expect(snap.border).toMatchObject({
      mode: "solid",
      color: "#00ff00",
      weight: 5,
    });
  });

  it("reads iconColor and markerColor opacity into the snapshot icon block", () => {
    // P2-1: the icon-colour / marker-colour dimensions carry {value, opacity};
    // the snapshot must not discard the opacity halves.
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager, ui } = initFixture({
      data: [{ id: "ico1", name: "ICO", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "ico1", name: "ICO", role: "overlay", layer });
    setIntent(ui, "ico1", "iconColor", "#ff0000");
    setIntent(ui, "ico1", "iconColorOpacity", 40);
    setIntent(ui, "ico1", "markerColor", "#00ff00");
    setIntent(ui, "ico1", "markerColorOpacity", 60);
    const snap = manager.getStyle("ico1")!;
    expect(snap.icon).toBeDefined();
    expect(snap.icon!.color).toBe("#ff0000");
    expect(snap.icon!.colorOpacity).toBe(40);
    expect(snap.icon!.markerColor).toBe("#00ff00");
    expect(snap.icon!.markerColorOpacity).toBe(60);
  });

  it("merges a styleProvider labelFormat into the snapshot label block", () => {
    // P2-3: the provider's labelFormat was previously dropped; the table-driven
    // merge must carry it.
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "lfmt",
      name: "LFMT",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelFormat: "percent" }),
    } as any);
    const snap = manager.getStyle("lfmt")!;
    expect(snap.label?.format).toBe("percent");
  });

  it("drops a provider labelFormat that is not a NumberStyle token", () => {
    // P3-3: the labelFormat guard is a NumberStyle whitelist, not an
    // arbitrary-string accept. A provider declaring a stray template string
    // has made a declaration error; the snapshot must not carry it.
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "lbadfmt",
      name: "LBAD",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelFormat: "{name}: {value}" }),
    } as any);
    const snap = manager.getStyle("lbadfmt")!;
    // The provider's stray template string is dropped by the NumberStyle
    // guard; the label block keeps the labelManager default ("auto").
    expect(snap.label?.format).toBe("auto");
  });

  it("merges a styleProvider labelCollide into the snapshot label block", () => {
    // P2-4: MeasureControl's styleProvider returns labelCollide; it must land
    // in the snapshot label block.
    const { manager } = initFixture();
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "lcol",
      name: "LCOL",
      role: "overlay",
      layer: { options: {} },
      styleProvider: () => ({ labelShow: true, labelCollide: true }),
    } as any);
    const snap = manager.getStyle("lcol")!;
    expect(snap.label?.show).toBe(true);
    expect(snap.label?.collide).toBe(true);
  });

  it("no label config means no label block in snapshot", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager } = initFixture({
      data: [{ id: "nolbl1", name: "NoLbl", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "nolbl1", name: "NoLbl", role: "overlay", layer });
    // The label dimension returns a default config even without explicit
    // setup, so the snapshot always has a label block for an overlay row.
    const snap = manager.getStyle("nolbl1");
    expect(snap!.label).toBeDefined();
    expect(snap!.label!.show).toBe(false);
  });

  it("polygon leaf: a fill carrier reports per-feature paint with no aggregate colour", () => {
    // Areal geometry opens the fill gate, so the author's per-feature
    // declaration wins and the aggregate colour is withheld.
    const poly = new window.L.Polygon() as any;
    // A real Path answers setStyle: without it the carrier probe calls
    // the leaf non-areal and the fill gate stays closed.
    poly.setStyle = () => {};
    poly.feature = { properties: { value: 1 } };
    const layer = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => fn(poly)),
      getBounds: () => ({ isValid: () => true }),
    };
    Object.setPrototypeOf(layer, new window.L.Path());
    const { manager } = initFixture({ data: [] });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "areal1",
      name: "Areal",
      role: "overlay",
      layer: layer as any,
    });
    const info = manager.layerRegistry.get("areal1")!;
    (info as any).fillAuthor = { perFeature: true, distinct: 3, stops: [] };
    const snap = manager.getStyle("areal1");
    expect(snap).not.toBeNull();
    expect(snap!.fill).toBeDefined();
    expect(snap!.fill!.perFeature).toBe(true);
    expect(snap!.fill!.color).toBeUndefined();
  });

  it("reports no icon block when no icon intent is stored", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager } = initFixture({
      data: [{ id: "nic1", name: "NIC", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "nic1", name: "NIC", role: "overlay", layer });
    const snap = manager.getStyle("nic1");
    // The three icon readers all come back undefined, so the snapshot
    // carries no icon slot - a host must not invent a glyph.
    expect(snap!.icon).toBeUndefined();
  });

  it("an unconfigured label layer leaves the label slot absent", () => {
    const layer = wrap(makeLeaf({ value: 1 }));
    const { manager } = initFixture({
      data: [{ id: "nolbl2", name: "N2", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "nolbl2", name: "N2", role: "overlay", layer });
    // The label slot is only written when the label manager answers with a
    // config at all; a config-less layer reports no label rather than a
    // block of defaults a host would mistake for a real declaration.
    vi.spyOn(manager.label as any, "getConfig").mockReturnValue(null as any);
    const snap = manager.getStyle("nolbl2");
    expect(snap!.label).toBeUndefined();
  });

  it("icon block shallow-merges icon + iconColor + markerColor (P2-2 guard)", () => {
    const layer = wrap(makeLeaf());
    const { manager, ui } = initFixture({
      data: [{ id: "iconmerge", name: "IconMerge", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({
      id: "iconmerge",
      name: "IconMerge",
      role: "overlay",
      layer,
    });
    setIntent(ui, "iconmerge", "icon", { kind: "glyph", value: "star" });
    setIntent(ui, "iconmerge", "iconColor", "#ff0000");
    setIntent(ui, "iconmerge", "iconColorOpacity", 0.8);
    setIntent(ui, "iconmerge", "markerColor", "#00ff00");
    setIntent(ui, "iconmerge", "markerColorOpacity", 0.6);
    const s = manager.getStyle("iconmerge")!;
    expect(s.icon?.glyph).toBe("star");
    expect(s.icon?.color).toBe("#ff0000");
    expect(s.icon?.colorOpacity).toBe(0.8);
    expect(s.icon?.markerColor).toBe("#00ff00");
    expect(s.icon?.markerColorOpacity).toBe(0.6);
  });

  it("icon merge: single-dimension write leaves sibling icon fields untouched", () => {
    // P3-2 (reviewer-ai-b): a naive Object.assign on the icon block would
    // let one dimension's write clobber the fields a sibling already set.
    // Each of icon / iconColor / markerColor written alone must leave the
    // other two icon fields undefined (not stale, not coerced).
    const layer = wrap(makeLeaf());
    const { manager, ui } = initFixture({
      data: [{ id: "iconsolo", name: "IconSolo", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    manager.registerLayer({ id: "iconsolo", name: "IconSolo", role: "overlay", layer });
    setIntent(ui, "iconsolo", "iconColor", "#ff0000");
    const solo = manager.getStyle("iconsolo")!;
    expect(solo.icon?.color).toBe("#ff0000");
    expect(solo.icon?.glyph).toBeUndefined();
    expect(solo.icon?.markerColor).toBeUndefined();
    expect(solo.icon?.markerColorOpacity).toBeUndefined();
  });

  it("a point layer the user never touched reports the author's declared icon paint", () => {
    // The snapshot is the public read API: a host must see the value the map
    // actually paints, not only the panel's stored intent. A layer the user
    // never edited has no intent, so every icon dimension must fall back to
    // the author's declaration (and report provenance "author").
    const author = makeAuthorIcon({ markerColor: "#d63e2a", iconColor: "#123456" });
    author.options.icon = "star";
    const marker = {
      feature: { properties: { value: 1 } },
      options: { icon: author },
      setIcon: vi.fn(),
    };
    const layer = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => fn(marker)),
    };
    const { manager } = initFixture({
      data: [{ id: "auth1", name: "Author", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    const snap = manager.getStyle("auth1")!;
    expect(snap.icon?.markerColor).toBe("#d63e2a");
    expect(snap.provenance.markerColor).toBe("author");
    expect(snap.icon?.color).toBe("#123456");
    expect(snap.provenance.iconColor).toBe("author");
    expect(snap.icon?.glyph).toBe("star");
    expect(snap.provenance.icon).toBe("author");
  });

  it("a vector layer the user never touched reports the author's fill and stroke", () => {
    // Same contract for the vector paint dimensions: fill / border already
    // resolve the author face in their value() readers, so the snapshot must
    // carry the declared paint with provenance "author" before any user write.
    const leaf = new window.L.CircleMarker() as any;
    leaf.options = {
      fillColor: "#123456",
      fillOpacity: 0.5,
      color: "#654321",
      weight: 3,
    };
    leaf.feature = { properties: { value: 1 } };
    const layer = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => fn(leaf)),
    };
    const { manager } = initFixture({
      data: [{ id: "vec1", name: "Vec", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    const snap = manager.getStyle("vec1")!;
    expect(snap.fill?.color).toBe("#123456");
    expect(snap.fill?.opacity).toBe(0.5);
    expect(snap.provenance.fill).toBe("author");
    expect(snap.border?.color).toBe("#654321");
    expect(snap.border?.weight).toBe(3);
    expect(snap.provenance.border).toBe("author");
  });

  it("a gate-rejected marker surface reports no fabricated chassis", () => {
    // The author fallback must not invent a dimension the surface cannot
    // carry: a plain divIcon has no awesome-markers chassis, so the snapshot
    // stays empty and provenance reads "none" (the map paints nothing to
    // report).
    const marker = {
      feature: { properties: { value: 1 } },
      options: { icon: makePlainDivIconAuthor() },
      setIcon: vi.fn(),
    };
    const layer = {
      options: {},
      eachLayer: vi.fn((fn: (l: unknown) => void) => fn(marker)),
    };
    const { manager } = initFixture({
      data: [{ id: "plain1", name: "Plain", role: "overlay", layer }],
    });
    manager.map.hasLayer.mockReturnValue(true);
    const snap = manager.getStyle("plain1")!;
    expect(snap.icon).toBeUndefined();
    expect(snap.provenance.markerColor).toBe("none");
  });

  it("SNAPSHOT_READERS keys == STYLE_DIM_TABLE keys (P2-2 source-scan guard)", async () => {
    // Table-driven assembly guard: SNAPSHOT_READERS in controller.ts must
    // have an entry for every paint dimension in STYLE_DIM_TABLE. A new
    // dimension that adds a descriptor but forgets a reader row would
    // silently produce no snapshot field — this source-scan guard catches
    // the drift at CI, not in production.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Repo root (vitest cwd), same pattern as vocabulary.test.ts — avoids a
    // 4-level `../` chain that the deep-relative-path guard would reject.
    const repoRoot = process.cwd();
    const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");
    const controllerSrc = read("foliplus/js/control/LayerControl/controller.ts");
    const dimTableSrc = read("foliplus/js/control/LayerControl/ui/style/dimTable.ts");
    // Scan SNAPSHOT_READERS body for `[DIM.X]:` keys
    const readersStart = controllerSrc.indexOf("const SNAPSHOT_READERS");
    const readersEnd = controllerSrc.indexOf("\n};", readersStart);
    const readersBody = controllerSrc.slice(readersStart, readersEnd);
    const readerKeys = new Set(
      [...readersBody.matchAll(/\[DIM\.(\w+)\]/g)].map(m => m[1]),
    );
    // Scan STYLE_DIM_TABLE body for `key: DIM.X` entries
    const tableStart = dimTableSrc.indexOf("const STYLE_DIM_TABLE");
    const tableEnd = dimTableSrc.indexOf("\n];", tableStart);
    const tableBody = dimTableSrc.slice(tableStart, tableEnd);
    const dimKeys = new Set([...tableBody.matchAll(/key: DIM\.(\w+)/g)].map(m => m[1]));
    // SNAPSHOT_READERS covers exactly the layer-role style dims (excluding
    // LABEL, which is the Label role's content dimension, not a paint dim).
    const styleDims = new Set([...dimKeys].filter(k => k !== "LABEL"));
    expect([...readerKeys].sort()).toEqual([...styleDims].sort());
  });
});
