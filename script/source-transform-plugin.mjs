// Source-transform esbuild plugin.
//
// Lives outside build.mjs so the path guard is unit-testable without
// importing the build orchestrator (or esbuild, whose WASM entry trips an
// environment invariant under jsdom). build.mjs binds it to the real source
// dir; tests bind it to a temp dir.
import { readFileSync } from "fs";
import { transformSource } from "./compress.mjs";

const normPath = p => p.replaceAll("\\", "/");

/** True when a plugin path lies under the source dir.
 *
 *  esbuild hands plugin paths in the OS-native form (backslashes on
 *  Windows, forward slashes elsewhere), so both sides are normalised to
 *  forward slashes before the prefix check — a hardcoded "/" suffix on a
 *  `path.resolve()`-based dir silently skipped EVERY file on Windows. */
export const isSourceFile = (srcDir, path) =>
  normPath(path).startsWith(normPath(srcDir) + "/");

/** The source-transform plugin, bound to the source dir it guards. */
export const createSourceTransformPlugin = srcDir => ({
  name: "source-transform",
  setup(build) {
    build.onLoad({ filter: /\.(ts|js)$/ }, async args => {
      if (!isSourceFile(srcDir, args.path)) return null;
      if (args.path.endsWith(".d.ts")) return null;
      const source = readFileSync(args.path, "utf-8");
      return { contents: transformSource(source), loader: "ts" };
    });
  },
});
