/**
 * esbuild metafile → Codecov Bundle Analysis `OutputPayload` (version "3").
 *
 * Protocol source of truth:
 *   codecov/codecov-javascript-bundler-plugins
 *   - packages/bundler-plugin-core/src/types.ts        (OutputPayload)
 *   - packages/rollup-plugin/.../rollupBundleAnalysisPlugin.ts (shape of
 *     assets / chunks / modules as the official plugins emit them)
 *
 * Size units — deliberate, not interchangeable with the dual gates:
 *   assets.size     = raw output bytes (metafile `outputs[].bytes`)
 *   assets.gzipSize = real gzip length of the on-disk artifact (schema field
 *                     is gzip; never brotli, never a relabeled raw size)
 *   modules.size    = `bytesInOutput` (rendered contribution to the artifact)
 *
 * `inputs[].imports` edges are dropped on purpose: OutputPayload has no
 * dependency-edge field. Do not invent one — if the UI later needs edges,
 * that is a schema change upstream, not a local extension.
 */
import { readFileSync } from "fs";
import { basename, isAbsolute, relative, resolve, sep } from "path";
import { gzipSync } from "zlib";

/** Codecov `bundleName` pattern (from bundler-plugin-core normalizeOptions). */
const BUNDLE_NAME_RE = /^[\w\d_:/@\.{}\[\]$-]+$/;

const PAYLOAD_VERSION = "3";

const PLUGIN = {
  name: "foliplus-codecov-bundle-adapter",
  version: "0.1.0",
};

const COMPRESSIBLE_RE = /\.(?:css|html|json|js|svg|txt|xml|xhtml)$/;

/** Default gzip meter: real `zlib.gzip` over the file bytes. */
const gzipSizeOfFile = filePath => gzipSync(readFileSync(filePath)).length;

/**
 * Module path as the Codecov UI shows it: project-relative, POSIX separators,
 * `./`-prefixed when inside the tree (rollup-plugin convention). Absolute
 * inputs outside the root keep their path — same escape hatch as the official
 * plugin (`../` stays unprefixed).
 */
const normalizeModulePath = (modulePath, root) => {
  const abs = isAbsolute(modulePath) ? modulePath : resolve(root, modulePath);
  const rel = relative(root, abs);
  const posix = rel.split(sep).join("/");
  if (posix.startsWith("..")) return posix;
  return `./${posix}`;
};

/** Output filename only — assets[].name is a bare name in the official plugins. */
const assetName = outputPath => basename(outputPath);

/** Chunk id from the artifact filename (`foliplus-LayerControl.min.js` → `LayerControl`). */
const chunkIdFromOutput = outputPath => {
  const base = basename(outputPath);
  return base.replace(/\.min\.(js|css)$/, "").replace(/^foliplus-/, "");
};

/**
 * Shippable outputs: everything except source maps. Official plugins keep
 * images/fonts too (gzipSize null for those); foliplus dist is js/css today
 * but the filter must not silently drop a future asset.
 */
const isShippableOutput = outputPath => !outputPath.endsWith(".map");

/**
 * Build one Codecov OutputPayload from a merged esbuild metafile.
 *
 * @param {object} args
 * @param {object} args.metafile  merged esbuild metafile ({inputs, outputs})
 * @param {string} args.root      project root used to resolve paths / gzip files
 * @param {string} [args.bundleName]
 * @param {(absPath: string) => number} [args.gzipOf] injectable meter (tests)
 * @param {() => number} [args.now] injectable clock (tests)
 */
const buildCodecovPayload = ({
  metafile,
  root,
  bundleName = "foliplus",
  gzipOf = gzipSizeOfFile,
  now = () => Date.now(),
}) => {
  if (!BUNDLE_NAME_RE.test(bundleName)) {
    throw new Error(
      `bundleName \`${bundleName}\` does not match BUNDLE_NAME_RE (see codecov-bundle-report.mjs)`,
    );
  }
  if (!metafile?.outputs || typeof metafile.outputs !== "object") {
    throw new Error("metafile.outputs is required");
  }

  const builtAt = now();
  const assets = [];
  const chunks = [];
  /** module name → { name, size, chunkUniqueIds: Set } */
  const moduleMap = new Map();

  const outputKeys = Object.keys(metafile.outputs).filter(isShippableOutput).sort();

  outputKeys.forEach((outputKey, index) => {
    const output = metafile.outputs[outputKey];
    const absOut = isAbsolute(outputKey) ? outputKey : resolve(root, outputKey);
    const name = assetName(outputKey);
    const id = chunkIdFromOutput(outputKey);
    const uniqueId = `${index}-${id}`;

    // gzipSize is measured from the built file, not derived from metafile
    // numbers — the schema field is a compressed size and must look like one.
    const compressible = COMPRESSIBLE_RE.test(name);
    let gzipSize = null;
    if (compressible) {
      gzipSize = gzipOf(absOut);
    }

    assets.push({
      name,
      size: output.bytes ?? 0,
      gzipSize,
      // foliplus artifact names carry no content hash; keep the name as-is
      // so a later rename (if any) is a visible diff in the Codecov UI.
      normalized: name,
    });

    chunks.push({
      id,
      uniqueId,
      entry: Boolean(output.entryPoint),
      // No code-splitting in this pipeline: every emitted artifact is an
      // initial load unit for its control.
      initial: true,
      names: [id],
      files: [name],
      dynamicImports: [],
    });

    for (const [modulePath, contribution] of Object.entries(output.inputs ?? {})) {
      const modName = normalizeModulePath(modulePath, root);
      let entry = moduleMap.get(modName);
      if (!entry) {
        entry = { name: modName, size: 0, chunkUniqueIds: new Set() };
        moduleMap.set(modName, entry);
      }
      entry.size += contribution.bytesInOutput ?? 0;
      entry.chunkUniqueIds.add(uniqueId);
    }
  });

  const modules = [...moduleMap.values()]
    .map(m => ({
      name: m.name,
      size: m.size,
      chunkUniqueIds: [...m.chunkUniqueIds].sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    version: PAYLOAD_VERSION,
    builtAt,
    duration: 0,
    bundleName,
    bundler: { name: "esbuild", version: "0.24.0" },
    plugin: { ...PLUGIN },
    assets,
    chunks,
    modules,
  };
};

/** Serialize the payload the way the official plugins PUT it (no pretty-print). */
const payloadToJson = payload => JSON.stringify(payload);

export {
  BUNDLE_NAME_RE,
  PAYLOAD_VERSION,
  buildCodecovPayload,
  chunkIdFromOutput,
  gzipSizeOfFile,
  normalizeModulePath,
  payloadToJson,
};
