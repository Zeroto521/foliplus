// Source-transform plugin tests.
//
// The onLoad guard decides whether the SVG/HTML source transforms run. It is
// exactly where the Windows separator bug lived (a hardcoded "/" prefix on a
// `path.resolve()`-based dir never matched a backslash path, so every Windows
// build silently skipped the transforms), so the guard gets a regression net
// of its own: `isSourceFile` pins the normalisation with backslash paths on
// every platform, and the plugin is exercised end-to-end against a temp
// source dir with a real file (no fs/esbuild mocking needed).
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createSourceTransformPlugin,
  isSourceFile,
} from "#script/source-transform-plugin.mjs";

// A platform-neutral fake source dir: the guard must only ever compare
// normalized path strings, never touch the real tree.
const FAKE_SRC = "/repo/foliplus/js";

describe("isSourceFile", () => {
  it("accepts a forward-slash path inside the source dir", () => {
    expect(isSourceFile(FAKE_SRC, `${FAKE_SRC}/LayerControl/icon.ts`)).toBe(true);
  });

  it("accepts a backslash path inside the source dir", () => {
    const winDir = FAKE_SRC.replaceAll("/", "\\");
    expect(isSourceFile(FAKE_SRC, `${winDir}\\LayerControl\\icon.ts`)).toBe(true);
  });

  it("rejects a sibling dir whose name merely starts like the source dir", () => {
    expect(isSourceFile(FAKE_SRC, `${FAKE_SRC}-outside\\index.ts`)).toBe(false);
  });

  it("rejects an unrelated path", () => {
    expect(isSourceFile(FAKE_SRC, "C:\\node_modules\\pkg\\index.ts")).toBe(false);
  });
});

describe("createSourceTransformPlugin", () => {
  // A real temp source dir: the transform actually reads the file, so the
  // "transform ran" signal is the compressed output (polyline → <path>).
  const dir = mkdtempSync(join(tmpdir(), "foliplus-src-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // Wire the plugin to a minimal mock `build`, capturing its onLoad callback.
  const setupPlugin = () => {
    const handlers: {
      onLoad?: (args: { path: string }) => Promise<unknown> | unknown;
    } = {};
    createSourceTransformPlugin(dir).setup({
      onLoad: (
        _opts: { filter: RegExp },
        cb: (args: { path: string }) => Promise<unknown> | unknown,
      ) => {
        handlers.onLoad = cb;
      },
    } as never);
    return handlers;
  };

  it("runs the transform for a path inside the source dir", async () => {
    writeFileSync(
      join(dir, "icon.ts"),
      'const FOLD = `<svg viewBox="0 0 24 24">' +
        '<polyline points="18 15 12 9 6 15"/></svg>`;',
      "utf-8",
    );
    const { onLoad } = setupPlugin();
    const result = await onLoad!({ path: join(dir, "icon.ts") });
    expect(result).not.toBeNull();
    const contents = String((result as { contents: string }).contents);
    expect(contents).not.toContain("polyline");
    expect(contents).toContain("<path");
  });

  it("skips paths outside the source dir", async () => {
    const { onLoad } = setupPlugin();
    expect(await onLoad!({ path: join(dir, "..", "other", "index.ts") })).toBeNull();
  });

  it("skips type-declaration files inside the source dir", async () => {
    const { onLoad } = setupPlugin();
    // The d.ts guard sits after the path guard, so the path must pass the
    // prefix check and then be rejected before any read.
    expect(await onLoad!({ path: join(dir, "icon.d.ts") })).toBeNull();
  });
});
