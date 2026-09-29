/**
 * The shared esbuild config for every artifact build.mjs emits.
 *
 * Factored out of build.mjs so a test can import the real thing instead of
 * hand-copying the same flags — a hand-copied copy silently disagrees the
 * first time the build changes (a target bump, a keepNames flip) without
 * the test ever noticing. `script/build.mjs` calls this once with the
 * resolved args; tests call it with the settings they want to inspect.
 *
 * Plugins are part of the config (postcss for CSS, sourceTransform for
 * inline SVG/HTML, globalNamespace for the shared-runtime bundle). A test
 * that only wants the minifier's behavior should read the scalar fields
 * (`minify`, `format`, `keepNames`, `sourcemap`, `allowOverwrite`) and
 * skip `plugins` — they are JS functions and don't serialize to CLI flags.
 *
 * Path aliases and `srcDir` come from `script/build-paths.mjs` — the one
 * spelling shared with vitest and the build scripts. No esbuild `target`
 * is set (see that module); adding one would change emitted JS.
 */
import autoprefixer from "autoprefixer";
import { readFileSync } from "fs";
import postcss from "postcss";
import postcssNesting from "postcss-nesting";
import { pathAliases, resolveJsRoot } from "./build-paths.mjs";
import { createSourceTransformPlugin } from "./source-transform-plugin.mjs";
import { resolveVersion } from "./version.mjs";

/**
 * Build the esbuild config for a given mode. `dev` toggles minification and
 * identifier preservation (Python render-string tests rely on `keepNames`
 * finding `foliplus.showHint` etc. in unminified bundles). `root` is the
 * project root the source tree lives under.
 */
const esbuildCfgFor = ({ dev, root }) => {
  const srcDir = resolveJsRoot(root);
  const version = resolveVersion();

  // CSS sources are authored in nested syntax (CSS Nesting) and compiled to
  // flat selectors for maximum browser compatibility, then vendor-prefixed
  // via Autoprefixer (driven by the `browserslist` key in package.json).
  // `edition: '2021'` emits fully-flattened selectors (no `:is()` wrapper),
  // keeping specificity identical to hand-written flat CSS.
  const postcssProcessor = postcss([
    postcssNesting({ edition: "2021" }),
    autoprefixer(),
  ]);
  const postcssPlugin = {
    name: "postcss",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async args => {
        const source = readFileSync(args.path, "utf-8");
        const result = await postcssProcessor.process(source, { from: args.path });
        return { contents: result.css, loader: "css" };
      });
    },
  };

  return {
    bundle: true,
    format: "iife",
    minify: !dev,
    // Sourcemaps are only useful when debugging the minified bundle in a
    // browser. foliplus bundles are embedded in Python-generated HTML and
    // shipped to end users, so production sourcemaps have no consumer.
    sourcemap: false,
    allowOverwrite: true,
    keepNames: dev,
    alias: pathAliases(root),
    // Same `git describe` value as the artifact banner, inlined for the
    // runtime console log (`[foliplus] foliplus@…`).
    define: {
      __FOLIPLUS_VERSION__: JSON.stringify(version),
    },
    plugins: [postcssPlugin, createSourceTransformPlugin(srcDir)],
  };
};

export { esbuildCfgFor };
