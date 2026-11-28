// test/js/guard/order-vocabulary - the order-domain vocabulary is single-sourced
// in core/layer/order/kind.ts (ORDER_KIND, NODE_KEY_PREFIX) and core/layer/const.ts
// (ROLE). A bare "layer" / "folder" / "group" / "overlay" / "base" literal or a
// hand-concatenated "layer:"-style prefix anywhere in the order engine or the
// layout adapter is a drift risk: a new kind added to the constants would not
// touch the literal sites. This guard flags them.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "foliplus/js/core/layer");
const SCAN_DIRS = ["order", "layout"];
const ALLOW_FILES = new Set(["layer/order/kind.ts", "layer/const.ts"]);

const listTs = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
};

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const VOCAB = ["layer", "folder", "group", "overlay", "base"];
const PREFIXES = ["layer:", "folder:", "group:"];

const QUOTE_CLASS = '["\x27\x60]';

describe("order-vocabulary guard", () => {
  const violations: string[] = [];
  let fileCount = 0;
  for (const dir of SCAN_DIRS) {
    for (const file of listTs(join(ROOT, dir))) {
      fileCount += 1;
      const rel = relative(join(ROOT, ".."), file).replace(/\\/g, "/");
      if (ALLOW_FILES.has(rel)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        for (const word of VOCAB) {
          const q = new RegExp(QUOTE_CLASS + word + QUOTE_CLASS);
          if (q.test(line))
            violations.push(rel + ":" + (i + 1) + ': bare "' + word + '" literal');
        }
        for (const prefix of PREFIXES) {
          if (
            line.includes(String.fromCharCode(96) + prefix) ||
            line.includes('"' + prefix + '"') ||
            line.includes("\x27" + prefix + "\x27")
          ) {
            violations.push(
              rel + ":" + (i + 1) + ': hand-concatenated "' + prefix + '" prefix',
            );
          }
        }
      });
    }
  }

  it("no bare order-vocabulary literal or hand-made prefix in the engine/layout", () => {
    expect(fileCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
