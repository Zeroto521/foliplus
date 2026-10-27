// Reads the style drawer and its scheme picker in one shot: what survived a
// press, which colour the hidden select committed, and what the trigger shows.
() => {
  const panel = document.querySelector(".foliplus-layer-style-panel");
  const dropdown = document.querySelector(".foliplus-scheme-picker-portal");
  const trigger = panel ? panel.querySelector(".foliplus-style-scheme-trigger") : null;
  const bar = trigger ? trigger.querySelector(".foliplus-style-scheme-bar") : null;
  const hidden = panel ? panel.querySelector(".foliplus-scheme-picker-hidden") : null;
  const firstBlock = bar ? bar.querySelector("div") : null;
  return {
    drawerPresent: !!panel,
    drawerVisible:
      !!panel && panel.isConnected && panel.getBoundingClientRect().height > 0,
    dropdownPresent: !!dropdown,
    triggerTitle: trigger ? trigger.title : null,
    hiddenValue: hidden ? hidden.value : null,
    barBlockColor: firstBlock ? getComputedStyle(firstBlock).backgroundColor : null,
  };
};
