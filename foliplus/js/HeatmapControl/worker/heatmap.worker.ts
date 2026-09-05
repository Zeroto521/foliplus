// HeatmapControl aggregation worker — bundles the pure aggregation module plus
// its own h3 build (see h3-asm.js) so it needs no DOM, no CDN script tag and no
// ``window.foliplus`` namespace.
//
// Emitted as ``foliplus/dist/foliplus-HeatmapControl.worker.min.js``.  The
// component reads the file's text and hands it to ``new Worker`` via a blob
// URL (BaseControl.py inlines every foliplus bundle into the HTML, so there is
// no same-origin URL to point ``new Worker`` at directly).
import { aggregate } from "./aggregate.js";
import { h3 } from "./h3-asm.js";
import type { AggregateMessage, AggregateResult } from "./types.js";

const onMessage: (e: MessageEvent<AggregateMessage>) => void = e => {
  let result: AggregateResult;
  try {
    result = { seq: e.data.seq, feature: aggregate(e.data, h3) };
  } catch (err) {
    // A bad cell / bad point must not kill the worker — the manager retries
    // the whole pass on the main thread when the reply arrives invalid.
    result = { seq: e.data.seq, feature: [] };
    if (typeof console !== "undefined") console.warn("foliplus heatmap worker:", err);
  }
  postMessage(result);
};

// `onmessage` is the assignment form (not addEventListener) so a minified
// single-expression bundle stays allocation-free.
self.onmessage = onMessage;
