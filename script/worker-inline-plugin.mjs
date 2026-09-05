#!/usr/bin/env node
/**
 * Build plugin that bundles the HeatmapControl worker and inlines it into the
 * component bundle as a minified JS string.
 *
 * Why a string: ``BaseControl.py`` inlines every foliplus bundle into the HTML
 * with no same-origin URL available, so the component cannot point
 * ``new Worker`` at a path.  It builds a Blob URL from this string instead.
 *
 * The worker is compiled twice: once to a standalone minified artifact
 * (``foliplus-HeatmapControl.worker.min.js``, shipped in the sdist) and once
 * through esbuild's ``build`` with ``write: false`` to shrink the copy embedded
 * in the component.  Both come from the same source, so they cannot drift.
 */
import { readFileSync } from "fs";
import { basename, resolve } from "path";
import { transformSource } from "./compress.mjs";

/**
 * @param {string} srcDir  Root of the ``foliplus/js`` source tree.
 * @param {string} distDir Root of the ``foliplus/dist`` output tree.
 * @param {object} opts    ``{ dev?: boolean }`` — dev keeps the worker readable.
 */
// onEnd fires once per artifact; the JS and CSS builds of a component share a
// plugin instance, so the worker artifact must be emitted (and logged) only once.
// A module-level set survives the per-build `setup` closures.
const emittedArtifacts = new Set();

const makeWorkerInlinePlugin = (srcDir, distDir, opts = {}) => {
  const workerEntry = resolve(srcDir, "HeatmapControl/worker/heatmap.worker.ts");
  const outName = "foliplus-HeatmapControl.worker.min.js";

  // Build the worker: self-contained (own h3 build), no shared-module
  // externalization — a worker has no ``window.foliplus`` to read from.
  const workerBuild = async writeOut => {
    const cfg = {
      entryPoints: [workerEntry],
      bundle: true,
      format: "iife",
      treeShaking: true,
      minify: true,
      keepNames: false,
      sourcemap: false,
      logLevel: "silent",
      write: false,
      plugins: [
        {
          name: "worker-source-transform",
          setup(b) {
            b.onLoad({ filter: /\.(ts|js)$/ }, async args => {
              if (!args.path.startsWith(srcDir + "/") || args.path.endsWith(".d.ts"))
                return null;
              return {
                contents: transformSource(readFileSync(args.path, "utf-8")),
                loader: "ts",
              };
            });
          },
        },
      ],
    };
    if (writeOut) {
      cfg.outfile = resolve(distDir, outName);
      cfg.write = true;
      cfg.minify = !opts.dev;
      cfg.keepNames = opts.dev;
    }
    const result = await (await import("esbuild")).build(cfg);
    if (result.errors.length)
      throw new Error(
        `worker build failed: ${result.errors.map(e => e.text).join("; ")}`,
      );
    return writeOut ? null : result.outputFiles[0].text;
  };

  return {
    name: "worker-inline",
    setup(build) {
      // ``import { WORKER_SOURCE } from "#foliplus/HeatmapControl/worker/source.js"``
      build.onResolve(
        { filter: /#foliplus\/HeatmapControl\/worker\/source\.js$/ },
        () => ({ path: "worker-source-embedded", namespace: "worker-source" }),
      );
      build.onLoad(
        { filter: /^worker-source-embedded$/, namespace: "worker-source" },
        async () => {
          const code = await workerBuild(false);
          // JSON.stringify escapes every string char (quotes, backticks,
          // newlines, escapes) — a naive `replace` mishandles the worker
          // bundle's own template literals and leaves the literal unterminated.
          return {
            contents: `export const WORKER_SOURCE = ${JSON.stringify(code)};`,
            loader: "ts",
          };
        },
      );

      // Side-effect import that emits the standalone artifact next to the
      // component bundle.  Resolved external so it is not bundled.
      build.onResolve(
        { filter: /#foliplus\/HeatmapControl\/worker\/artifact$/ },
        () => ({ path: "worker-artifact-emit", external: true }),
      );
      build.onEnd(async () => {
        if (emittedArtifacts.has(outName)) return;
        emittedArtifacts.add(outName);
        await workerBuild(true);
        console.log(`  🧩 worker → ${basename(distDir)}/${outName}`);
      });
    },
  };
};

export { makeWorkerInlinePlugin };
