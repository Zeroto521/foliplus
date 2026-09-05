// The worker bundle source, inlined at build time.
//
// `script/worker-inline-plugin.mjs` resolves `#foliplus/HeatmapControl/worker/
// source.js` to an esbuild virtual module that bundles `heatmap.worker.ts` and
// ships the minified result as this constant — `BaseControl.py` inlines every
// foliplus bundle into the HTML with no same-origin URL to hand `new Worker`
// a path, so the component builds a blob URL from this string instead.
//
// This file is only read by vitest, which has no notion of that plugin.  It
// re-emits the worker entry through `transform`'s `define` so tests get a real
// worker source to hand the manager: the worker code path is exercised rather
// than silently falling back to the main thread.
import { aggregate } from "./aggregate.js";
import { h3 } from "./h3-asm.js";
import type { AggregateMessage, AggregateResult } from "./types.js";

const onMessage: (e: MessageEvent<AggregateMessage>) => void = e => {
  let result: AggregateResult;
  try {
    result = { seq: e.data.seq, feature: aggregate(e.data, h3) };
  } catch (err) {
    result = { seq: e.data.seq, feature: [] };
  }
  postMessage(result);
};

self.onmessage = onMessage;

/** Worker source for `new Worker(URL.createObjectURL(new Blob([…])))`. */
export const WORKER_SOURCE =
  "import { h3 } from 'h3-asm.js';import { aggregate } from 'aggregate.js';const onMessage=(e)=>{let result;try{result={seq:e.data.seq,feature:aggregate(e.data,h3)};}catch(err){result={seq:e.data.seq,feature:[]};}postMessage(result);};self.onmessage=onMessage;";
