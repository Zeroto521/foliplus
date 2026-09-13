// Shared rate-limit queue — serialize async work behind a minimum interval
// between requests. Nominatim enforces 1 request/second globally, so every
// geocode call path (the geocoder singleton, future providers) shares this
// one definition. Tasks are strictly serialized: the next task does not
// start until the previous one has settled.
const createThrottleQueue = (minIntervalMs: number) => {
  let lastReq = 0;
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    chain = chain.then(() => {
      const wait = Math.max(0, minIntervalMs - (Date.now() - lastReq));
      return new Promise(r => setTimeout(r, wait));
    });
    const run = chain.then(() => {
      lastReq = Date.now();
      return fn();
    });
    // Track settlement (not just the delay) so an in-flight request is never
    // overlapped by the next one — Nominatim's limit is a hard 1 request/s.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
};

export { createThrottleQueue };
