// Read warnings recorded during setup (e.g. a duplicate overlay id), so the
// test can assert none of them fired.
() => window.__setupWarns || [];
