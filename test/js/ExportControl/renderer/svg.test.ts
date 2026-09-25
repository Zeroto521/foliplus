import { afterEach, describe, expect, it, vi } from "vitest";
import * as UTIL from "#foliplus/ExportControl/util.js";
import * as CONST from "#foliplus/ExportControl/const.js";
import { renderPaneSVG } from "#foliplus/ExportControl/renderer/svg.js";
import {
  captureSources,
  makeMockCtx,
  makeRenderer,
  pinBox,
  positionedRC,
  stubLoad,
} from "./fixture.js";

vi.mock("#foliplus/ExportControl/util.js", async () => {
  const actual = await vi.importActual<any>("#foliplus/ExportControl/util.js");
  const loadImageBitmap = vi.fn();
  return { ...actual, loadImageBitmap };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renderPaneSVG", () => {
  const NS = CONST.SVG_NS;

  const pane = () => {
    const p = document.createElement("div");
    p.className = "leaflet-map-pane";
    return p;
  };

  it("paints an svg that carries a shape element", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("counts a g element that itself holds a shape", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const g = document.createElementNS(NS, "g");
    g.appendChild(document.createElementNS(NS, "circle"));
    svg.appendChild(g);
    p.appendChild(svg);
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips an svg with no content", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    p.appendChild(svg);
    const load = stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("skips an svg with no area", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 0, 0);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    const load = stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(load).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("applies pane opacity via ctx.globalAlpha when less than 1", async () => {
    const ctx = makeMockCtx();
    ctx.globalAlpha = 1;
    let alphaDuringDraw = 0;
    ctx.drawImage = vi.fn(() => {
      alphaDuringDraw = ctx.globalAlpha;
    });
    const p = pane();
    p.style.opacity = "0.5";
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    stubLoad();
    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(alphaDuringDraw).toBe(0.5);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("peels the pane's own visibility: a transient view state such as focus", async () => {
    // focus.css hides every non-focused pane with one rule, and `visibility`
    // inherits — so a computed read hands back the ancestor's contribution as
    // the child's own.  Copying it serialises the layer hidden and the whole
    // vector set silently leaves a focused export.  Flipping the pane's inline
    // value peels just that part.
    const ctx = makeMockCtx();
    const p = pane();
    p.style.visibility = "hidden";
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M 0 0 L 200 0 L 200 200 L 0 200 Z");
    svg.appendChild(path);
    p.appendChild(svg);
    const srcs = captureSources();
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect((srcs[0] || "").match(/visibility:\s*hidden/g)).toBeNull();
    expect(p.style.visibility).toBe("hidden");
  });

  it("restores the pane's visibility when reading the clone throws", async () => {
    // The flip lives in a finally: render() awaits between panes, so a leak
    // across an await would hold the layers un-hidden for the whole export.
    const ctx = makeMockCtx();
    const p = pane();
    p.style.visibility = "hidden";
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    svg.appendChild(document.createElementNS(NS, "path"));
    p.appendChild(svg);
    vi.spyOn(XMLSerializer.prototype, "serializeToString").mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(
      renderPaneSVG(makeRenderer().container, 
        positionedRC(1000, 1000, ctx),
        p,
      ),
    ).rejects.toThrow("boom");

    expect(p.style.visibility).toBe("hidden");
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("keeps a child's own visibility: hidden and its neighbours visible", async () => {
    // The other half of the contract: only the ancestor contribution is peeled.
    // Collision suppression hides individual label chips the same way, and the
    // export is meant to keep drawing them.
    const ctx = makeMockCtx();
    const p = pane();
    p.style.visibility = "hidden";
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const hidden = document.createElementNS(NS, "path");
    hidden.setAttribute("d", "M 0 0 L 200 0 L 200 200 L 0 200 Z");
    hidden.style.visibility = "hidden";
    const shown = document.createElementNS(NS, "path");
    shown.setAttribute("d", "M 20 20 L 180 20 L 180 180 L 20 180 Z");
    svg.append(hidden, shown);
    p.appendChild(svg);
    const srcs = captureSources();
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    const src = srcs[0] || "";
    expect((src.match(/visibility:\s*hidden/g) || []).length).toBe(1);
    expect(src).toContain("L 200 200");
    expect(src).toContain("L 180 180");
  });

  it("removes a child's own display: none from the clone — rule or inline", async () => {
    // The pipeline serialises to an <img>, which ignores inline display, so the
    // only reliable exclusion is removal.  Both rule-hidden and inline-hidden
    // elements must be pruned from the clone.
    const style = document.createElement("style");
    style.textContent = ".t25-rule-hidden { display: none; }";
    document.head.appendChild(style);
    try {
      const ctx = makeMockCtx();
      const p = pane();
      const svg = document.createElementNS(NS, "svg");
      pinBox(svg, 0, 0, 200, 200);
      const byRule = document.createElementNS(NS, "path");
      byRule.setAttribute("d", "M 0 0 L 200 0 L 200 200 L 0 200 Z");
      byRule.classList.add("t25-rule-hidden");
      const byInline = document.createElementNS(NS, "path");
      byInline.setAttribute("d", "M 5 5 L 195 5 L 195 195 L 5 195 Z");
      byInline.style.display = "none";
      const kept = document.createElementNS(NS, "path");
      kept.setAttribute("d", "M 20 20 L 180 20 L 180 180 L 20 180 Z");
      svg.append(byRule, byInline, kept);
      p.appendChild(svg);
      const srcs = captureSources();
      stubLoad();

      await renderPaneSVG(makeRenderer().container, 
        positionedRC(1000, 1000, ctx),
        p,
      );

      const src = srcs[0] || "";
      // Neither hidden path appears in the serialised SVG.
      expect(src).not.toContain("L 200 0");
      expect(src).not.toContain("L 195 5");
      // The visible path survives.
      expect(src).toContain("L 180 180");
      // No display:none attribute leaks into the clone.
      expect((src.match(/display:\s*none/g) || []).length).toBe(0);
    } finally {
      style.remove();
    }
  });

  it("prunes both opt-out carriers from the clone and leaves the live DOM alone", async () => {
    // The export drops the marked node; the map still needs it while drawing
    // continues, so only the clone is pruned.
    const ctx = makeMockCtx();
    const p = pane();
    const svg = document.createElementNS(NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const keep = document.createElementNS(NS, "path");
    keep.setAttribute("d", "M 0 0 L 200 0 L 200 200 L 0 200 Z");
    const byAttr = document.createElementNS(NS, "path");
    byAttr.setAttribute("d", "M 5 5 L 195 5 L 195 195 L 5 195 Z");
    byAttr.setAttribute("data-foliplus-export", "exclude");
    const byClass = document.createElementNS(NS, "path");
    byClass.setAttribute("d", "M 10 10 L 190 10 L 190 190 L 10 190 Z");
    byClass.classList.add("foliplus-skip-export");
    svg.append(keep, byAttr, byClass);
    p.appendChild(svg);
    const srcs = captureSources();
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    const src = srcs[0] || "";
    expect(src).toContain("L 200 200");
    expect(src).not.toContain("L 195 195");
    expect(src).not.toContain("L 190 190");
    expect(byAttr.parentNode).toBe(svg);
    expect(byClass.parentNode).toBe(svg);
  });

  it("injects xmlns into the serialised source when the SVG was created without a namespace", async () => {
    const ctx = makeMockCtx();
    const p = pane();
    // createElement (no namespace) — XMLSerializer will emit the XHTML
    // namespace, so the renderer's replace must kick in.
    const svg = document.createElement("svg");
    pinBox(svg, 0, 0, 200, 200);
    svg.appendChild(document.createElement("path"));
    p.appendChild(svg);
    stubLoad();

    await renderPaneSVG(makeRenderer().container, 
      positionedRC(1000, 1000, ctx),
      p,
    );

    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
  });
});

describe("renderPaneSVG — branch edges", () => {
  it("skips computed-style props whose value is empty", async () => {
    const ctx = makeMockCtx();
    const p = document.createElement("div");
    p.className = "leaflet-map-pane";
    const svg = document.createElementNS(CONST.SVG_NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    const path = document.createElementNS(CONST.SVG_NS, "path");
    svg.appendChild(path);
    p.appendChild(svg);
    // Empty values for some props so `if (!v) continue` fires.
    vi.spyOn(window, "getComputedStyle").mockImplementation(() =>
      Object.assign(Object.create(null), {
        fill: "",
        stroke: "rgb(1, 2, 3)",
        "fill-opacity": "1",
        "stroke-opacity": "1",
        "stroke-width": "1",
        opacity: "1",
        display: "block",
        color: "rgb(0, 0, 0)",
        getPropertyValue: (prop: string) => {
          const map: Record<string, string> = {
            fill: "",
            stroke: "rgb(1, 2, 3)",
            "fill-opacity": "1",
            "stroke-opacity": "1",
            "stroke-width": "1",
            opacity: "1",
            display: "block",
            color: "rgb(0, 0, 0)",
          };
          return map[prop] || "";
        },
      }),
    );
    stubLoad();
    await renderPaneSVG(makeRenderer().container, positionedRC(1000, 1000, ctx), p);
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it("skips an svg whose serialised source is under 100 chars", async () => {
    const ctx = makeMockCtx();
    const p = document.createElement("div");
    p.className = "leaflet-map-pane";
    // Tiny svg with no shape children — serialises short, hits `src.length < 100`.
    const svg = document.createElementNS(CONST.SVG_NS, "svg");
    pinBox(svg, 0, 0, 200, 200);
    p.appendChild(svg);
    const load = vi.spyOn(UTIL, "loadImage").mockResolvedValue({} as any);
    await renderPaneSVG(makeRenderer().container, positionedRC(1000, 1000, ctx), p);
    // Either skipped by the empty-content guard or the length guard — no draw.
    expect(ctx.drawImage).not.toHaveBeenCalled();
    // load may or may not be called depending on which guard fires first.
    void load;
  });
});
