// True while the zoom-in button carries the `foliplus-hidden` marker.
// Used both as a `wait_for_function` predicate and a one-shot `page.evaluate`
// read, so the source stays shared.
() => document.querySelector(".foliplus-zoom-in").classList.contains("foliplus-hidden");
