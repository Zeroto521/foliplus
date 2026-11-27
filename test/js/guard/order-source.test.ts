// test/js/guard/order-source - guard that the layer-order document model
// (sections 4-7 of the layer-order design note) is the single source of
// panel order / map z / panel blocks in production code. Three legacy
// representations must not return: the v2 folder layout (layer_layout /
// FOLDER_LAYOUT_VERSION / roleBlocks), the saved flat id list
// (layer_state.order / LayerOrder / savedOrder), and the one-way delete set
// (layer_state.removed / removedIds). No code may mutate the registry to
// change order (LayerInfoRegistry.reorder is deleted), a projection must not
// drop nested children with a kind==="layer" filter, and the move/drag path
// must route through the single applyDoc entry, never a legacy apply.
//
// Identifiers are matched as whole words on comment/string-stripped code, so
// prose and C§-class strings cannot false-positive. layer_layout is a
// localStorage key (a string literal), so it is scanned on raw source -
// stripping strings would hide it. Names that merely resemble the legacy
// tokens are deliberately NOT forbidden: forgetSavedOrder (kept public API,
// section 13), RECORD_VERSION (layer_state, unrelated to layout), jsonv2 (nominatim
// format string) and SVG path v instructions are not version numbers.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const JS_ROOT = join(process.cwd(), "foliplus", "js");
const EXEMPT_DIRS = new Set(["node_modules", "dist", "coverage", ".agents"]);

// Legacy layer-order identifiers that must not appear in production code.
const FORBIDDEN_IDENTIFIERS: { token: string; why: string }[] = [
  {
    token: "FOLDER_LAYOUT_VERSION",
    why: "legacy versioned folder-layout record (section 8)",
  },
  { token: "savedOrder", why: "layer_state.order flat id list (section 8)" },
  { token: "removedIds", why: "layer_state.removed one-way delete set (section 8)" },
  { token: "LayerOrder", why: "legacy saved-order class (section 6)" },
  { token: "roleBlocks", why: "legacy folder-layout block projection (section 6)" },
];

// localStorage keys that must not be referenced (they are string literals).
const FORBIDDEN_STORAGE_KEYS: { token: string; why: string }[] = [
  { token: "layer_layout", why: "legacy v2 folder-layout storage key (section 8)" },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXEMPT_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/.ts$/.test(entry.name) || /.js$/.test(entry.name)) yield full;
  }
}

// Manual scanner: replace comments and string literals with spaces so only
// identifiers remain. No regex, so the guard cannot be fooled by a string that
// merely mentions a forbidden name (C§ classes, prose, format strings).
function strip(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      blank(i, Math.min(n, j + 2));
      i = Math.min(n, j + 2);
    } else if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === q) break;
        j += 1;
      }
      blank(i, Math.min(n, j + 1));
      i = Math.min(n, j + 1);
    } else if (ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "`") break;
        j += 1;
      }
      blank(i, Math.min(n, j + 1));
      i = Math.min(n, j + 1);
    } else {
      i += 1;
    }
  }
  return out.join("");
}

// Comment-only stripper: removes comments but KEEPS string literals visible.
// Used for the kind-filter check, which must see the "layer" literal.
function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
    } else if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      blank(i, Math.min(n, j + 2));
      i = Math.min(n, j + 2);
    } else {
      i += 1;
    }
  }
  return out.join("");
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

// Count whole-word occurrences of `token` in stripped code.
function countWord(code: string, token: string): number {
  let count = 0;
  let from = 0;
  while (from < code.length) {
    const idx = code.indexOf(token, from);
    if (idx < 0) break;
    const before = idx > 0 ? code[idx - 1] : "";
    const after = idx + token.length < code.length ? code[idx + token.length] : "";
    if (
      (before === "" || !isWordChar(before)) &&
      (after === "" || !isWordChar(after))
    ) {
      count += 1;
    }
    from = idx + token.length;
  }
  return count;
}

// Extract one function body from stripped code (brace counting). "" if absent.
function functionBody(code: string, name: string): string {
  const start = code.indexOf(`${name}(`);
  if (start < 0) return "";
  let i = code.indexOf("{", start);
  if (i < 0) return "";
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return code.slice(start);
}

describe("order-source guard: one document model for order/z/blocks", () => {
  it("forbids legacy layer-order identifiers in production code", () => {
    const files = [...walk(JS_ROOT)];
    const hits: string[] = [];
    for (const file of files) {
      const code = strip(readFileSync(file, "utf-8"));
      for (const { token, why } of FORBIDDEN_IDENTIFIERS) {
        const count = countWord(code, token);
        if (count > 0) {
          hits.push(`${relative(JS_ROOT, file)}: ${token} x${count} (${why})`);
        }
      }
    }
    expect(
      hits,
      `legacy layer-order identifiers must be gone:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });

  it("forbids legacy localStorage keys in production code", () => {
    const files = [...walk(JS_ROOT)];
    const hits: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf-8");
      for (const { token, why } of FORBIDDEN_STORAGE_KEYS) {
        const count = countWord(raw, token);
        if (count > 0) {
          hits.push(`${relative(JS_ROOT, file)}: ${token} x${count} (${why})`);
        }
      }
    }
    expect(
      hits,
      `legacy localStorage keys must be gone:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });

  it("forbids registry reorder mutations", () => {
    const files = [...walk(JS_ROOT)];
    const hits: string[] = [];
    for (const file of files) {
      const code = strip(readFileSync(file, "utf-8"));
      const re = "reorder";
      let count = 0;
      let from = 0;
      while (from < code.length) {
        const idx = code.indexOf(`${re}(`, from);
        if (idx < 0) break;
        const before = idx > 0 ? code[idx - 1] : "";
        if (before === "" || !isWordChar(before)) count += 1;
        from = idx + re.length;
      }
      if (count > 0) {
        hits.push(
          `${relative(JS_ROOT, file)}: reorder() x${
            count
          } (section 6: LayerInfoRegistry.reorder is deleted)`,
        );
      }
    }
    expect(
      hits,
      `no code may mutate the registry to change order:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });

  it("forbids kind filter-drops in projections", () => {
    const files = [...walk(JS_ROOT)];
    const hits: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf-8"));
      const call = ".filter(";
      let from = 0;
      let count = 0;
      while (from < code.length) {
        const idx = code.indexOf(call, from);
        if (idx < 0) break;
        const window = code.slice(idx, idx + 160);
        if (
          window.includes("kind") &&
          window.includes("=== ") &&
          window.includes('"layer"')
        ) {
          count += 1;
        }
        from = idx + call.length;
      }
      if (count > 0) {
        hits.push(
          `${relative(JS_ROOT, file)}: kind filter-drop x${
            count
          } (section 6: blocks() is kind-generic)`,
        );
      }
    }
    expect(
      hits,
      `a projection must not drop nested children with a kind filter:\n  ${hits.join(
        "\n  ",
      )}`,
    ).toEqual([]);
  });

  it("keeps legacy order-apply out of the move/drag path", () => {
    const controller = readFileSync(
      join(JS_ROOT, "control", "LayerControl", "controller.ts"),
      "utf-8",
    );
    const code = strip(controller);
    const moveDragFns = [
      "commitReorder",
      "reorderLayer",
      "moveLayerUp",
      "moveLayerDown",
      "bringLayerToFront",
      "moveLayerToFolder",
      "moveLayerToRoot",
      "moveLayerToRootAt",
    ];
    const hits: string[] = [];
    for (const fn of moveDragFns) {
      const body = functionBody(code, fn);
      if (body.length === 0) continue;
      for (const token of [
        "applySavedOrder",
        "orderApplySavedOrder",
        "replaySavedOrder",
      ]) {
        if (body.includes(token)) {
          hits.push(`${fn}: contains ${token}`);
        }
      }
    }
    expect(
      hits,
      `move/drag must go through the single applyDoc entry:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });
});
