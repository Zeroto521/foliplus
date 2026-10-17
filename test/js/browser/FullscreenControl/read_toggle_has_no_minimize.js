// True while the toggle's innerHTML does NOT contain the MINIMIZE label.
// The MAXIMIZE state is the initial (not-entered) state; the assertion
// `has_self_hide` on the caller side reads as "still not entered".
document.querySelector(".foliplus-fullscreen-toggle").innerHTML.indexOf("MINIMIZE") ===
  -1;
