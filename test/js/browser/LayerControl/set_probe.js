// Driver for the *_probe pattern: the JS snippet that immediately follows
// reads `window.__probe` for its mode spec, and clears it as it consumes.
// Passes the spec from Python — no string interpolation on the test side.
spec => {
  window.__probe = spec;
};
