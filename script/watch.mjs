#!/usr/bin/env node
/**
 * `--watch` (dev hot-reload) backend for script/build.mjs.
 *
 * This module is intentionally decoupled from build.mjs: it only depends on
 * `esbuild`'s `context` API and a pre-built list of per-artifact option
 * objects (each carrying its own plugins + outfile). This isolates the
 * fragile esbuild 0.24 watch mechanics from the build config / single-run
 * path, so they can evolve independently.
 *
 * esbuild 0.24 specifics handled here:
 *  - `onRebuild` does not exist → per-artifact `onEnd` plugin for status.
 *  - One internal service is shared → contexts created & rebuilt sequentially.
 *  - `watch()` returns a never-resolving promise → forked off the stack so
 *    SIGINT reaches our handler (awaiting it blocks signal delivery).
 */
import { basename } from "path";
import { context } from "esbuild";

/** esbuild plugin that logs success/failure on each rebuild. Because
 *  esbuild 0.24 has no `onRebuild`, `onEnd` (fires after every build,
 *  including watch-triggered rebuilds) is the mechanism. Errors only print
 *  a marker — with logLevel:"error" esbuild already prints the full detail,
 *  so printing e.text here would double-write. Each artifact registers its
 *  own instance so per-artifact status is reported. */
function rebuildLoggerPlugin(outfile) {
  return {
    name: "rebuild-logger",
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length) console.error(`  ✗ ${basename(outfile)}`);
        else console.log(`  ✓ ${basename(outfile)}`);
      });
    },
  };
}

/** Run all artifacts through per-artifact esbuild contexts and watch for
 *  changes. Each context watches its own source tree independently; one
 *  `watch()` per context is reliable in esbuild 0.24. Watch contexts set
 *  logLevel:"error" so esbuild's own output is limited to error detail, and
 *  progress/✓ status is handled by the rebuildLoggerPlugin. */
async function runWatch(entries) {
  // esbuild reuses a single internal service; creating contexts in parallel
  // over-runs it and yields "The service is no longer running" errors.
  // We create them one at a time.
  const contexts = [];
  for (let i = 0; i < entries.length; i++) {
    contexts.push(
      await context({
        ...entries[i],
        plugins: [...entries[i].plugins, rebuildLoggerPlugin(entries[i].outfile)],
        logLevel: "error",
      }),
    );
  }

  const disposeAll = async () => {
    for (const ctx of contexts) await ctx.dispose().catch(() => {});
  };

  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nStopping watcher...");
    disposeAll().then(() => process.exit(0)).catch(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  // One explicit rebuild() per artifact so dist/ outputs exist on first run
  // and errors surface immediately rather than being hidden until the first
  // edit. Done sequentially so the shared service isn't over-run. Per-
  // artifact status is handled by rebuildLoggerPlugin's onEnd — a fatal
  // rebuild() error is the only thing not caught there, so we log that.
  for (let i = 0; i < entries.length; i++) {
    try {
      await contexts[i].rebuild();
    } catch (err) {
      console.error(`  ✗ ${basename(entries[i].outfile)}: ${err.message}`);
    }
  }

  console.log(`Watching for changes (${entries.length} artifacts) — press Ctrl+C to stop.`);
  // watch() returns a never-resolving promise; fork each off the stack so
  // SIGINT reaches the handler. With logLevel:"error" a fatal watch()
  // failure wouldn't surface, so we catch and log it with the artifact name.
  for (let i = 0; i < entries.length; i++) {
    contexts[i].watch().catch(err =>
      console.error(`  ✗ ${basename(entries[i].outfile)}: watch failed: ${err.message}`),
    );
  }
}

export { runWatch };
