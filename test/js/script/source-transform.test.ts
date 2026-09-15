// Source-transform path-guard tests.
//
// The onLoad guard decides whether the SVG/HTML source transforms run. It is
// exactly where the Windows separator bug lived (a hardcoded "/" prefix never
// matched a backslash path, so every Windows build silently skipped the
// transforms), so the guard gets a regression net of its own: a backslash
// path inside the source dir must run the transform, a path outside must not.
import { describe, expect, it, vi } from "vitest";
import { sourceTransformPlugin, srcDir } from "#script/build.mjs";

// build.mjs imports esbuild at the top; its WASM entry trips an environment
// invariant under jsdom ("TextEncoder/instanceof Uint8Array" across realms).
// The mock keeps the module importable — `build` is only invoked inside the
// CLI main(), which never runs under vitest.
vi.mock("esbuild", () => ({ build: () => Promise.resolve({}) }));

// The onLoad reads the file at args.path — the guard test must not touch the
// real tree, so readFileSync is faked to hand back a polyline SVG template
// (the FOLD chevron): if the guard lets the load through, the transform
// compresses it to a <path>, which is the observable "transform ran" signal.
vi.mock("fs", async importOriginal => {
  const actual = (await importOriginal()) as typeof import("fs");
  return {
    ...actual,
    readFileSync: vi.fn(
      (path: Parameters<typeof actual.readFileSync>[0], encoding?: string) => {
        if (String(path).includes("icon.ts") && !String(path).endsWith(".d.ts")) {
          return (
            "const FOLD = `" +
            '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>' +
            "`;"
          );
        }
        return actual.readFileSync(path, encoding as BufferEncoding);
      },
    ),
  };
});

/** Wire the plugin to a minimal mock `build`, capturing its onLoad callback. */
const setupPlugin = () => {
  const handlers: {
    onLoad?: (args: { path: string }) => Promise<unknown> | unknown;
  } = {};
  sourceTransformPlugin.setup({
    onLoad: (
      _opts: { filter: RegExp },
      cb: (args: { path: string }) => Promise<unknown> | unknown,
    ) => {
      handlers.onLoad = cb;
    },
  } as never);
  return handlers;
};

/** srcDir in Windows form — the exact shape that once slipped the guard. */
const winDir = srcDir.replaceAll("/", "\\");

describe("sourceTransformPlugin path guard", () => {
  it("runs the transform for a backslash path inside the source dir", async () => {
    const { onLoad } = setupPlugin();
    const result = await onLoad!({ path: `${winDir}\\LayerControl\\icon.ts` });
    expect(result).not.toBeNull();
    const contents = String((result as { contents: string }).contents);
    expect(contents).not.toContain("polyline");
    expect(contents).toContain("<path");
  });

  it("runs the transform for a forward-slash path inside the source dir", async () => {
    const { onLoad } = setupPlugin();
    const result = await onLoad!({ path: `${srcDir}/LayerControl/icon.ts` });
    expect(result).not.toBeNull();
    expect(String((result as { contents: string }).contents)).not.toContain("polyline");
  });

  it("skips paths outside the source dir", async () => {
    const { onLoad } = setupPlugin();
    // A sibling dir whose name merely starts like the source dir.
    expect(await onLoad!({ path: `${winDir}-outside\\index.ts` })).toBeNull();
    expect(await onLoad!({ path: "C:\\node_modules\\pkg\\index.ts" })).toBeNull();
  });

  it("skips type-declaration files inside the source dir", async () => {
    const { onLoad } = setupPlugin();
    // The d.ts guard sits after the path guard, so a Windows-style path must
    // pass the prefix check and then be rejected before any read.
    expect(await onLoad!({ path: `${winDir}\\LayerControl\\icon.d.ts` })).toBeNull();
  });
});
