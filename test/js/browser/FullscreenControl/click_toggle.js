// Click the fullscreen toggle via a synthesized event. Used for the exit
// path: while fullscreen and `hide_self=true`, the button is not
// `pointer-events: auto`, so Playwright's `page.click` cannot reach it.
document.querySelector(".foliplus-fullscreen-toggle").click();
