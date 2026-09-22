() => {
  // Risk-1 red gate. Every foliplus-owned pane must carry the
  // `foliplus-layer-pane` base class (that is the semantic: "the content
  // belongs to us", and it is what makes the interaction rules in focus.css
  // apply uniformly). The focus overlay pane is one of those panes, but the
  // `.foliplus-focus-active .foliplus-layer-pane:not(.foliplus-focus-pane)`
  // rule in focus.css would hide it too — it is our mask, not another layer's
  // pane. Adding the exclusion class on top keeps the spotlight visible.
  //
  // This probe reads the pane as the code under test left it, then toggles
  // the exclusion class to prove the risk: with the base class on but no
  // exclusion class the pane becomes `visibility: hidden`. The `state.base`
  // field is what fails the gate before the fix (the pane is created via
  // map.createPane, bypassing the base-class assignment); `state.visibility`
  // is what fails the gate after the fix if the exclusion class is dropped.
  const item = document.querySelector(
    ".foliplus-layer-item:not(.foliplus-color-layer-item)",
  );
  if (!item) return { row: false };
  item.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const pane = window.map.getPane("foliplus-focus-overlay");
        if (!pane) return resolve({ pane: false });
        const container = window.map.getContainer();
        const visibility = () => getComputedStyle(pane).visibility;

        // 1. State as the code left it (post-fix: both classes on the pane).
        const state = {
          base: pane.classList.contains("foliplus-layer-pane"),
          exclusion: pane.classList.contains("foliplus-focus-pane"),
          visibility: visibility(),
          // The overlay pane must stay above every layer pane so the dim covers
          // them; ensurePane skips its provisional-z branch for panes outside
          // childPaneSpecs, so drawFocusMask pins FOCUS_Z.overlay itself.
          // This gate asserts the pin held AND that no other layer pane has
          // climbed to or above it.
          zIndex: pane.style.zIndex,
        };
        const peerZ = Array.from(document.querySelectorAll(".foliplus-layer-pane"))
          .filter(el => el !== pane)
          .map(el => parseInt(el.style.zIndex, 10) || 0)
          .sort((a, b) => b - a);
        const maxPeerZ = peerZ[0] ?? 0;

        // 2. Simulate the risk: base class stays on, exclusion drops.
        //    The pane should become `visibility: hidden`.
        if (state.exclusion) pane.classList.remove("foliplus-focus-pane");
        const withoutExclusion = visibility();

        // 3. Restore the exclusion: pane is visible again.
        pane.classList.add("foliplus-focus-pane");
        const restored = visibility();

        resolve({
          pane: true,
          focusActive: container.classList.contains("foliplus-focus-active"),
          state,
          maxPeerZ,
          withoutExclusion,
          restored,
        });
      });
    });
  });
};
