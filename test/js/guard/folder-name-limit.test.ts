// Cross-stack guard: the JS FOLDER_NAME_MAX (core/layer/folderView.ts) and
// the Python upper bound (foliplus/_declaration/key.py, read by normalise_folder)
// are two independent literals. If either side changes alone, Python accepts a
// folder name the JS reader rejects (or the reverse) and the user sees
// "declared but the panel never shows it". This guard pins the two together
// at CI time instead of relying on a human noticing the drift.
//
// The JS value is read through the #core/layer barrel (which re-exports the
// owning module's single-source constant); the Python value is read from the
// source literal the way the other cross-stack checks read Python source
// (readFileSync + one anchored regex), so a missing or malformed constant
// fails loudly rather than silently.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FOLDER_NAME_MAX } from "#core/layer/index.js";

const PY_DECLARATION = resolve(process.cwd(), "foliplus", "_declaration", "key.py");
const PY_CONST_RE = /^FOLDER_NAME_MAX\s*=\s*(\d+)\s*$/m;

describe("FOLDER_NAME_MAX stays in lockstep across the stack", () => {
  it("Python FOLDER_NAME_MAX equals the JS constant", () => {
    const py = readFileSync(PY_DECLARATION, "utf-8");
    const m = py.match(PY_CONST_RE);
    expect(m).not.toBeNull();
    const pyValue = Number(m![1]);
    expect(
      pyValue,
      `JS FOLDER_NAME_MAX = ${FOLDER_NAME_MAX}; Python FOLDER_NAME_MAX = ${pyValue}`,
    ).toBe(FOLDER_NAME_MAX);
  });
});
