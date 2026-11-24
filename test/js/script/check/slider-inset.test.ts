// Guard: the slider's half-thumb offset is a single token.
//
// The track and the dot-centred end labels both inset by half a thumb
// (--foliplus-slider-inset). A bare calc(var(--foliplus-slider-thumb-size) / 2)
// anywhere in slider.css is a second coordinate space that drifts when the
// thumb size is edited — the exact 7px misalignment the slider refactor
// removed. This guard fails the build when a bare half-thumb calc reappears.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SLIDER_CSS = join(REPO_ROOT, "foliplus", "css", "common", "slider.css");
const BARE_HALF_THUMB = /calc\(var\(--foliplus-slider-thumb-size\) \/ 2\)/;

/** The bare half-thumb calc pattern (the offset this guard owns). */
const findBareHalfThumb = (css: string): number[] => {
  const lines = css.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (BARE_HALF_THUMB.test(line)) hits.push(i + 1);
  });
  return hits;
};

describe("slider half-thumb inset single source", () => {
  it("the real slider.css never spells the bare half-thumb calc", () => {
    const css = require("node:fs").readFileSync(SLIDER_CSS, "utf8");
    const hits = findBareHalfThumb(css);
    expect(hits).toEqual([]);
  });

  it("flags a bare half-thumb calc offset (the drift this guard owns)", () => {
    const dir = mkdtempSync(join(tmpdir(), "slider-inset-"));
    mkdirSync(join(dir, "foliplus", "css", "common"), { recursive: true });
    const css = `.foliplus-slider-value-min:not(.is-clamp) {
  inset-inline-start: calc(var(--foliplus-slider-thumb-size) / 2);
  transform: translateX(-50%);
}`;
    writeFileSync(join(dir, "foliplus", "css", "common", "slider.css"), css);
    const hits = findBareHalfThumb(css);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0]).toBe(2);
  });
});
