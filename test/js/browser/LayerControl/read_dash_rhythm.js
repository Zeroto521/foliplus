() =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--foliplus-dash-rhythm")
    .trim();
