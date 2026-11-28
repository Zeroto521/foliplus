// Re-runs the panel placement pass (the component re-pins on window resize).
() => {
  window.dispatchEvent(new Event("resize"));
  return true;
};
