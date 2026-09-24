import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Reverse gate: ExportControl must not reference LayerControl's internal
// identifiers. The export background is read from the map container's
// computed `backgroundColor` — a public DOM surface — so ExportControl stays
// decoupled from any particular component's state. A regression that reaches
// for `COLOR_ITEM`, `--color-layer-bg`, or `ui.currentColor` to get the
// basemap colour would couple the two components and make the export wrong
// whenever the colour lives on the container for a different reason.
//
// The gate is a source scan, not a runtime check: it pins the "genericity"
// invariant at authoring time, before the bundle even builds.
const ROOT = resolve(".");

const exportSources = () =>
  globSync({
    cwd: ROOT,
    patterns: ["foliplus/js/ExportControl/**/*.ts"],
    ignore: ["**/*.d.ts"],
  }).sort();

// Identifiers owned by LayerControl's solid-color basemap implementation.
// ExportControl must not import, reference, or even mention them: the
// container's computed backgroundColor is the one route it is allowed to
// take.
const FORBIDDEN = [
  "COLOR_ITEM",
  "COLOR_INPUT",
  "currentColor",
  "showColorLayer",
  "hideColorLayer",
  "colorLayer",
  "--color-layer-bg",
];

describe("ExportControl ↔ LayerControl decoupling", () => {
  it("ExportControl source is non-empty (the gate is not vacuous)", () => {
    expect(exportSources().length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)("does not reference %s in any ExportControl source file", id => {
    const hits: string[] = [];
    for (const rel of exportSources()) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      if (src.includes(id)) hits.push(rel);
    }
    expect(
      hits,
      `ExportControl references LayerControl-internal "${id}" — the ` +
        `export background must come from the map container's computed ` +
        `backgroundColor, not from LayerControl state`,
    ).toEqual([]);
  });
});
