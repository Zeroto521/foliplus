// The type of `document.exitFullscreen`. Used to prove the native API is
// still callable at load time — the precondition that makes a snapshot
// read take the native branch.
() => typeof document.exitFullscreen;
